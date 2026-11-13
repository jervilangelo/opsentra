"""Live Simulation Lab (blueprint §6.1, Phase 7; ADR-018).

Admin-only, test-only failure injection on the disposable lab.

Invariants:
  * the request names only a scenario ID from the code catalog; the instance and
    the documents come from the Terraform-written registry, hash-pinned;
  * preflight must pass: lab deployed with time left, instance running and
    tagged opsentra:lab=true, SSM Agent online, service healthy on a fresh
    probe, no open incident, no other run, cooldown over;
  * one active run at a time (a conditional lock item), a cooldown after each
    run and a hard time limit per run;
  * a reset restarts Nginx with the allowlisted runbook document; it never
    resolves an incident (only verified health does);
  * the watchdog (reconciler, every 2 minutes) confirms the injection, links the
    incident, ends runs whose incident was resolved, resets expired runs and
    ends runs whose lab is gone;
  * every step is audited under LAB#<scenarioId>, and on the linked incident.
"""

from __future__ import annotations

import logging
import re
import secrets
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from . import remediation
from .core import (
    ACTIVE,
    ROLE_RANK,
    IncidentError,
    Store,
    _fingerprint,
    _is,
    check_idempotency_key,
    de_item,
    iso,
    now_iso,
    parse_iso,
    remember,
    replayed,
    ser,
    ser_item,
)

logger = logging.getLogger("opsentra-lab")

RUN_LIMIT = timedelta(minutes=45)  # a run is reset automatically after this
COOLDOWN = timedelta(minutes=5)  # after a run ends, before the next can start
MIN_LAB_LEFT = timedelta(minutes=30)  # the lab must outlive a run comfortably
PROBE_FRESH = timedelta(minutes=3)  # the baseline probe must be this recent
INJECTION_CHECK_AFTER = timedelta(seconds=30)
INJECTION_TIMEOUT = timedelta(minutes=5)
SSM_TIMEOUT_SECONDS = 60
LOCK = "LOCK"
RUN_STATUSES = ("ACTIVE", "COMPLETED", "RESET", "EXPIRED", "FAILED")
_HASH = re.compile(r"^[0-9a-f]{64}$")
_SSM_FAILED = ("Failed", "TimedOut", "Cancelled")


@dataclass(frozen=True)
class Scenario:
    id: str
    group: str
    title: str
    summary: str
    expected_outcome: str
    registry_scenario: str  # the registry item's `scenario` value
    inject_document: str
    runbook_id: str  # the recovery runbook, also used by reset


# Code-owned catalog. Scenarios B and C (blueprint §6.2, §6.3) are planned.
CATALOG: dict[str, Scenario] = {
    "nginx-outage": Scenario(
        id="nginx-outage",
        group="A",
        title="Stop Nginx on the lab web server",
        summary=(
            "Stops Nginx through a fixed SSM document. The probe fails, the alarm fires and an "
            "incident opens. Recover it from the incident page with an approved runbook."
        ),
        expected_outcome=(
            "An incident opens within about 4 minutes. It is RESOLVED only after the approved "
            "restart and 3 healthy probes."
        ),
        registry_scenario="nginx",
        inject_document="Opsentra-Lab-StopNginx",
        runbook_id="rb-restart-nginx",
    ),
}


# ------------------------------------------------------------------ reads ---


def _lab_table(store: Store) -> str:
    if not store.t.lab_runs:
        raise IncidentError(503, "LAB_UNAVAILABLE", "The Simulation Lab is not configured.")
    return store.t.lab_runs


def _lock(store: Store) -> dict[str, Any]:
    return store.get(_lab_table(store), {"runId": LOCK}) or {}


def runs(store: Store) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {"TableName": _lab_table(store)}
    while True:
        page = store.c.scan(**kwargs)
        out += [de_item(i) for i in page.get("Items", []) if i.get("runId", {}).get("S") != LOCK]
        if "LastEvaluatedKey" not in page or len(out) >= 500:
            return out
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def get_run(store: Store, run_id: str) -> dict[str, Any] | None:
    return store.get(_lab_table(store), {"runId": run_id})


def _inject_pin(resource: Mapping[str, Any], sc: Scenario) -> dict[str, str] | None:
    scenarios = resource.get("scenarios")
    entry = scenarios.get(sc.id) if isinstance(scenarios, Mapping) else None
    if not isinstance(entry, Mapping):
        return None
    doc, digest = entry.get("document"), entry.get("documentHash")
    if doc == sc.inject_document and isinstance(digest, str) and _HASH.fullmatch(digest):
        return {"document": doc, "documentHash": digest}
    return None


def target(store: Store, sc: Scenario) -> dict[str, Any] | None:
    """The one registered lab resource for this scenario, or None."""
    found = [
        r
        for r in store.registry_items()
        if r.get("environment") == "lab" and r.get("scenario") == sc.registry_scenario and _inject_pin(r, sc)
    ]
    return found[0] if len(found) == 1 else None


def _instance_state(ec2: Any, instance_id: str) -> str:
    """'running', another EC2 state name, 'not-lab', 'missing' or 'unknown'."""
    try:
        res = ec2.describe_instances(InstanceIds=[instance_id])
    except Exception as err:  # noqa: BLE001
        if _is(err, "InvalidInstanceID.NotFound") or _is(err, "InvalidInstanceID.Malformed"):
            return "missing"
        return "unknown"
    for r in res.get("Reservations", []):
        for i in r.get("Instances", []):
            if i.get("InstanceId") != instance_id:
                continue
            tags = {t["Key"]: t["Value"] for t in i.get("Tags", [])}
            if tags.get("opsentra:lab") != "true":
                return "not-lab"
            return str(i.get("State", {}).get("Name", "unknown"))
    return "missing"


def _agent_online(ssm: Any, instance_id: str) -> bool | None:
    try:
        res = ssm.describe_instance_information(Filters=[{"Key": "InstanceIds", "Values": [instance_id]}])
    except Exception:  # noqa: BLE001 - unknown is not online
        return None
    return any(
        i.get("InstanceId") == instance_id and i.get("PingStatus") == "Online"
        for i in res.get("InstanceInformationList", [])
    )


def _active_incident(store: Store, resource_id: str) -> dict[str, Any] | None:
    for corr in store.active_correlations():
        incident = store.incident(str(corr.get("activeIncidentId", "")))
        if incident and incident.get("resourceId") == resource_id and incident.get("state") in ACTIVE:
            return incident
    return None


def preflight(store: Store, ssm: Any, ec2: Any, sc: Scenario, now: datetime) -> tuple[list[dict[str, Any]], Any]:
    """Ordered checks (the first failure is the reason shown) and the target."""
    checks: list[dict[str, Any]] = []

    def add(cid: str, label: str, ok: Any, detail: str | None = None) -> None:
        checks.append({"id": cid, "label": label, "ok": bool(ok), **({"detail": detail} if detail and not ok else {})})

    res = target(store, sc)
    add("registered", "Lab deployed and registered", res, "The live lab is not deployed.")
    if not res:
        return checks, None
    rid = str(res["resourceId"])

    lock = _lock(store)
    active = lock.get("activeRunId")
    add("lock", "No other scenario running", not active, f"Run {active} is still active.")
    cooldown = lock.get("cooldownUntil")
    add(
        "cooldown",
        "Cooldown finished",
        not cooldown or parse_iso(cooldown) <= now,
        f"The next run can start at {cooldown}.",
    )
    expires = res.get("labExpiresAt")
    add(
        "lab-time",
        "At least 30 minutes before the lab expires",
        isinstance(expires, str) and parse_iso(expires) - now >= MIN_LAB_LEFT,
        f"The lab expires at {expires}.",
    )
    state = _instance_state(ec2, rid)
    add("instance", "Instance running and tagged as a lab", state == "running", f"Instance state: {state}.")
    online = _agent_online(ssm, rid) if state == "running" else False
    add("ssm-agent", "SSM Agent online", online, "SSM Agent is not reporting as online.")
    add(
        "recovery",
        "Recovery runbook allowlisted",
        remediation.allowed_runbooks(res).get(sc.runbook_id),
        "The recovery runbook is not registered for this resource.",
    )
    incident = _active_incident(store, rid)
    add(
        "no-incident",
        "No open incident on this resource",
        not incident,
        f"Incident {incident['incidentId']} is {incident['state']}." if incident else None,
    )
    checked = res.get("lastCheckedAt")
    fresh = isinstance(checked, str) and now - parse_iso(checked) <= PROBE_FRESH
    add(
        "baseline",
        "Service healthy on a recent probe",
        fresh and res.get("health") == "HEALTHY",
        f"Last probe: {res.get('health', 'UNKNOWN')} at {checked or 'never'}.",
    )
    return checks, res


# ------------------------------------------------------------------- DTOs ---


def run_dto(item: Mapping[str, Any]) -> dict[str, Any]:
    status = item.get("status")
    out: dict[str, Any] = {
        "runId": item["runId"],
        "scenarioId": item.get("scenarioId", ""),
        "resourceId": item.get("resourceId", ""),
        "status": status if status in RUN_STATUSES else "FAILED",
        "injection": item.get("injection", "PENDING"),
        "startedAt": item.get("startedAt", ""),
        "startedBy": item.get("startedBy", ""),
        "expiresAt": item.get("expiresAt", ""),
    }
    for key in ("incidentId", "endedAt", "endedBy", "endReason"):
        if item.get(key):
            out[key] = item[key]
    return out


def scenario_dto(store: Store, ssm: Any, ec2: Any, sc: Scenario, now: datetime | None = None) -> dict[str, Any]:
    now = now or parse_iso(now_iso())
    checks, res = preflight(store, ssm, ec2, sc, now)
    failed = [c for c in checks if not c["ok"]]
    out: dict[str, Any] = {
        "id": sc.id,
        "group": sc.group,
        "title": sc.title,
        "summary": sc.summary,
        "expectedOutcome": sc.expected_outcome,
        "resourceId": str(res["resourceId"]) if res else "",
        "runbookId": sc.runbook_id,
        "available": not failed,
        "preflight": checks,
    }
    if failed:
        out["unavailableReason"] = failed[0].get("detail") or failed[0]["label"]
    if res and res.get("labExpiresAt"):
        out["labExpiresAt"] = res["labExpiresAt"]
    cooldown = _lock(store).get("cooldownUntil")
    if cooldown and parse_iso(cooldown) > now:
        out["cooldownUntil"] = cooldown
    mine = sorted((r for r in runs(store) if r.get("scenarioId") == sc.id), key=lambda r: str(r.get("startedAt")))
    if mine:
        latest = mine[-1]
        out["activeRun" if latest.get("status") == "ACTIVE" else "lastRun"] = run_dto(latest)
    return out


def list_scenarios(store: Store, ssm: Any, ec2: Any) -> list[dict[str, Any]]:
    now = parse_iso(now_iso())
    return [scenario_dto(store, ssm, ec2, sc, now) for sc in CATALOG.values()]


# ----------------------------------------------------------------- writes ---


def _audit(
    store: Store,
    sc_id: str,
    at: str,
    event_type: str,
    *,
    run_id: str,
    actor: str | None = None,
    outcome: str = "SUCCESS",
    previous: str | None = None,
    new: str | None = None,
    detail: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    put = store.audit_put(
        sc_id,
        at,
        event_type,
        correlation_id=run_id,
        actor_id=actor,
        previous=previous,
        new=new,
        detail=detail,
        outcome=outcome,
        target_type="LAB",
        target_id=run_id or sc_id,
    )
    put["Put"]["Item"]["PK"] = {"S": f"LAB#{sc_id}"}
    return put


def _incident_note(store: Store, incident_id: str, at: str, event_type: str, detail: Mapping[str, Any]) -> None:
    """A timeline entry on the linked incident; never changes its state."""
    incident = store.incident(incident_id)
    if not incident:
        return
    put = store.audit_put(
        incident_id,
        at,
        event_type,
        correlation_id=str(incident.get("correlationKey", "")),
        outcome="INFO",
        target_type="LAB",
        target_id=str(detail.get("runId", "")),
        detail=detail,
    )["Put"]
    store.c.put_item(**put)


def _transact(store: Store, items: list[dict[str, Any]]) -> bool:
    try:
        store.c.transact_write_items(TransactItems=items)
        return True
    except Exception as err:
        if _is(err, "TransactionCanceledException"):
            return False
        raise


def _require_admin(role: str) -> None:
    if ROLE_RANK.get(role, -1) < ROLE_RANK["ADMIN"]:
        raise IncidentError(403, "FORBIDDEN", "This needs the administrator role.")


def scenario(scenario_id: Any) -> Scenario:
    sc = CATALOG.get(scenario_id) if isinstance(scenario_id, str) else None
    if not sc:
        raise IncidentError(404, "NOT_FOUND", "No such lab scenario.")
    return sc


def record_denied(store: Store, sc: Scenario, action: str, actor: str, role: str, code: str) -> None:
    put = _audit(
        store,
        sc.id,
        now_iso(),
        f"{action}_DENIED",
        run_id="",
        actor=actor,
        outcome="DENIED",
        detail={"role": role, "code": code},
    )["Put"]
    store.c.put_item(**put)


def end_run(
    store: Store,
    run: Mapping[str, Any],
    status: str,
    reason: str,
    *,
    actor: str | None = None,
    cooldown: bool = True,
    detail: Mapping[str, Any] | None = None,
) -> bool:
    """ACTIVE -> status; releases the lock (with a cooldown unless nothing ran)."""
    now = now_iso()
    rid = str(run["runId"])
    sets: dict[str, Any] = {"status": status, "endedAt": now, "endReason": reason[:200]}
    if actor:
        sets["endedBy"] = actor
    names = {"#st": "status"}
    values: dict[str, Any] = {":active": {"S": "ACTIVE"}}
    parts = []
    for i, (k, v) in enumerate(sets.items()):
        names[f"#a{i}"] = k
        values[f":a{i}"] = ser(v)
        parts.append(f"#a{i} = :a{i}")
    items: list[dict[str, Any]] = [
        {
            "Update": {
                "TableName": _lab_table(store),
                "Key": {"runId": {"S": rid}},
                "UpdateExpression": "SET " + ", ".join(parts),
                "ConditionExpression": "#st = :active",
                "ExpressionAttributeNames": names,
                "ExpressionAttributeValues": values,
            }
        },
        _audit(
            store,
            str(run["scenarioId"]),
            now,
            f"LAB_SCENARIO_{status}",
            run_id=rid,
            actor=actor,
            outcome="FAILED" if status == "FAILED" else "SUCCESS",
            previous="ACTIVE",
            new=status,
            detail={"reason": reason, **(detail or {})},
        ),
    ]
    if _lock(store).get("activeRunId") == rid:
        until = iso(parse_iso(now) + COOLDOWN) if cooldown else now
        items.append(
            {
                "Update": {
                    "TableName": _lab_table(store),
                    "Key": {"runId": {"S": LOCK}},
                    "UpdateExpression": "SET cooldownUntil = :cd REMOVE activeRunId",
                    "ConditionExpression": "activeRunId = :r",
                    "ExpressionAttributeValues": {":cd": {"S": until}, ":r": {"S": rid}},
                }
            }
        )
    if not _transact(store, items):
        return False
    if run.get("incidentId"):
        _incident_note(
            store,
            str(run["incidentId"]),
            now,
            "LAB_SCENARIO_ENDED",
            {"runId": rid, "scenarioId": run["scenarioId"], "status": status, "reason": reason},
        )
    return True


def _send(ssm: Any, instance_id: str, pin: Mapping[str, str], comment: str) -> str:
    res = ssm.send_command(
        InstanceIds=[instance_id],
        DocumentName=pin["document"],
        DocumentHash=pin["documentHash"],
        DocumentHashType="Sha256",
        TimeoutSeconds=SSM_TIMEOUT_SECONDS,
        Comment=comment,
    )
    return str(res["Command"]["CommandId"])


def start(
    store: Store,
    ssm: Any,
    ec2: Any,
    *,
    scenario_id: Any,
    role: str,
    actor: str,
    acknowledge: Any,
    idempotency_key: str | None,
) -> dict[str, Any]:
    _require_admin(role)
    key = check_idempotency_key(idempotency_key)
    sc = scenario(scenario_id)
    if acknowledge is not True:
        raise IncidentError(400, "CONFIRMATION_REQUIRED", "Confirm that this test breaks the lab service.")
    fp = _fingerprint("lab-start", sc.id, {})
    previous = replayed(store, key, fp)
    if previous is not None:
        return previous

    now = now_iso()
    checks, res = preflight(store, ssm, ec2, sc, parse_iso(now))
    failed = [c for c in checks if not c["ok"]]
    if failed:
        code = "LAB_BUSY" if failed[0]["id"] in ("lock", "cooldown") else "PREFLIGHT_FAILED"
        raise IncidentError(409, code, failed[0].get("detail") or failed[0]["label"])
    pin = _inject_pin(res, sc)
    if not pin:  # preflight checked it; keeps the type checker honest
        raise IncidentError(409, "PREFLIGHT_FAILED", "The fault-injection document is not registered.")

    instance_id = str(res["resourceId"])
    run_id = f"LAB-{now[:10].replace('-', '')}-{secrets.token_hex(3).upper()}"
    expires = min(parse_iso(now) + RUN_LIMIT, parse_iso(str(res["labExpiresAt"])))
    run = {
        "runId": run_id,
        "scenarioId": sc.id,
        "resourceId": instance_id,
        "status": "ACTIVE",
        "injection": "PENDING",
        "documentHash": pin["documentHash"],
        "startedAt": now,
        "startedBy": actor,
        "expiresAt": iso(expires),
    }
    taken = _transact(
        store,
        [
            {
                "Update": {
                    "TableName": _lab_table(store),
                    "Key": {"runId": {"S": LOCK}},
                    "UpdateExpression": "SET activeRunId = :r",
                    "ConditionExpression": (
                        "attribute_not_exists(activeRunId) AND "
                        "(attribute_not_exists(cooldownUntil) OR cooldownUntil <= :now)"
                    ),
                    "ExpressionAttributeValues": {":r": {"S": run_id}, ":now": {"S": now}},
                }
            },
            {
                "Put": {
                    "TableName": _lab_table(store),
                    "Item": ser_item(run),
                    "ConditionExpression": "attribute_not_exists(runId)",
                }
            },
            _audit(
                store,
                sc.id,
                now,
                "LAB_SCENARIO_STARTED",
                run_id=run_id,
                actor=actor,
                new="ACTIVE",
                detail={"resourceId": instance_id, "document": pin["document"], "expiresAt": run["expiresAt"]},
            ),
        ],
    )
    if not taken:
        raise IncidentError(409, "LAB_BUSY", "Another scenario started first.")

    try:
        command_id = _send(ssm, instance_id, pin, f"Opsentra lab {run_id}")
    except Exception:  # noqa: BLE001
        end_run(store, run, "FAILED", "SSM did not accept the fault injection", cooldown=False)
        raise IncidentError(502, "LAB_INJECTION_FAILED", "SSM did not accept the fault injection.") from None
    store.c.transact_write_items(
        TransactItems=[
            {
                "Update": {
                    "TableName": _lab_table(store),
                    "Key": {"runId": {"S": run_id}},
                    "UpdateExpression": "SET injection = :sent, commandId = :c",
                    "ConditionExpression": "injection = :pending",
                    "ExpressionAttributeValues": {
                        ":sent": {"S": "SENT"},
                        ":c": {"S": command_id},
                        ":pending": {"S": "PENDING"},
                    },
                }
            },
            _audit(
                store,
                sc.id,
                now_iso(),
                "LAB_INJECTION_SENT",
                run_id=run_id,
                detail={"commandId": command_id, "document": pin["document"]},
            ),
        ]
    )
    response = scenario_dto(store, ssm, ec2, sc)
    remember(store, key, fp, response)
    return response


def reset(
    store: Store,
    ssm: Any,
    ec2: Any,
    *,
    scenario_id: Any,
    role: str,
    actor: str,
    idempotency_key: str | None,
) -> dict[str, Any]:
    """Restarts Nginx with the allowlisted recovery document and ends the active
    run, if any. The incident still needs verified health to resolve."""
    _require_admin(role)
    key = check_idempotency_key(idempotency_key)
    sc = scenario(scenario_id)
    fp = _fingerprint("lab-reset", sc.id, {})
    previous = replayed(store, key, fp)
    if previous is not None:
        return previous

    res = target(store, sc)
    if not res:
        raise IncidentError(409, "LAB_NOT_DEPLOYED", "The live lab is not deployed.")
    pin = remediation.allowed_runbooks(res).get(sc.runbook_id)
    if not pin:
        raise IncidentError(409, "PREFLIGHT_FAILED", "The recovery runbook is not registered for this resource.")
    instance_id = str(res["resourceId"])
    if _instance_state(ec2, instance_id) != "running":
        raise IncidentError(409, "PREFLIGHT_FAILED", "The lab instance is not running.")
    try:
        command_id = _send(ssm, instance_id, pin, f"Opsentra lab reset {sc.id}")
    except Exception:  # noqa: BLE001
        raise IncidentError(502, "LAB_RESET_FAILED", "SSM did not accept the reset.") from None

    active = [r for r in runs(store) if r.get("scenarioId") == sc.id and r.get("status") == "ACTIVE"]
    detail = {"resetCommandId": command_id}
    if active:
        end_run(store, active[0], "RESET", "Reset by an administrator", actor=actor, detail=detail)
    else:
        store.c.put_item(**_audit(store, sc.id, now_iso(), "LAB_RESET", run_id="", actor=actor, detail=detail)["Put"])
    response = scenario_dto(store, ssm, ec2, sc)
    remember(store, key, fp, response)
    return response


# --------------------------------------------------------------- watchdog ---


def _update_run(
    store: Store, run_id: str, expr: str, condition: str, values: dict[str, Any], names: dict[str, str] | None = None
) -> bool:
    try:
        store.c.update_item(
            TableName=_lab_table(store),
            Key={"runId": {"S": run_id}},
            UpdateExpression=expr,
            ConditionExpression=condition,
            ExpressionAttributeValues=values,
            **({"ExpressionAttributeNames": names} if names else {}),
        )
        return True
    except Exception as err:
        if _is(err, "ConditionalCheckFailedException"):
            return False
        raise


def _watch(store: Store, ssm: Any, ec2: Any, run: dict[str, Any], now: datetime, report: dict[str, int]) -> None:
    rid, sc_id = str(run["runId"]), str(run["scenarioId"])
    sc = CATALOG.get(sc_id)
    started = parse_iso(str(run["startedAt"]))

    # 1. The lab is gone or stopped: end the run; nothing to reset.
    state = _instance_state(ec2, str(run["resourceId"]))
    if state not in ("running", "unknown", "pending"):
        if end_run(store, run, "EXPIRED", f"The lab instance is no longer running ({state})"):
            report["labEnded"] += 1
        return

    # 2. Confirm the fault injection.
    injection = run.get("injection")
    if injection == "SENT" and now > started + INJECTION_CHECK_AFTER:
        status = remediation._invocation_status(ssm, str(run.get("commandId", "")), str(run["resourceId"]))
        if status == "Success":
            values = {":ok": {"S": "SUCCEEDED"}, ":sent": {"S": "SENT"}}
            if _update_run(store, rid, "SET injection = :ok", "injection = :sent", values):
                store.c.put_item(
                    **_audit(store, sc_id, now_iso(), "LAB_FAULT_INJECTED", run_id=rid, detail={"ssmStatus": status})[
                        "Put"
                    ]
                )
        elif status in _SSM_FAILED or now > started + INJECTION_TIMEOUT:
            _update_run(
                store, rid, "SET injection = :f", "injection = :sent", {":f": {"S": "FAILED"}, ":sent": {"S": "SENT"}}
            )
            why = f"Fault injection failed: SSM status {status}" if status in _SSM_FAILED else "No injection result"
            if end_run(store, run, "FAILED", why, cooldown=False):
                report["labEnded"] += 1
            return
    elif injection == "PENDING" and now > started + INJECTION_TIMEOUT:
        if end_run(store, run, "FAILED", "The fault injection was never sent", cooldown=False):
            report["labEnded"] += 1
        return

    # 3. Link the incident this run caused (the preflight ruled out older ones).
    incident = store.incident(str(run["incidentId"])) if run.get("incidentId") else None
    if not incident:
        found = _active_incident(store, str(run["resourceId"]))
        if found and parse_iso(str(found.get("openedAt", run["startedAt"]))) >= started:
            if _link(store, rid, found["incidentId"]):
                run["incidentId"] = found["incidentId"]
                incident = found
                report["labLinked"] += 1
                _incident_note(
                    store,
                    found["incidentId"],
                    now_iso(),
                    "LAB_SCENARIO_LINKED",
                    {
                        "runId": rid,
                        "scenarioId": sc_id,
                        "note": "This incident was caused by a Simulation Lab test.",
                    },
                )

    # 4. Verified recovery ends the run.
    if incident and incident.get("state") in ("RESOLVED", "CLOSED"):
        if end_run(store, run, "COMPLETED", f"Incident {incident['incidentId']} reached {incident['state']}"):
            report["labEnded"] += 1
        return

    # 5. Time limit: restart Nginx with the allowlisted document and end the run.
    if now >= parse_iso(str(run["expiresAt"])):
        res = store.get(store.t.resources, {"resourceId": str(run["resourceId"])})
        pin = remediation.allowed_runbooks(res).get(sc.runbook_id) if sc and res else None
        command_id = None
        if pin and state == "running":
            try:
                command_id = _send(ssm, str(run["resourceId"]), pin, f"Opsentra lab expiry {rid}")
            except Exception:  # noqa: BLE001
                logger.exception("expiry reset failed for %s", rid)
        reason = "Time limit reached; Nginx restart sent" if command_id else "Time limit reached; restart not sent"
        if end_run(store, run, "EXPIRED", reason, detail={"resetCommandId": command_id} if command_id else None):
            report["labEnded"] += 1


def _link(store: Store, run_id: str, incident_id: str) -> bool:
    return _update_run(
        store,
        run_id,
        "SET incidentId = :i",
        "attribute_not_exists(incidentId) AND #st = :active",
        {":i": {"S": incident_id}, ":active": {"S": "ACTIVE"}},
        {"#st": "status"},
    )


def _release_stale_lock(store: Store) -> bool:
    """A lock that names a run that is not ACTIVE (a crash between writes)."""
    active = _lock(store).get("activeRunId")
    if not active:
        return False
    run = get_run(store, str(active))
    if run and run.get("status") == "ACTIVE":
        return False
    try:
        store.c.update_item(
            TableName=_lab_table(store),
            Key={"runId": {"S": LOCK}},
            UpdateExpression="SET cooldownUntil = :cd REMOVE activeRunId",
            ConditionExpression="activeRunId = :r",
            ExpressionAttributeValues={":cd": {"S": now_iso()}, ":r": {"S": str(active)}},
        )
        return True
    except Exception as err:
        if _is(err, "ConditionalCheckFailedException"):
            return False
        raise


def watchdog(store: Store, ssm: Any, ec2: Any) -> dict[str, int]:
    report = {"labLinked": 0, "labEnded": 0, "labErrors": 0}
    if not store.t.lab_runs:
        return report
    now = parse_iso(now_iso())
    for run in runs(store):
        if run.get("status") != "ACTIVE":
            continue
        try:
            _watch(store, ssm, ec2, run, now, report)
        except Exception:  # noqa: BLE001 - one bad run must not block the rest
            logger.exception("lab watchdog failed for %s", run.get("runId"))
            report["labErrors"] += 1
    try:
        if _release_stale_lock(store):
            report["labEnded"] += 1
    except Exception:  # noqa: BLE001
        logger.exception("lab lock check failed")
        report["labErrors"] += 1
    return report
