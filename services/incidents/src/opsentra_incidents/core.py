"""Incident persistence shared by the ingest Lambda, the reconciler and the API
(blueprint §4.3, §4.4). One implementation of correlation, the state machine
and the append-only audit trail.

Tables (names from the environment):
  incidents            PK incidentId
  audit                PK INCIDENT#<id> | EVENT#<eventId> | IDEMPOTENCY#<key>, SK
  active-correlations  PK correlationKey; activeIncidentId while active,
                       lastResolvedAt after a verified resolution
  remediations         PK requestId (Phase 6, see remediation.py)

Invariants enforced with conditional writes and transactions:
  * exactly one active incident per correlation key;
  * a delivered event is processed once (EVENT#<id> marker);
  * an ALARM older than the last resolved episode never reopens it;
  * every state change is conditional on the expected version and appends
    an audit item in the same transaction;
  * nothing here deletes audit items.
"""

from __future__ import annotations

import json
import os
import secrets
import time
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

ACTIVE = ("OPEN", "ACKNOWLEDGED", "INVESTIGATING", "AWAITING_APPROVAL", "REMEDIATING", "VERIFYING", "ESCALATED")
SELF_HEALABLE = ("OPEN", "ACKNOWLEDGED", "INVESTIGATING", "ESCALATED")
ROLE_RANK = {"VIEWER": 0, "OPERATOR": 1, "ADMIN": 2}

# User commands (subset of apps/dashboard/src/domain/incident-machine.ts; remediation
# commands live in remediation.py).
USER_TRANSITIONS: dict[str, tuple[tuple[str, ...], str, str, str]] = {
    # command: (from states, to state, minimum role, audit action)
    "acknowledge": (("OPEN",), "ACKNOWLEDGED", "OPERATOR", "INCIDENT_ACKNOWLEDGED"),
    "investigate": (("ACKNOWLEDGED",), "INVESTIGATING", "OPERATOR", "INVESTIGATION_STARTED"),
    "close": (("RESOLVED",), "CLOSED", "OPERATOR", "INCIDENT_CLOSED"),
}

EVENT_TTL_DAYS = 7
IDEMPOTENCY_TTL_HOURS = 24
SELF_HEAL_DELAY = timedelta(minutes=2)


class IncidentError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


@dataclass(frozen=True)
class Tables:
    incidents: str
    audit: str
    correlations: str
    resources: str
    remediations: str = ""

    @staticmethod
    def from_env() -> Tables:
        e = os.environ
        return Tables(
            incidents=e.get("INCIDENTS_TABLE", ""),
            audit=e.get("AUDIT_TABLE", ""),
            correlations=e.get("CORRELATIONS_TABLE", ""),
            resources=e.get("RESOURCES_TABLE", ""),
            remediations=e.get("REMEDIATIONS_TABLE", ""),
        )


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_iso(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError("timestamp must include a timezone")
    return dt.astimezone(UTC)


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def new_incident_id(at: str) -> str:
    return f"INC-{at[:10].replace('-', '')}-{secrets.token_hex(3).upper()}"


def _ttl(days: float) -> str:
    return str(int(time.time() + days * 86400))


# ---------------------------------------------------------------- codec ---


def ser(value: Any) -> dict[str, Any]:
    from boto3.dynamodb.types import TypeSerializer

    return TypeSerializer().serialize(value)


def ser_item(item: Mapping[str, Any]) -> dict[str, Any]:
    return {k: ser(v) for k, v in item.items() if v is not None}


def de_item(item: Mapping[str, Any]) -> dict[str, Any]:
    from boto3.dynamodb.types import TypeDeserializer

    d = TypeDeserializer()
    out = {k: d.deserialize(v) for k, v in item.items()}
    return {k: int(v) if type(v).__name__ == "Decimal" else v for k, v in out.items()}


def _cancel_reasons(err: Exception) -> list[str]:
    resp = getattr(err, "response", {}) or {}
    return [r.get("Code", "None") for r in resp.get("CancellationReasons", [])]


def _is(err: Exception, code: str) -> bool:
    resp = getattr(err, "response", {}) or {}
    return resp.get("Error", {}).get("Code") == code


_last_seq = 0


def _next_seq() -> int:
    """Strictly increasing within a process, even when the clock repeats a value
    (Windows time_ns resolution), so items written together keep their order."""
    global _last_seq
    _last_seq = max(time.time_ns(), _last_seq + 1)
    return _last_seq


# ---------------------------------------------------------------- store ---


class Store:
    def __init__(self, client: Any, tables: Tables) -> None:
        self.c = client
        self.t = tables

    # -- reads
    def get(self, table: str, key: Mapping[str, str]) -> dict[str, Any] | None:
        res = self.c.get_item(TableName=table, Key={k: {"S": v} for k, v in key.items()}, ConsistentRead=True)
        return de_item(res["Item"]) if "Item" in res else None

    def incident(self, incident_id: str) -> dict[str, Any] | None:
        return self.get(self.t.incidents, {"incidentId": incident_id})

    def correlation(self, key: str) -> dict[str, Any] | None:
        return self.get(self.t.correlations, {"correlationKey": key})

    def registry_by_alarm(self, alarm_name: str) -> dict[str, Any] | None:
        res = self.c.scan(
            TableName=self.t.resources,
            FilterExpression="contains(alarmNames, :n)",
            ExpressionAttributeValues={":n": {"S": alarm_name}},
        )
        items = [de_item(i) for i in res.get("Items", [])]
        return items[0] if len(items) == 1 else None

    def registry_items(self) -> list[dict[str, Any]]:
        return [de_item(i) for i in self.c.scan(TableName=self.t.resources).get("Items", [])]

    def active_correlations(self) -> list[dict[str, Any]]:
        res = self.c.scan(TableName=self.t.correlations, FilterExpression="attribute_exists(activeIncidentId)")
        return [de_item(i) for i in res.get("Items", [])]

    # -- audit item (doubles as a timeline event)
    def audit_put(
        self,
        incident_id: str,
        at: str,
        event_type: str,
        *,
        correlation_id: str,
        actor_id: str | None = None,
        previous: str | None = None,
        new: str | None = None,
        detail: Mapping[str, Any] | None = None,
        outcome: str = "SUCCESS",
        target_type: str = "INCIDENT",
        target_id: str | None = None,
    ) -> dict[str, Any]:
        item = {
            "PK": f"INCIDENT#{incident_id}",
            # Monotonic within the same second, unique across writers.
            "SK": f"{at}#{_next_seq():020d}{secrets.token_hex(3)}",
            "occurredAt": at,
            "eventType": event_type,
            "action": event_type,
            "actorType": "USER" if actor_id else "SYSTEM",
            "actorId": actor_id,
            "targetType": target_type,
            "targetId": target_id or incident_id,
            "correlationId": correlation_id,
            "previousState": previous,
            "newState": new,
            "outcome": outcome,
            "detail": dict(detail or {}),
        }
        return {
            "Put": {
                "TableName": self.t.audit,
                "Item": ser_item(item),
                "ConditionExpression": "attribute_not_exists(PK)",  # append-only
            }
        }

    # -- delivery dedup
    def mark_event_once(self, event_id: str) -> bool:
        try:
            self.c.put_item(
                TableName=self.t.audit,
                Item=ser_item({"PK": f"EVENT#{event_id}", "SK": "EVENT", "ttl": int(_ttl(EVENT_TTL_DAYS))}),
                ConditionExpression="attribute_not_exists(PK)",
            )
            return True
        except Exception as err:
            if _is(err, "ConditionalCheckFailedException"):
                return False
            raise


# ------------------------------------------------------- signal handling ---


@dataclass
class Outcome:
    result: str  # opened | repeated | stale | cleared | ignored
    incident_id: str | None = None
    created: bool = False


def open_or_update(
    store: Store,
    *,
    correlation_key: str,
    resource: Mapping[str, Any],
    alarm_name: str,
    signal_at: str,
    source: str,
    detail: Mapping[str, Any],
) -> Outcome:
    """ALARM: open exactly one incident per active condition."""
    received = now_iso()
    incident_id = new_incident_id(signal_at)
    titles = resource.get("alarmTitles") or {}
    incident = {
        "incidentId": incident_id,
        "correlationKey": correlation_key,
        "resourceId": resource["resourceId"],
        "title": titles.get(alarm_name) or f"{alarm_name} in ALARM",
        "severity": resource.get("severity", "HIGH"),
        "state": "OPEN",
        "version": 1,
        "openedAt": received,
        "detectedAt": signal_at,
        "receivedAt": received,
        "lastSignalAt": signal_at,
        "alarmName": alarm_name,
        "source": source,
    }
    try:
        store.c.transact_write_items(
            TransactItems=[
                {
                    "Update": {
                        "TableName": store.t.correlations,
                        "Key": {"correlationKey": {"S": correlation_key}},
                        "UpdateExpression": "SET activeIncidentId = :id, openedAt = :o",
                        "ConditionExpression": (
                            "attribute_not_exists(activeIncidentId) AND "
                            "(attribute_not_exists(lastResolvedAt) OR lastResolvedAt < :sig)"
                        ),
                        "ExpressionAttributeValues": {
                            ":id": {"S": incident_id},
                            ":o": {"S": received},
                            ":sig": {"S": signal_at},
                        },
                    }
                },
                {
                    "Put": {
                        "TableName": store.t.incidents,
                        "Item": ser_item(incident),
                        "ConditionExpression": "attribute_not_exists(incidentId)",
                    }
                },
                store.audit_put(
                    incident_id,
                    signal_at,
                    "ALARM_STATE_CHANGED",
                    correlation_id=correlation_key,
                    detail={"alarm": alarm_name, "to": "ALARM", "source": source, **detail},
                ),
                store.audit_put(
                    incident_id,
                    received,
                    "INCIDENT_OPENED",
                    correlation_id=correlation_key,
                    new="OPEN",
                    detail={"severity": incident["severity"]},
                ),
            ]
        )
        return Outcome("opened", incident_id, created=True)
    except Exception as err:
        if not _is(err, "TransactionCanceledException"):
            raise

    corr = store.correlation(correlation_key) or {}
    active_id = corr.get("activeIncidentId")
    if not active_id:
        # Older than the last verified resolution: never reopen (§4.4).
        return Outcome("stale")
    active = store.incident(active_id) or {}
    delayed = signal_at < str(active.get("lastSignalAt", ""))
    items: list[dict[str, Any]] = [
        store.audit_put(
            active_id,
            signal_at,
            "ALARM_REPEATED",
            correlation_id=correlation_key,
            detail={"alarm": alarm_name, "deduplicated": True, "delayed": delayed, "source": source, **detail},
        )
    ]
    if not delayed:
        items.append(
            {
                "Update": {
                    "TableName": store.t.incidents,
                    "Key": {"incidentId": {"S": active_id}},
                    "UpdateExpression": "SET lastSignalAt = :s REMOVE signalClearedAt",
                    "ConditionExpression": "attribute_exists(incidentId)",
                    "ExpressionAttributeValues": {":s": {"S": signal_at}},
                }
            }
        )
    store.c.transact_write_items(TransactItems=items)
    return Outcome("repeated", active_id)


def mark_cleared(store: Store, *, correlation_key: str, alarm_name: str, signal_at: str, source: str) -> Outcome:
    """OK: record that the signal cleared. Never resolves (verified self-heal does that)."""
    corr = store.correlation(correlation_key) or {}
    active_id = corr.get("activeIncidentId")
    if not active_id:
        return Outcome("ignored")
    active = store.incident(active_id) or {}
    if signal_at < str(active.get("lastSignalAt", "")):
        return Outcome("stale", active_id)  # an OK older than the latest ALARM
    store.c.transact_write_items(
        TransactItems=[
            {
                "Update": {
                    "TableName": store.t.incidents,
                    "Key": {"incidentId": {"S": active_id}},
                    "UpdateExpression": "SET signalClearedAt = :c",
                    "ConditionExpression": "attribute_exists(incidentId)",
                    "ExpressionAttributeValues": {":c": {"S": signal_at}},
                }
            },
            store.audit_put(
                active_id,
                signal_at,
                "ALARM_CLEARED",
                correlation_id=correlation_key,
                detail={"alarm": alarm_name, "to": "OK", "source": source, "note": "Not resolved until verified"},
            ),
        ]
    )
    return Outcome("cleared", active_id)


def resolve_verified(store: Store, incident: Mapping[str, Any], verified_at: str) -> bool:
    """Verified self-heal: the alarm is OK and the independent probe reported HEALTHY
    at least two minutes after the clear (owner decision, §4.4)."""
    cleared = incident.get("signalClearedAt")
    if not cleared or incident.get("state") not in SELF_HEALABLE:
        return False
    if parse_iso(verified_at) < parse_iso(cleared) + SELF_HEAL_DELAY:
        return False
    return resolve(store, incident, verified_at, {"check": "independent HTTP probe", "afterClear": cleared})


def resolve(store: Store, incident: Mapping[str, Any], verified_at: str, evidence: Mapping[str, Any]) -> bool:
    """RESOLVED after independent verification (the caller decides what counts as
    verified). Clears the active correlation and keeps lastResolvedAt."""
    now = now_iso()
    iid, corr, prev = incident["incidentId"], incident["correlationKey"], incident["state"]
    try:
        store.c.transact_write_items(
            TransactItems=[
                {
                    "Update": {
                        "TableName": store.t.incidents,
                        "Key": {"incidentId": {"S": iid}},
                        "UpdateExpression": (
                            "SET #s = :r, verifiedHealthyAt = :v, resolvedAt = :n, version = version + :one"
                        ),
                        "ConditionExpression": "version = :ver AND #s = :prev",
                        "ExpressionAttributeNames": {"#s": "state"},
                        "ExpressionAttributeValues": {
                            ":r": {"S": "RESOLVED"},
                            ":v": {"S": verified_at},
                            ":n": {"S": now},
                            ":one": {"N": "1"},
                            ":ver": {"N": str(incident["version"])},
                            ":prev": {"S": prev},
                        },
                    }
                },
                {
                    "Update": {
                        "TableName": store.t.correlations,
                        "Key": {"correlationKey": {"S": corr}},
                        "UpdateExpression": "REMOVE activeIncidentId SET lastResolvedAt = :n",
                        "ConditionExpression": "activeIncidentId = :id",
                        "ExpressionAttributeValues": {":n": {"S": now}, ":id": {"S": iid}},
                    }
                },
                store.audit_put(iid, verified_at, "HEALTH_VERIFIED", correlation_id=corr, detail=dict(evidence)),
                store.audit_put(iid, now, "INCIDENT_RESOLVED", correlation_id=corr, previous=prev, new="RESOLVED"),
            ]
        )
        return True
    except Exception as err:
        if _is(err, "TransactionCanceledException"):
            return False  # someone else changed it; the next run re-evaluates
        raise


# ---------------------------------------------------------- user actions ---


def _fingerprint(command: str, incident_id: str, body: Mapping[str, Any]) -> str:
    return json.dumps([command, incident_id, dict(body)], sort_keys=True)


def check_idempotency_key(key: str | None) -> str:
    if not key or len(key) > 128:
        raise IncidentError(400, "IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key header is required.")
    return key


def check_version(value: Any) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise IncidentError(400, "VALIDATION", "expectedVersion must be a positive integer.")
    return value


def replayed(store: Store, key: str, fingerprint: str) -> dict[str, Any] | None:
    """The stored response for a repeated request, or None for a new key."""
    seen = store.get(store.t.audit, {"PK": f"IDEMPOTENCY#{key}", "SK": "IDEMPOTENCY"})
    if not seen:
        return None
    if seen.get("fingerprint") != fingerprint:
        raise IncidentError(409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was used for another request.")
    return json.loads(seen["response"])


def remember(store: Store, key: str, fingerprint: str, response: Mapping[str, Any]) -> None:
    try:
        store.c.put_item(
            TableName=store.t.audit,
            Item=ser_item(
                {
                    "PK": f"IDEMPOTENCY#{key}",
                    "SK": "IDEMPOTENCY",
                    "fingerprint": fingerprint,
                    "response": json.dumps(response, default=str),
                    "ttl": int(_ttl(IDEMPOTENCY_TTL_HOURS / 24)),
                }
            ),
            ConditionExpression="attribute_not_exists(PK)",
        )
    except Exception as err:
        if not _is(err, "ConditionalCheckFailedException"):
            raise


def record_denied(
    store: Store,
    *,
    incident_id: str,
    action: str,
    actor: str,
    role: str,
    code: str,
    target_type: str = "INCIDENT",
    target_id: str | None = None,
) -> None:
    """Appends a DENIED audit item for a refused privileged command (§5.2). Only
    for incidents that exist, so made-up IDs cannot create audit partitions."""
    incident = store.incident(incident_id)
    if not incident:
        return
    put = store.audit_put(
        incident_id,
        now_iso(),
        f"{action}_DENIED",
        correlation_id=str(incident.get("correlationKey", "")),
        actor_id=actor,
        outcome="DENIED",
        target_type=target_type,
        target_id=target_id,
        detail={"role": role, "code": code},
    )["Put"]
    store.c.put_item(**put)


def user_transition(
    store: Store,
    *,
    incident_id: str,
    command: str,
    role: str,
    actor: str,
    expected_version: Any,
    reason: str | None,
    idempotency_key: str | None,
) -> dict[str, Any]:
    """Operator/Admin commands from the API. Role comes from verified claims only."""
    if command not in USER_TRANSITIONS:
        raise IncidentError(404, "NOT_FOUND", "No such action.")
    sources, target, min_role, action = USER_TRANSITIONS[command]
    if ROLE_RANK.get(role, -1) < ROLE_RANK[min_role]:
        raise IncidentError(403, "FORBIDDEN", f"This needs the {min_role.lower()} role.")
    idempotency_key = check_idempotency_key(idempotency_key)
    expected_version = check_version(expected_version)
    clean_reason = (reason or "").strip()[:280]
    if command == "acknowledge" and not clean_reason:
        raise IncidentError(400, "VALIDATION", "A reason is required.")

    fp = _fingerprint(command, incident_id, {"expectedVersion": expected_version, "reason": clean_reason})
    previous = replayed(store, idempotency_key, fp)
    if previous is not None:
        return previous

    incident = store.incident(incident_id)
    if not incident:
        raise IncidentError(404, "NOT_FOUND", f"Incident {incident_id} was not found.")
    if incident["version"] != expected_version:
        raise IncidentError(409, "VERSION_CONFLICT", "The incident changed since you loaded it. Refresh and retry.")
    if incident["state"] not in sources:
        raise IncidentError(409, "INVALID_STATE", f"Not allowed while the incident is {incident['state']}.")

    now = now_iso()
    sets = ["#s = :t", "version = version + :one"]
    values: dict[str, Any] = {
        ":t": {"S": target},
        ":one": {"N": "1"},
        ":ver": {"N": str(expected_version)},
        ":from": {"S": incident["state"]},
    }
    if command == "acknowledge":
        sets += ["acknowledgedAt = :now", "assignedTo = :who"]
        values |= {":now": {"S": now}, ":who": {"S": actor}}
    corr = incident["correlationKey"]
    try:
        store.c.transact_write_items(
            TransactItems=[
                {
                    "Update": {
                        "TableName": store.t.incidents,
                        "Key": {"incidentId": {"S": incident_id}},
                        "UpdateExpression": "SET " + ", ".join(sets),
                        "ConditionExpression": "version = :ver AND #s = :from",
                        "ExpressionAttributeNames": {"#s": "state"},
                        "ExpressionAttributeValues": values,
                    }
                },
                store.audit_put(
                    incident_id,
                    now,
                    action,
                    correlation_id=corr,
                    actor_id=actor,
                    previous=incident["state"],
                    new=target,
                    detail={"reason": clean_reason} if clean_reason else {},
                ),
            ]
        )
    except Exception as err:
        if _is(err, "TransactionCanceledException"):
            raise IncidentError(409, "VERSION_CONFLICT", "The incident changed. Refresh and retry.") from err
        raise

    updated = store.incident(incident_id) or {}
    response = {"status": 200, "incident": updated}
    remember(store, idempotency_key, fp, response)
    return response
