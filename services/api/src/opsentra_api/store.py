"""Read access to the control-plane DynamoDB tables (blueprint §4.3).

Reads only: writes go through opsentra_incidents (core, remediation). Responses are shaped as the frontend DTOs
(apps/dashboard/src/types/domain.ts). ARNs and account details are never
returned to the client (§4.2).
"""

from __future__ import annotations

import os
from collections.abc import Iterator, Mapping
from typing import Any, Protocol

ACTIVE_STATES = frozenset(
    {"OPEN", "ACKNOWLEDGED", "INVESTIGATING", "AWAITING_APPROVAL", "REMEDIATING", "VERIFYING", "ESCALATED"}
)
HEALTH_VALUES = ("HEALTHY", "DEGRADED", "UNHEALTHY", "UNKNOWN")
SEVERITIES = ("CRITICAL", "HIGH", "MEDIUM", "LOW")
MAX_ITEMS = 500


class Store(Protocol):
    def scan(self, table: str) -> Iterator[dict[str, Any]]: ...
    def get(self, table: str, key: Mapping[str, Any]) -> dict[str, Any] | None: ...
    def query_pk(self, table: str, pk_name: str, pk_value: str) -> list[dict[str, Any]]: ...


def plain(value: Any) -> Any:
    """DynamoDB numbers arrive as Decimal at any depth (e.g. an audit item's
    detail map), and json.dumps rejects Decimal. Whole numbers become int,
    others float; maps, lists and sets are converted recursively."""
    if type(value).__name__ == "Decimal":
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, Mapping):
        return {k: plain(v) for k, v in value.items()}
    if isinstance(value, list | set | tuple):
        return [plain(v) for v in value]
    return value


class DynamoStore:
    """boto3-backed store (boto3 ships in the Lambda runtime)."""

    def __init__(self) -> None:
        import boto3
        from boto3.dynamodb.types import TypeDeserializer

        self._client = boto3.client("dynamodb")
        self._de = TypeDeserializer()

    def _plain(self, item: Mapping[str, Any]) -> dict[str, Any]:
        return {k: plain(self._de.deserialize(v)) for k, v in item.items()}

    def scan(self, table: str) -> Iterator[dict[str, Any]]:
        kwargs: dict[str, Any] = {"TableName": table}
        seen = 0
        while True:
            page = self._client.scan(**kwargs)
            for item in page.get("Items", []):
                seen += 1
                if seen > MAX_ITEMS:
                    return
                yield self._plain(item)
            if "LastEvaluatedKey" not in page:
                return
            kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    def get(self, table: str, key: Mapping[str, Any]) -> dict[str, Any] | None:
        res = self._client.get_item(TableName=table, Key={k: {"S": str(v)} for k, v in key.items()})
        item = res.get("Item")
        return self._plain(item) if item else None

    def query_pk(self, table: str, pk_name: str, pk_value: str) -> list[dict[str, Any]]:
        res = self._client.query(
            TableName=table,
            KeyConditionExpression="#pk = :pk",
            ExpressionAttributeNames={"#pk": pk_name},
            ExpressionAttributeValues={":pk": {"S": pk_value}},
            Limit=MAX_ITEMS,
        )
        return [self._plain(i) for i in res.get("Items", [])]


def tables() -> dict[str, str]:
    return {
        "resources": os.environ.get("RESOURCES_TABLE", ""),
        "incidents": os.environ.get("INCIDENTS_TABLE", ""),
        "audit": os.environ.get("AUDIT_TABLE", ""),
        "remediations": os.environ.get("REMEDIATIONS_TABLE", ""),
    }


# ---------------------------------------------------------------------------
# Shaping (DynamoDB item -> DTO). Only listed fields leave the API.


def _opt(src: Mapping[str, Any], out: dict[str, Any], key: str, as_key: str | None = None) -> None:
    value = src.get(key)
    if value not in (None, ""):
        out[as_key or key] = value


def resource_dto(item: Mapping[str, Any]) -> dict[str, Any]:
    health = item.get("health")
    out: dict[str, Any] = {
        "id": item["resourceId"],
        "type": item.get("type", "EC2"),
        "environment": item.get("environment", "lab"),
        "region": item.get("region", "ap-southeast-1"),
        "health": health if health in HEALTH_VALUES else "UNKNOWN",
        "evidenceAvailable": bool(item.get("lastCheckedAt")),
    }
    _opt(item, out, "lastCheckedAt")
    return out


def incident_dto(item: Mapping[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": item["incidentId"],
        "correlationKey": item.get("correlationKey", ""),
        "resourceId": item.get("resourceId", ""),
        "title": item.get("title", "Incident"),
        "severity": item.get("severity") if item.get("severity") in SEVERITIES else "MEDIUM",
        "state": item.get("state", "OPEN"),
        "openedAt": item.get("openedAt", ""),
        "version": int(item.get("version", 1)),
    }
    for key in ("detectedAt", "acknowledgedAt", "verifiedHealthyAt", "resolvedAt", "runbookId"):
        _opt(item, out, key)
    return out


def timeline_dto(item: Mapping[str, Any], incident_id: str) -> dict[str, Any]:
    sk = str(item.get("SK", ""))
    out: dict[str, Any] = {
        "id": sk,
        "incidentId": incident_id,
        "occurredAt": item.get("occurredAt") or sk.split("#", 1)[0],
        "eventType": item.get("eventType", "EVENT"),
        "actorType": "USER" if item.get("actorType") == "USER" else "SYSTEM",
        "detail": item.get("detail") if isinstance(item.get("detail"), dict) else {},
    }
    _opt(item, out, "actorId")
    return out


def overview(resources: list[dict[str, Any]], incidents: list[dict[str, Any]]) -> dict[str, Any]:
    health_counts = dict.fromkeys(HEALTH_VALUES, 0)
    for r in resources:
        health_counts[r["health"]] += 1
    active = [i for i in incidents if i["state"] in ACTIVE_STATES]
    by_sev = dict.fromkeys(SEVERITIES, 0)
    for i in active:
        by_sev[i["severity"]] += 1
    out: dict[str, Any] = {
        "monitoredResources": len(resources),
        "healthCounts": health_counts,
        "activeIncidents": len(active),
        "activeBySeverity": by_sev,
    }
    checked = sorted((r["lastCheckedAt"] for r in resources if r.get("lastCheckedAt")), reverse=True)
    if checked:
        out["lastSyncAt"] = checked[0]
    return out


def audit_dto(item: Mapping[str, Any]) -> dict[str, Any]:
    """An audit item as the frontend AuditEvent. No account IDs are stored in it."""
    out: dict[str, Any] = {
        "id": str(item.get("SK", "")),
        "occurredAt": item.get("occurredAt", ""),
        "actorType": "USER" if item.get("actorType") == "USER" else "SYSTEM",
        "action": item.get("action") or item.get("eventType", "EVENT"),
        "targetType": item.get("targetType", "INCIDENT"),
        "targetId": item.get("targetId") or str(item.get("PK", "")).removeprefix("INCIDENT#"),
        "correlationId": item.get("correlationId", ""),
        "outcome": item.get("outcome", "SUCCESS"),
        "detail": item.get("detail") if isinstance(item.get("detail"), dict) else {},
    }
    for key in ("actorId", "previousState", "newState"):
        _opt(item, out, key)
    return out


REMEDIATION_STATES = ("PENDING", "APPROVED", "REJECTED", "RUNNING", "SUCCEEDED", "FAILED")


def remediation_dto(item: Mapping[str, Any]) -> dict[str, Any]:
    """A remediation request as the frontend RemediationRequest. The document hash,
    command output and anything account-specific stay server-side."""
    status = item.get("status")
    out: dict[str, Any] = {
        "requestId": item["requestId"],
        "actionKey": item.get("actionKey", ""),
        "incidentId": item.get("incidentId", ""),
        "resourceId": item.get("resourceId", ""),
        "requestedBy": item.get("requestedBy", ""),
        "status": status if status in REMEDIATION_STATES else "FAILED",
        "expectedVersion": int(item.get("expectedVersion", 1)),
        "requestedAt": item.get("requestedAt", ""),
        "expiresAt": item.get("expiresAt", ""),
    }
    for key in ("approvedBy", "executionId", "errorSummary", "decidedAt", "completedAt"):
        _opt(item, out, key)
    if item.get("selfApproved") is True:
        out["selfApproved"] = True
    return out


def runbook_dto(rb: Any, resource_ids: list[str]) -> dict[str, Any]:
    return {
        "id": rb.id,
        "version": rb.version,
        "title": rb.title,
        "description": rb.description,
        "actionKey": rb.action_key,
        "applicableResourceIds": resource_ids,
        "requiresApproval": True,
    }
