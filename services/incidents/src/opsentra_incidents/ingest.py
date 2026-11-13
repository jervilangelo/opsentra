"""Incident ingest Lambda: EventBridge -> validated, deduplicated incidents.

Only CloudWatch alarm state changes from this account and region, for alarms
registered on an allowlisted resource, are accepted. Anything else is logged
and dropped without a write.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Mapping
from typing import Any

from . import core, obs

logger = logging.getLogger("opsentra-incident-ingest")
logger.setLevel(logging.INFO)

ACCEPTED_STATES = {"ALARM", "OK", "INSUFFICIENT_DATA"}


class Rejected(Exception):
    pass


def validate(event: Mapping[str, Any], account: str, region: str) -> dict[str, str]:
    """Returns the fields the ingest needs, or raises Rejected."""
    if not isinstance(event, Mapping):
        raise Rejected("not an object")
    if event.get("source") != "aws.cloudwatch" or event.get("detail-type") != "CloudWatch Alarm State Change":
        raise Rejected("unexpected source")
    if event.get("account") != account or event.get("region") != region:
        raise Rejected("foreign account or region")
    detail = event.get("detail")
    if not isinstance(detail, Mapping):
        raise Rejected("missing detail")
    state = (detail.get("state") or {}) if isinstance(detail.get("state"), Mapping) else {}
    alarm = detail.get("alarmName")
    value = state.get("value")
    ts = state.get("timestamp") or event.get("time")
    event_id = event.get("id")
    if not (isinstance(alarm, str) and alarm and isinstance(event_id, str) and event_id):
        raise Rejected("missing alarm name or event id")
    if value not in ACCEPTED_STATES:
        raise Rejected("unexpected state")
    try:
        signal_at = core.iso(core.parse_iso(str(ts)))
    except (ValueError, TypeError) as err:
        raise Rejected("bad timestamp") from err
    return {"alarm": alarm, "state": value, "signalAt": signal_at, "eventId": event_id[:128]}


def correlation_key(account: str, region: str, resource_id: str, alarm: str) -> str:
    # The account is verified on ingest but kept out of the key: correlation
    # keys reach API clients and screenshots, account IDs must not (§4.2).
    del account
    return f"{region}:{resource_id}:{alarm}"


def notify(topic_arn: str, incident: Mapping[str, Any]) -> None:
    """One email per new incident. No account IDs or ARNs in the message."""
    if not topic_arn:
        return
    import boto3

    sev = {"CRITICAL": "SEV-1", "HIGH": "SEV-2", "MEDIUM": "SEV-3", "LOW": "SEV-4"}.get(incident["severity"], "SEV-?")
    body = (
        f"Opsentra opened an incident.\n\n"
        f"Incident:  {incident['incidentId']}\n"
        f"Title:     {incident['title']}\n"
        f"Severity:  {sev} ({incident['severity']})\n"
        f"Resource:  {incident['resourceId']}\n"
        f"Detected:  {incident['detectedAt']} (UTC)\n\n"
        "Open the Opsentra dashboard in Live AWS Mode to acknowledge it.\n"
    )
    boto3.client("sns").publish(
        TopicArn=topic_arn,
        Subject=f"[Opsentra] {sev} incident opened: {incident['title']}"[:100],
        Message=body,
    )


def handle(event: Mapping[str, Any], store: core.Store, account: str, region: str, topic_arn: str) -> dict[str, Any]:
    try:
        v = validate(event, account, region)
    except Rejected as err:
        return {"result": "rejected", "why": str(err)}

    resource = store.registry_by_alarm(v["alarm"])
    if not resource:
        return {"result": "rejected", "why": "alarm not registered"}
    if v["state"] == "INSUFFICIENT_DATA":
        return {"result": "ignored", "why": "insufficient data is not a signal"}
    if not store.mark_event_once(v["eventId"]):
        return {"result": "duplicate"}

    key = correlation_key(account, region, resource["resourceId"], v["alarm"])
    if v["state"] == "ALARM":
        out = core.open_or_update(
            store,
            correlation_key=key,
            resource=resource,
            alarm_name=v["alarm"],
            signal_at=v["signalAt"],
            source="eventbridge",
            detail={"eventId": v["eventId"]},
        )
        if out.created and out.incident_id:
            incident = store.incident(out.incident_id)
            try:
                if incident:
                    notify(topic_arn, incident)
            except Exception:  # noqa: BLE001 — a failed email never undoes the incident
                obs.error(logger, "notification failed", incidentId=out.incident_id, correlationKey=key)
    else:
        out = core.mark_cleared(
            store, correlation_key=key, alarm_name=v["alarm"], signal_at=v["signalAt"], source="eventbridge"
        )
    return {"result": out.result, "incidentId": out.incident_id, "created": out.created}


_store: core.Store | None = None


def _get_store() -> core.Store:
    global _store
    if _store is None:
        import boto3

        _store = core.Store(boto3.client("dynamodb"), core.Tables.from_env())
    return _store


if os.environ.get("INCIDENTS_TABLE"):
    try:
        _get_store()  # warm at init (boosted CPU)
    except Exception:  # noqa: BLE001
        _store = None


def lambda_handler(event: Any, context: Any) -> dict[str, Any]:
    obs.bind(context)
    outcome = handle(
        event,
        _get_store(),
        os.environ["ACCOUNT_ID"],
        os.environ["AWS_REGION"],
        os.environ.get("ALERT_TOPIC_ARN", ""),
    )
    detail = event.get("detail") if isinstance(event, dict) and isinstance(event.get("detail"), dict) else {}
    obs.info(
        logger,
        "ingest",
        eventId=event.get("id") if isinstance(event, dict) else None,
        alarmName=detail.get("alarmName"),
        **outcome,
    )
    return outcome
