"""Approved remediation (blueprint §4.4, §5; ADR-017).

Request (Operator+) -> decision (Admin) -> coordinator runs one fixed, hash-pinned
SSM document on one registered lab instance -> SSM status -> verification.

Invariants:
  * the request body names only a runbook ID; resource, instance and document
    come from server data (code catalog + Terraform-written registry);
  * exactly one SSM command per request: the coordinator takes a conditional
    lock (APPROVED -> RUNNING, no commandId) before sending, and never resends;
  * SSM Success moves the incident to VERIFYING, never to RESOLVED;
  * RESOLVED needs 3 consecutive HEALTHY probes, all after the command finished,
    and the alarm OK; otherwise ESCALATED after 10 minutes (owner decision);
  * failed, rejected, expired or timed-out requests never execute and escalate.
"""

from __future__ import annotations

import re
import secrets
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from .core import (
    ROLE_RANK,
    IncidentError,
    Store,
    _fingerprint,
    _is,
    check_idempotency_key,
    check_version,
    de_item,
    iso,
    now_iso,
    parse_iso,
    remember,
    replayed,
    resolve,
    ser,
    ser_item,
)

APPROVAL_TTL = timedelta(minutes=15)
DISPATCH_GRACE = timedelta(minutes=1)  # APPROVED but not picked up -> reconciler dispatches
STATUS_POLL_AFTER = timedelta(minutes=3)  # RUNNING without a status event -> poll SSM
RUN_TIMEOUT = timedelta(minutes=10)  # RUNNING this long -> FAILED, escalate
VERIFY_WINDOW = timedelta(minutes=10)  # VERIFYING this long without proof -> ESCALATED
STREAK_REQUIRED = 3
SSM_TIMEOUT_SECONDS = 120

REQUEST_FROM = ("ACKNOWLEDGED", "INVESTIGATING", "ESCALATED")
RUNBOOK_ID = re.compile(r"^[a-z0-9-]{1,40}$")
SSM_TERMINAL = {"Success": "SUCCEEDED", "Failed": "FAILED", "TimedOut": "FAILED", "Cancelled": "FAILED"}


@dataclass(frozen=True)
class Runbook:
    id: str
    version: int
    title: str
    description: str
    action_key: str


# Code-owned catalog. A runbook applies to a resource only when the resource's
# registry item (written by Terraform) lists it with the same document name.
CATALOG: dict[str, Runbook] = {
    "rb-restart-nginx": Runbook(
        id="rb-restart-nginx",
        version=1,
        title="Restart Nginx",
        description="Restarts the Nginx service on the lab web server through a fixed SSM document.",
        action_key="Opsentra-Lab-RestartNginx",
    ),
}


def allowed_runbooks(resource: Mapping[str, Any] | None) -> dict[str, dict[str, str]]:
    """runbookId -> {document, documentHash} for a registry item."""
    out: dict[str, dict[str, str]] = {}
    registered = (resource or {}).get("runbooks") or {}
    if not isinstance(registered, Mapping):
        return out
    for rid, entry in registered.items():
        rb = CATALOG.get(str(rid))
        if not rb or not isinstance(entry, Mapping):
            continue
        doc, digest = entry.get("document"), entry.get("documentHash")
        if doc == rb.action_key and isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest):
            out[rb.id] = {"document": doc, "documentHash": digest}
    return out


def new_request_id(at: str) -> str:
    return f"REQ-{at[:10].replace('-', '')}-{secrets.token_hex(3).upper()}"


def request(store: Store, request_id: str) -> dict[str, Any] | None:
    return store.get(store.t.remediations, {"requestId": request_id})


def requests(store: Store) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {"TableName": store.t.remediations}
    while True:
        page = store.c.scan(**kwargs)
        out += [de_item(i) for i in page.get("Items", [])]
        if "LastEvaluatedKey" not in page or len(out) >= 500:
            return out
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def _incident_update(
    store: Store, incident: Mapping[str, Any], to: str, extra_sets: str = "", extra_values: dict[str, Any] | None = None
) -> dict[str, Any]:
    sets = "SET #s = :to, version = version + :one" + (f", {extra_sets}" if extra_sets else "")
    return {
        "Update": {
            "TableName": store.t.incidents,
            "Key": {"incidentId": {"S": incident["incidentId"]}},
            "UpdateExpression": sets,
            "ConditionExpression": "version = :ver AND #s = :from",
            "ExpressionAttributeNames": {"#s": "state"},
            "ExpressionAttributeValues": {
                ":to": {"S": to},
                ":one": {"N": "1"},
                ":ver": {"N": str(incident["version"])},
                ":from": {"S": incident["state"]},
                **(extra_values or {}),
            },
        }
    }


def _request_update(
    store: Store, request_id: str, from_status: str, sets: dict[str, Any], condition: str = ""
) -> dict[str, Any]:
    names = {"#st": "status"}
    values: dict[str, Any] = {":from": {"S": from_status}}
    parts = []
    for i, (k, v) in enumerate(sets.items()):
        names[f"#a{i}"] = k
        values[f":a{i}"] = ser(v)
        parts.append(f"#a{i} = :a{i}")
    return {
        "Update": {
            "TableName": store.t.remediations,
            "Key": {"requestId": {"S": request_id}},
            "UpdateExpression": "SET " + ", ".join(parts),
            "ConditionExpression": "#st = :from" + (f" AND {condition}" if condition else ""),
            "ExpressionAttributeNames": names,
            "ExpressionAttributeValues": values,
        }
    }


def _transact(
    store: Store, items: list[dict[str, Any]], conflict: str = "The incident changed. Refresh and retry."
) -> None:
    try:
        store.c.transact_write_items(TransactItems=items)
    except Exception as err:
        if _is(err, "TransactionCanceledException"):
            raise IncidentError(409, "VERSION_CONFLICT", conflict) from err
        raise


def _clean_reason(reason: Any) -> str:
    text = (reason if isinstance(reason, str) else "").strip()[:280]
    if not text:
        raise IncidentError(400, "VALIDATION", "A reason is required.")
    return text


# ---------------------------------------------------------- user commands ---


def request_remediation(
    store: Store,
    *,
    incident_id: str,
    role: str,
    actor: str,
    expected_version: Any,
    runbook_id: Any,
    reason: Any,
    idempotency_key: str | None,
) -> dict[str, Any]:
    if ROLE_RANK.get(role, -1) < ROLE_RANK["OPERATOR"]:
        raise IncidentError(403, "FORBIDDEN", "This needs the operator role.")
    key = check_idempotency_key(idempotency_key)
    version = check_version(expected_version)
    if not isinstance(runbook_id, str) or not RUNBOOK_ID.match(runbook_id):
        raise IncidentError(400, "VALIDATION", "runbookId is not valid.")
    text = _clean_reason(reason)

    fp = _fingerprint("request-remediation", incident_id, {"v": version, "rb": runbook_id, "r": text})
    previous = replayed(store, key, fp)
    if previous is not None:
        return previous

    incident = store.incident(incident_id)
    if not incident:
        raise IncidentError(404, "NOT_FOUND", f"Incident {incident_id} was not found.")
    if incident["version"] != version:
        raise IncidentError(409, "VERSION_CONFLICT", "The incident changed since you loaded it. Refresh and retry.")
    if incident["state"] not in REQUEST_FROM:
        raise IncidentError(409, "INVALID_STATE", f"Not allowed while the incident is {incident['state']}.")
    resource = store.get(store.t.resources, {"resourceId": str(incident.get("resourceId", ""))})
    pinned = allowed_runbooks(resource).get(runbook_id)
    if not pinned:
        raise IncidentError(400, "RUNBOOK_NOT_ALLOWED", "That runbook is not allowlisted for this resource.")

    rb = CATALOG[runbook_id]
    now = now_iso()
    request_id = new_request_id(now)
    item = {
        "requestId": request_id,
        "incidentId": incident_id,
        "resourceId": incident["resourceId"],
        "runbookId": rb.id,
        "runbookVersion": rb.version,
        "actionKey": rb.action_key,
        "documentHash": pinned["documentHash"],
        "requestedBy": actor,
        "requestedByRole": role,
        "status": "PENDING",
        "expectedVersion": version + 1,
        "reason": text,
        "requestedAt": now,
        "expiresAt": iso(parse_iso(now) + APPROVAL_TTL),
    }
    corr = incident["correlationKey"]
    _transact(
        store,
        [
            _incident_update(
                store,
                incident,
                "AWAITING_APPROVAL",
                "runbookId = :rb, activeRequestId = :rq",
                {":rb": {"S": rb.id}, ":rq": {"S": request_id}},
            ),
            {
                "Put": {
                    "TableName": store.t.remediations,
                    "Item": ser_item(item),
                    "ConditionExpression": "attribute_not_exists(requestId)",
                }
            },
            store.audit_put(
                incident_id,
                now,
                "REMEDIATION_REQUESTED",
                correlation_id=corr,
                actor_id=actor,
                previous=incident["state"],
                new="AWAITING_APPROVAL",
                detail={"requestId": request_id, "runbookId": rb.id, "reason": text},
            ),
        ],
    )
    response = {
        "status": 200,
        "incident": store.incident(incident_id) or {},
        "request": request(store, request_id) or {},
    }
    remember(store, key, fp, response)
    return response


def decide_remediation(
    store: Store,
    *,
    request_id: str,
    role: str,
    actor: str,
    expected_version: Any,
    decision: Any,
    reason: Any,
    idempotency_key: str | None,
) -> dict[str, Any]:
    """Admin approve/reject. Returns {status, incident, request, dispatch}; the
    caller async-invokes the coordinator when dispatch is True."""
    if ROLE_RANK.get(role, -1) < ROLE_RANK["ADMIN"]:
        raise IncidentError(403, "FORBIDDEN", "This needs the administrator role.")
    key = check_idempotency_key(idempotency_key)
    version = check_version(expected_version)
    if decision not in ("APPROVE", "REJECT"):
        raise IncidentError(400, "VALIDATION", "decision must be APPROVE or REJECT.")
    text = _clean_reason(reason)

    fp = _fingerprint("decide-remediation", request_id, {"v": version, "d": decision, "r": text})
    previous = replayed(store, key, fp)
    if previous is not None:
        return {**previous, "dispatch": False}  # a replay never dispatches again

    req = request(store, request_id)
    if not req:
        raise IncidentError(404, "NOT_FOUND", f"Request {request_id} was not found.")
    incident = store.incident(req["incidentId"])
    if not incident:
        raise IncidentError(404, "NOT_FOUND", "The incident for this request was not found.")
    if incident["version"] != version:
        raise IncidentError(409, "VERSION_CONFLICT", "The incident changed since you loaded it. Refresh and retry.")
    if req["status"] != "PENDING" or incident["state"] != "AWAITING_APPROVAL":
        raise IncidentError(409, "INVALID_STATE", f"The request is already {req['status']}.")
    now = now_iso()
    if parse_iso(now) > parse_iso(req["expiresAt"]):
        expire(store, req, incident)
        raise IncidentError(409, "APPROVAL_EXPIRED", "This approval request has expired.")

    corr = incident["correlationKey"]
    rid = req["requestId"]
    approve = decision == "APPROVE"
    self_approved = approve and req.get("requestedBy") == actor
    items = [
        _request_update(
            store,
            rid,
            "PENDING",
            {
                "status": "APPROVED" if approve else "REJECTED",
                "approvedBy": actor,
                "decidedAt": now,
                "decisionReason": text,
                **({"selfApproved": True} if self_approved else {}),
            },
        ),
        store.audit_put(
            incident["incidentId"],
            now,
            "REMEDIATION_APPROVED" if approve else "REMEDIATION_REJECTED",
            correlation_id=corr,
            actor_id=actor,
            previous="PENDING",
            new="APPROVED" if approve else "REJECTED",
            target_type="REMEDIATION",
            target_id=rid,
            detail={"requestId": rid, "reason": text, **({"selfApproved": True} if self_approved else {})},
        ),
    ]
    if approve:
        items.append(_incident_update(store, incident, "REMEDIATING"))
    else:
        items.append(_incident_update(store, incident, "ESCALATED", "REMOVE activeRequestId"))
        items.append(
            store.audit_put(
                incident["incidentId"],
                now,
                "INCIDENT_ESCALATED",
                correlation_id=corr,
                previous="AWAITING_APPROVAL",
                new="ESCALATED",
                detail={"reason": "Remediation rejected"},
            )
        )
    _transact(store, items)
    response = {
        "status": 200,
        "incident": store.incident(incident["incidentId"]) or {},
        "request": request(store, rid) or {},
    }
    remember(store, key, fp, response)
    return {**response, "dispatch": approve}


# ----------------------------------------------------------- system steps ---


def expire(store: Store, req: Mapping[str, Any], incident: Mapping[str, Any]) -> bool:
    """PENDING past expiresAt -> REJECTED ("Approval expired"); the incident, if
    still waiting on this request, is ESCALATED."""
    now = now_iso()
    corr = incident["correlationKey"]
    rid = req["requestId"]
    items = [
        _request_update(
            store, rid, "PENDING", {"status": "REJECTED", "errorSummary": "Approval expired", "decidedAt": now}
        ),
        store.audit_put(
            incident["incidentId"],
            now,
            "APPROVAL_EXPIRED",
            correlation_id=corr,
            target_type="REMEDIATION",
            target_id=rid,
            previous="PENDING",
            new="REJECTED",
            detail={"requestId": rid},
        ),
    ]
    if incident["state"] == "AWAITING_APPROVAL" and incident.get("activeRequestId") == rid:
        items.append(_incident_update(store, incident, "ESCALATED", "REMOVE activeRequestId"))
        items.append(
            store.audit_put(
                incident["incidentId"],
                now,
                "INCIDENT_ESCALATED",
                correlation_id=corr,
                previous="AWAITING_APPROVAL",
                new="ESCALATED",
                detail={"reason": "Approval expired"},
            )
        )
    try:
        _transact(store, items)
        return True
    except IncidentError:
        return False


def _instance_is_lab(ec2: Any, instance_id: str) -> bool:
    res = ec2.describe_instances(InstanceIds=[instance_id])
    for r in res.get("Reservations", []):
        for i in r.get("Instances", []):
            tags = {t["Key"]: t["Value"] for t in i.get("Tags", [])}
            if i.get("InstanceId") == instance_id and tags.get("opsentra:lab") == "true":
                return i.get("State", {}).get("Name") == "running"
    return False


def dispatch(store: Store, ssm: Any, ec2: Any, request_id: str) -> str:
    """Runs an APPROVED request exactly once. Returns the outcome for logs."""
    req = request(store, request_id)
    if not req or req.get("status") != "APPROVED" or req.get("executionId"):
        return "skipped"
    now = now_iso()
    try:
        store.c.transact_write_items(
            TransactItems=[
                _request_update(
                    store,
                    request_id,
                    "APPROVED",
                    {"status": "RUNNING", "startedAt": now},
                    "attribute_not_exists(executionId)",
                )
            ]
        )
    except Exception as err:
        if _is(err, "TransactionCanceledException"):
            return "skipped"  # another invocation holds the lock
        raise

    incident = store.incident(req["incidentId"]) or {}
    resource = store.get(store.t.resources, {"resourceId": req["resourceId"]})
    pinned = allowed_runbooks(resource).get(req["runbookId"])
    problem = None
    if incident.get("state") != "REMEDIATING":
        problem = "The incident is no longer awaiting remediation"
    elif not pinned or pinned != {"document": req["actionKey"], "documentHash": req["documentHash"]}:
        problem = "The runbook is no longer allowlisted for this resource"
    else:
        try:
            if not _instance_is_lab(ec2, req["resourceId"]):
                problem = "The target is not a running lab instance"
        except Exception:  # noqa: BLE001 - treat as not eligible, never guess
            problem = "The target could not be verified"
    if problem:
        finish(store, request_id, "FAILED", problem)
        return "failed"
    try:
        res = ssm.send_command(
            InstanceIds=[req["resourceId"]],
            DocumentName=req["actionKey"],
            DocumentHash=req["documentHash"],
            DocumentHashType="Sha256",
            TimeoutSeconds=SSM_TIMEOUT_SECONDS,
            Comment=f"Opsentra {request_id}",
        )
        command_id = res["Command"]["CommandId"]
    except Exception:  # noqa: BLE001
        finish(store, request_id, "FAILED", "SSM did not accept the command")
        return "failed"
    store.c.transact_write_items(
        TransactItems=[
            _request_update(store, request_id, "RUNNING", {"executionId": command_id}),
            store.audit_put(
                req["incidentId"],
                now_iso(),
                "REMEDIATION_STARTED",
                correlation_id=str(incident.get("correlationKey", "")),
                target_type="REMEDIATION",
                target_id=request_id,
                detail={"requestId": request_id, "executionId": command_id, "actionKey": req["actionKey"]},
            ),
        ]
    )
    return "sent"


def finish(store: Store, request_id: str, outcome: str, summary: str | None = None, at: str | None = None) -> bool:
    """RUNNING -> SUCCEEDED (incident VERIFYING) or FAILED (incident ESCALATED)."""
    req = request(store, request_id)
    if not req or req.get("status") != "RUNNING":
        return False
    incident = store.incident(req["incidentId"])
    if not incident or incident.get("state") != "REMEDIATING":
        return False
    when = at or now_iso()
    corr = incident["correlationKey"]
    ok = outcome == "SUCCEEDED"
    sets: dict[str, Any] = {"status": outcome, "completedAt": when}
    if summary:
        sets["errorSummary"] = summary[:200]
    items = [
        _request_update(store, request_id, "RUNNING", sets),
        store.audit_put(
            incident["incidentId"],
            when,
            "REMEDIATION_SUCCEEDED" if ok else "REMEDIATION_FAILED",
            correlation_id=corr,
            target_type="REMEDIATION",
            target_id=request_id,
            previous="RUNNING",
            new=outcome,
            detail={
                "requestId": request_id,
                "executionId": req.get("executionId"),
                "note": "SSM reported Success; not recovered until verified",
            }
            if ok
            else {"requestId": request_id, "error": summary or "Failed"},
        ),
    ]
    if ok:
        items.append(_incident_update(store, incident, "VERIFYING"))
        items.append(
            store.audit_put(
                incident["incidentId"],
                when,
                "VERIFICATION_STARTED",
                correlation_id=corr,
                previous="REMEDIATING",
                new="VERIFYING",
            )
        )
    else:
        items.append(_incident_update(store, incident, "ESCALATED", "REMOVE activeRequestId"))
        items.append(
            store.audit_put(
                incident["incidentId"],
                when,
                "INCIDENT_ESCALATED",
                correlation_id=corr,
                previous="REMEDIATING",
                new="ESCALATED",
                detail={"reason": "Remediation failed"},
            )
        )
    try:
        _transact(store, items)
        return True
    except IncidentError:
        return False


def on_ssm_status(store: Store, event: Mapping[str, Any]) -> str:
    """EventBridge "EC2 Command Status-change Notification" for our documents."""
    detail = event.get("detail") if isinstance(event.get("detail"), Mapping) else {}
    command_id, status = detail.get("command-id"), detail.get("status")
    if not isinstance(command_id, str) or status not in SSM_TERMINAL:
        return "ignored"
    match = [r for r in requests(store) if r.get("executionId") == command_id]
    if len(match) != 1 or match[0].get("actionKey") != detail.get("document-name"):
        return "ignored"
    outcome = SSM_TERMINAL[status]
    return (
        "updated"
        if finish(store, match[0]["requestId"], outcome, None if outcome == "SUCCEEDED" else f"SSM status: {status}")
        else "ignored"
    )


def verify(store: Store, incident: Mapping[str, Any], resource: Mapping[str, Any] | None, alarm_ok: bool) -> str:
    """VERIFYING -> RESOLVED with 3 consecutive healthy probes after the command
    finished and the alarm OK; ESCALATED once the window passes without that."""
    req = request(store, str(incident.get("activeRequestId", "")))
    if not req or req.get("status") != "SUCCEEDED" or not req.get("completedAt"):
        return "waiting"
    done = parse_iso(req["completedAt"])
    res = resource or {}
    streak = int(res.get("healthyStreak") or 0)
    since = res.get("healthyStreakSince")
    if alarm_ok and res.get("health") == "HEALTHY" and streak >= STREAK_REQUIRED and since and parse_iso(since) > done:
        evidence = {
            "check": "independent HTTP probe",
            "consecutiveHealthyChecks": streak,
            "streakSince": since,
            "afterRemediation": req["completedAt"],
            "requestId": req["requestId"],
        }
        return "resolved" if resolve(store, incident, str(res.get("lastCheckedAt")), evidence) else "waiting"
    if parse_iso(now_iso()) > done + VERIFY_WINDOW:
        now = now_iso()
        corr = incident["correlationKey"]
        try:
            _transact(
                store,
                [
                    _incident_update(store, incident, "ESCALATED", "REMOVE activeRequestId"),
                    store.audit_put(
                        incident["incidentId"],
                        now,
                        "VERIFICATION_FAILED",
                        correlation_id=corr,
                        detail={
                            "note": "Not verified healthy within 10 minutes of the runbook finishing",
                            "consecutiveHealthyChecks": streak,
                        },
                    ),
                    store.audit_put(
                        incident["incidentId"],
                        now,
                        "INCIDENT_ESCALATED",
                        correlation_id=corr,
                        previous="VERIFYING",
                        new="ESCALATED",
                        detail={"reason": "Recovery not verified"},
                    ),
                ],
            )
            return "escalated"
        except IncidentError:
            return "waiting"
    return "waiting"


def reconcile(store: Store, ssm: Any, ec2: Any) -> dict[str, int]:
    """Backstop for lost events: expiry, undispatched approvals, stuck commands."""
    report = {"expired": 0, "dispatched": 0, "finished": 0}
    now = parse_iso(now_iso())
    for req in requests(store):
        status = req.get("status")
        if status == "PENDING" and now > parse_iso(req["expiresAt"]):
            incident = store.incident(req["incidentId"])
            if incident and expire(store, req, incident):
                report["expired"] += 1
        elif status == "APPROVED" and req.get("decidedAt") and now > parse_iso(req["decidedAt"]) + DISPATCH_GRACE:
            if dispatch(store, ssm, ec2, req["requestId"]) != "skipped":
                report["dispatched"] += 1
        elif status == "RUNNING" and req.get("startedAt"):
            started = parse_iso(req["startedAt"])
            if not req.get("executionId"):
                if now > started + STATUS_POLL_AFTER and finish(
                    store, req["requestId"], "FAILED", "Dispatch did not complete; not retried"
                ):
                    report["finished"] += 1
                continue
            if now > started + STATUS_POLL_AFTER:
                status_now = _invocation_status(ssm, req["executionId"], req["resourceId"])
                if status_now in SSM_TERMINAL:
                    outcome = SSM_TERMINAL[status_now]
                    if finish(
                        store,
                        req["requestId"],
                        outcome,
                        None if outcome == "SUCCEEDED" else f"SSM status: {status_now}",
                    ):
                        report["finished"] += 1
                elif now > started + RUN_TIMEOUT and finish(
                    store, req["requestId"], "FAILED", "No result from SSM within 10 minutes"
                ):
                    report["finished"] += 1
    return report


def _invocation_status(ssm: Any, command_id: str, instance_id: str) -> str | None:
    try:
        return str(ssm.get_command_invocation(CommandId=command_id, InstanceId=instance_id).get("Status"))
    except Exception:  # noqa: BLE001 - unknown is not success
        return None
