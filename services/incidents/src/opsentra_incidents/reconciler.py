"""Incident reconciler Lambda (every 2 minutes).

1. Missing-event repair: a registered alarm in ALARM with no active incident
   opens one (same correlation path as ingest, so it is never a duplicate).
2. Missed OK repair: an active incident whose alarm is OK but has no
   signalClearedAt gets one.
3. Verified self-heal: alarm OK, cleared, and the independent probe reported
   HEALTHY at least two minutes after the clear -> RESOLVED.
4. Remediation backstop (remediation.reconcile): expired approvals, approvals
   the coordinator never picked up, commands with no status event.
5. Remediation verification (remediation.verify): VERIFYING -> RESOLVED only
   with 3 consecutive healthy probes after the command finished.
6. Simulation Lab watchdog (lab.watchdog): confirms fault injection, links the
   incident, ends resolved runs, resets expired ones, ends runs whose lab is gone.
It never resolves on a timeout or on missing data.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Mapping
from typing import Any

from . import core, ingest, lab, obs, remediation
from .ingest import correlation_key

logger = logging.getLogger("opsentra-incident-reconciler")
logger.setLevel(logging.INFO)


def alarm_states(cloudwatch: Any, names: list[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for i in range(0, len(names), 100):
        res = cloudwatch.describe_alarms(AlarmNames=names[i : i + 100])
        for a in res.get("MetricAlarms", []):
            ts = a.get("StateUpdatedTimestamp")
            out[a["AlarmName"]] = {"state": a["StateValue"], "at": core.iso(ts) if ts else core.now_iso()}
    return out


def run(
    store: core.Store,
    cloudwatch: Any,
    account: str,
    region: str,
    topic_arn: str,
    ssm: Any = None,
    ec2: Any = None,
) -> dict[str, Any]:
    registry = store.registry_items()
    by_alarm: dict[str, Mapping[str, Any]] = {}
    for r in registry:
        for name in r.get("alarmNames") or []:
            by_alarm[name] = r
    states = alarm_states(cloudwatch, sorted(by_alarm)) if by_alarm else {}
    report: dict[str, Any] = {"opened": 0, "cleared": 0, "resolved": 0, "checked": len(states)}
    if store.t.remediations and ssm is not None and ec2 is not None:
        try:
            report |= remediation.reconcile(store, ssm, ec2)
        except Exception:  # noqa: BLE001
            obs.error(logger, "remediation reconcile failed")
            report["errors"] = report.get("errors", 0) + 1

    # 1. Repair missed ALARM events.
    for name, st in states.items():
        if st["state"] != "ALARM":
            continue
        res = by_alarm[name]
        key = correlation_key(account, region, res["resourceId"], name)
        corr = store.correlation(key) or {}
        if corr.get("activeIncidentId"):
            continue
        out = core.open_or_update(
            store,
            correlation_key=key,
            resource=res,
            alarm_name=name,
            signal_at=st["at"],
            source="reconciler",
            detail={"note": "Opened by the reconciler: the alarm event was not received"},
        )
        if out.created and out.incident_id:
            report["opened"] += 1
            incident = store.incident(out.incident_id)
            try:
                if incident:
                    ingest.notify(topic_arn, incident)
            except Exception:  # noqa: BLE001
                obs.error(logger, "notification failed", incidentId=out.incident_id)

    # 2 and 3. Active incidents: missed OK, then verified self-heal.
    registry_by_id = {r["resourceId"]: r for r in registry}
    for corr in store.active_correlations():
        try:
            _active(store, corr, states, registry_by_id, report)
        except Exception:  # noqa: BLE001 - one bad incident must not block the rest
            obs.error(logger, "reconcile failed", incidentId=corr.get("activeIncidentId"))
            report["errors"] = report.get("errors", 0) + 1

    # 6. Simulation Lab watchdog, after incidents so a resolution ends its run.
    if store.t.lab_runs and ssm is not None and ec2 is not None:
        try:
            report |= lab.watchdog(store, ssm, ec2)
        except Exception:  # noqa: BLE001
            obs.error(logger, "lab watchdog failed")
            report["errors"] = report.get("errors", 0) + 1
    return report


def _active(
    store: core.Store,
    corr: Mapping[str, Any],
    states: dict[str, dict[str, Any]],
    registry_by_id: dict[str, Mapping[str, Any]],
    report: dict[str, Any],
) -> None:
    incident = store.incident(corr["activeIncidentId"])
    if not incident or incident.get("state") not in core.ACTIVE:
        return
    st = states.get(str(incident.get("alarmName", "")))
    if incident.get("state") == "VERIFYING" and store.t.remediations:
        res = registry_by_id.get(incident["resourceId"])
        if remediation.verify(store, incident, res, bool(st and st["state"] == "OK")) == "resolved":
            report["resolved"] += 1
        return
    if not st or st["state"] != "OK":
        return
    if not incident.get("signalClearedAt"):
        out = core.mark_cleared(
            store,
            correlation_key=incident["correlationKey"],
            alarm_name=incident["alarmName"],
            signal_at=st["at"],
            source="reconciler",
        )
        if out.result == "cleared":
            report["cleared"] += 1
        return
    res = registry_by_id.get(incident["resourceId"]) or {}
    if res.get("health") == "HEALTHY" and res.get("lastCheckedAt"):
        if core.resolve_verified(store, incident, str(res["lastCheckedAt"])):
            report["resolved"] += 1


def lambda_handler(event: Any, context: Any) -> dict[str, Any]:
    import boto3

    obs.bind(context)
    store = core.Store(boto3.client("dynamodb"), core.Tables.from_env())
    report = run(
        store,
        boto3.client("cloudwatch"),
        os.environ["ACCOUNT_ID"],
        os.environ["AWS_REGION"],
        os.environ.get("ALERT_TOPIC_ARN", ""),
        boto3.client("ssm"),
        boto3.client("ec2"),
    )
    obs.info(logger, "reconcile", **report)
    return report
