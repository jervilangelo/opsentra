"""Opsentra HTTP API Lambda handler (API Gateway HTTP API, payload format 2.0).

Routes (blueprint §4.2). Everything except /v1/health needs a Cognito access
token; the read routes need at least the viewer role.
  GET /v1/health                         public heartbeat, no resource discovery
  GET /v1/me                             identity, role, permitted actions
  GET /v1/overview                       counts and last sync
  GET /v1/resources[/{id}]               registered resources and their health
  GET /v1/incidents[/{id}[/timeline]]    incidents and their timelines
  POST /v1/incidents/{id}/acknowledge|investigate|close          Operator+
  POST /v1/incidents/{id}/request-remediation                    Operator+
  POST /v1/remediations/{id}/decision                            Admin
  GET /v1/remediations[?incidentId=], /v1/remediations/{id}      Viewer+
  GET /v1/runbooks                                                Viewer+
  GET /v1/audit                                                   Admin
  GET /v1/labs, POST /v1/labs/{id}/start|reset                    Admin (ADR-018)

Responses are `{data, meta}` on success and `{error: {code, message, requestId}}`
on failure. Timestamps are ISO-8601 UTC. Errors never include stack traces.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import re
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from typing import Any

from . import store
from .authz import PERMITTED_ACTIONS, AuthError, require_identity, require_role

SERVICE = "opsentra-api"
VERSION = os.environ.get("OPSENTRA_VERSION", "0.3.0")
ENVIRONMENT = os.environ.get("OPSENTRA_ENVIRONMENT", "dev")

logger = logging.getLogger(SERVICE)
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

Response = dict[str, Any]


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _request_id(event: Mapping[str, Any], context: Any) -> str:
    rid = (event.get("requestContext") or {}).get("requestId")
    return str(rid or getattr(context, "aws_request_id", "") or "unknown")


def _json(status: int, body: Mapping[str, Any]) -> Response:
    return {
        "statusCode": status,
        "headers": {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
        },
        "body": json.dumps(body, separators=(",", ":")),
    }


def ok(data: Any, request_id: str) -> Response:
    return _json(200, {"data": data, "meta": {"requestId": request_id, "generatedAt": _now(), "dataset": "live"}})


def error(status: int, code: str, message: str, request_id: str) -> Response:
    return _json(status, {"error": {"code": code, "message": message, "requestId": request_id}})


def _log(level: int, message: str, **fields: Any) -> None:
    # Structured JSON log line. Never log tokens, headers or bodies.
    logger.log(level, json.dumps({"msg": message, "service": SERVICE, **fields}, default=str))


def health(event: Mapping[str, Any], request_id: str, **_: str) -> Response:
    return ok({"status": "ok", "service": SERVICE, "version": VERSION, "time": _now()}, request_id)


def me(event: Mapping[str, Any], request_id: str, **_: str) -> Response:
    claims, role = require_identity(event)
    return ok(
        {
            "sub": claims.get("sub"),
            "username": claims.get("username"),
            "role": role,
            "permittedActions": list(PERMITTED_ACTIONS[role]),
            "environment": ENVIRONMENT,
        },
        request_id,
    )


class NotFound(Exception):
    pass


_store: store.Store | None = None


def get_store() -> store.Store:
    global _store
    if _store is None:
        _store = store.DynamoStore()
    return _store


def _warm() -> None:
    """Create the AWS client during Lambda init, which runs with boosted CPU,
    instead of inside the first request (a cold boto3 import at 128 MB took
    over 5 s). Skipped when no table is configured (tests, local runs)."""
    global _store
    if os.environ.get("RESOURCES_TABLE") and _store is None:
        try:
            _store = store.DynamoStore()
        except Exception:  # noqa: BLE001 — fall back to lazy creation
            _store = None


_warm()


def set_store(s: store.Store | None) -> None:
    """Tests inject a stub store."""
    global _store
    _store = s


def _viewer(event: Mapping[str, Any]) -> None:
    _, role = require_identity(event)
    require_role(role, "VIEWER")


def _resources() -> list[dict[str, Any]]:
    items = [store.resource_dto(i) for i in get_store().scan(store.tables()["resources"]) if i.get("resourceId")]
    return sorted(items, key=lambda r: (r["type"], r["id"]))


def _incidents() -> list[dict[str, Any]]:
    items = [store.incident_dto(i) for i in get_store().scan(store.tables()["incidents"]) if i.get("incidentId")]
    return sorted(items, key=lambda i: i["openedAt"], reverse=True)


def overview(event: Mapping[str, Any], request_id: str, **_: str) -> Response:
    _viewer(event)
    return ok(store.overview(_resources(), _incidents()), request_id)


def list_resources(event: Mapping[str, Any], request_id: str, **_: str) -> Response:
    _viewer(event)
    return ok(_resources(), request_id)


def get_resource(event: Mapping[str, Any], request_id: str, resource_id: str = "", **_: str) -> Response:
    _viewer(event)
    item = get_store().get(store.tables()["resources"], {"resourceId": resource_id})
    if not item:
        raise NotFound(f"Resource {resource_id} was not found.")
    return ok(store.resource_dto(item), request_id)


def list_incidents(event: Mapping[str, Any], request_id: str, **_: str) -> Response:
    """Filters: state=ACTIVE|<STATE>, severity=<SEVERITY>; limit (1-200, default 50);
    nextToken is an opaque offset returned by the previous page."""
    _viewer(event)
    q = event.get("queryStringParameters") or {}
    rows = _incidents()
    state = str(q.get("state", "")).upper()
    if state == "ACTIVE":
        rows = [r for r in rows if r["state"] in store.ACTIVE_STATES]
    elif state:
        rows = [r for r in rows if r["state"] == state]
    severity = str(q.get("severity", "")).upper()
    if severity:
        rows = [r for r in rows if r["severity"] == severity]
    try:
        limit = max(1, min(200, int(q.get("limit", 50))))
        offset = int(base64.urlsafe_b64decode(str(q["nextToken"]).encode()).decode()) if q.get("nextToken") else 0
    except (ValueError, TypeError, binascii.Error) as err:
        raise BadRequest("Invalid limit or nextToken.") from err
    page = rows[offset : offset + limit]
    resp = ok(page, request_id)
    if offset + limit < len(rows):
        body = json.loads(resp["body"])
        body["meta"]["nextToken"] = base64.urlsafe_b64encode(str(offset + limit).encode()).decode()
        resp = _json(200, body)
    return resp


def get_incident(event: Mapping[str, Any], request_id: str, incident_id: str = "", **_: str) -> Response:
    _viewer(event)
    item = get_store().get(store.tables()["incidents"], {"incidentId": incident_id})
    if not item:
        raise NotFound(f"Incident {incident_id} was not found.")
    return ok(store.incident_dto(item), request_id)


def incident_timeline(event: Mapping[str, Any], request_id: str, incident_id: str = "", **_: str) -> Response:
    _viewer(event)
    if not get_store().get(store.tables()["incidents"], {"incidentId": incident_id}):
        raise NotFound(f"Incident {incident_id} was not found.")
    items = get_store().query_pk(store.tables()["audit"], "PK", f"INCIDENT#{incident_id}")
    events = sorted((store.timeline_dto(i, incident_id) for i in items), key=lambda e: e["occurredAt"])
    return ok(events, request_id)


class BadRequest(Exception):
    pass


_incident_store: Any = None


def incident_store() -> Any:
    """Writer for incident actions (opsentra_incidents.core), created lazily."""
    global _incident_store
    if _incident_store is None:
        import boto3
        from opsentra_incidents import core

        _incident_store = core.Store(boto3.client("dynamodb"), core.Tables.from_env())
    return _incident_store


def set_incident_store(s: Any) -> None:
    global _incident_store
    _incident_store = s


def _body(event: Mapping[str, Any]) -> dict[str, Any]:
    try:
        body = json.loads(event.get("body") or "{}")
    except ValueError as err:
        raise BadRequest("The body must be a JSON object.") from err
    if not isinstance(body, dict):
        raise BadRequest("The body must be a JSON object.")
    return body


def _caller(event: Mapping[str, Any]) -> tuple[str, str, str | None]:
    """(actor, role, idempotency key). Role and actor come from verified claims only."""
    claims, role = require_identity(event)
    headers = {str(k).lower(): v for k, v in (event.get("headers") or {}).items()}
    return str(claims.get("username") or claims.get("sub")), role, headers.get("idempotency-key")


def _denied(err: Any, incident_id: str, action: str, actor: str, role: str, **target: str) -> None:
    """403/409 on a privileged command is recorded as a DENIED audit item (§5.2)."""
    if err.status not in (403, 409):
        return
    from opsentra_incidents import core

    try:
        core.record_denied(
            incident_store(), incident_id=incident_id, action=action, actor=actor, role=role, code=err.code, **target
        )
    except Exception:  # noqa: BLE001 - the refusal stands even if the audit write fails
        logger.exception(json.dumps({"msg": "denied-audit failed"}))


def _incident_action(command: str) -> Callable[..., Response]:
    def action(event: Mapping[str, Any], request_id: str, incident_id: str = "", **_: str) -> Response:
        from opsentra_incidents import core

        actor, role, key = _caller(event)
        body = _body(event)
        try:
            result = core.user_transition(
                incident_store(),
                incident_id=incident_id,
                command=command,
                role=role,  # from verified claims only; any role in the body is ignored
                actor=actor,
                expected_version=body.get("expectedVersion"),
                reason=body.get("reason") if isinstance(body.get("reason"), str) else None,
                idempotency_key=key,
            )
        except core.IncidentError as err:
            _denied(err, incident_id, command.upper(), actor, role)
            return error(err.status, err.code, err.message, request_id)
        return ok(store.incident_dto(result["incident"]), request_id)

    return action


def request_remediation(event: Mapping[str, Any], request_id: str, incident_id: str = "", **_: str) -> Response:
    from opsentra_incidents import core, remediation

    actor, role, key = _caller(event)
    body = _body(event)
    try:
        result = remediation.request_remediation(
            incident_store(),
            incident_id=incident_id,
            role=role,
            actor=actor,
            expected_version=body.get("expectedVersion"),
            runbook_id=body.get("runbookId"),  # the only target-related input; checked against the allowlist
            reason=body.get("reason"),
            idempotency_key=key,
        )
    except core.IncidentError as err:
        _denied(err, incident_id, "REMEDIATION_REQUEST", actor, role)
        return error(err.status, err.code, err.message, request_id)
    return ok(store.remediation_dto(result["request"]), request_id)


def _invoke_coordinator(remediation_request_id: str) -> None:
    """Async hand-off; if it fails the reconciler dispatches within minutes."""
    name = os.environ.get("COORDINATOR_FUNCTION", "")
    if not name:
        return
    try:
        import boto3

        boto3.client("lambda").invoke(
            FunctionName=name,
            InvocationType="Event",
            Payload=json.dumps({"requestId": remediation_request_id}).encode(),
        )
    except Exception:  # noqa: BLE001
        logger.exception(
            json.dumps({"msg": "coordinator invoke failed", "remediationRequestId": remediation_request_id})
        )


def decide_remediation(event: Mapping[str, Any], request_id: str, remediation_id: str = "", **_: str) -> Response:
    from opsentra_incidents import core, remediation

    actor, role, key = _caller(event)
    body = _body(event)
    try:
        result = remediation.decide_remediation(
            incident_store(),
            request_id=remediation_id,
            role=role,
            actor=actor,
            expected_version=body.get("expectedVersion"),
            decision=body.get("decision"),
            reason=body.get("reason"),
            idempotency_key=key,
        )
    except core.IncidentError as err:
        req = remediation.request(incident_store(), remediation_id) if err.status in (403, 409) else None
        if req:
            _denied(
                err,
                str(req.get("incidentId", "")),
                "REMEDIATION_DECISION",
                actor,
                role,
                target_type="REMEDIATION",
                target_id=remediation_id,
            )
        return error(err.status, err.code, err.message, request_id)
    if result.get("dispatch"):
        _invoke_coordinator(remediation_id)
    return ok(store.remediation_dto(result["request"]), request_id)


def list_remediations(event: Mapping[str, Any], request_id: str, **_: str) -> Response:
    _viewer(event)
    q = event.get("queryStringParameters") or {}
    incident_id = q.get("incidentId")
    rows = [store.remediation_dto(i) for i in get_store().scan(store.tables()["remediations"]) if i.get("requestId")]
    if incident_id:
        rows = [r for r in rows if r["incidentId"] == incident_id]
    return ok(sorted(rows, key=lambda r: r["requestedAt"], reverse=True), request_id)


def get_remediation(event: Mapping[str, Any], request_id: str, remediation_id: str = "", **_: str) -> Response:
    _viewer(event)
    item = get_store().get(store.tables()["remediations"], {"requestId": remediation_id})
    if not item:
        raise NotFound(f"Request {remediation_id} was not found.")
    return ok(store.remediation_dto(item), request_id)


def list_runbooks(event: Mapping[str, Any], request_id: str, **_: str) -> Response:
    from opsentra_incidents import remediation

    _viewer(event)
    applies: dict[str, list[str]] = {}
    for item in get_store().scan(store.tables()["resources"]):
        for rid in remediation.allowed_runbooks(item):
            applies.setdefault(rid, []).append(str(item["resourceId"]))
    rows = [store.runbook_dto(rb, sorted(applies.get(rb.id, []))) for rb in remediation.CATALOG.values()]
    return ok(rows, request_id)


def list_audit(event: Mapping[str, Any], request_id: str, **_: str) -> Response:
    _, role = require_identity(event)
    require_role(role, "ADMIN")  # full audit is admin-only (§4.2, §5.2)
    items = [
        i for i in get_store().scan(store.tables()["audit"]) if str(i.get("PK", "")).startswith(("INCIDENT#", "LAB#"))
    ]
    rows = sorted((store.audit_dto(i) for i in items), key=lambda a: a["id"], reverse=True)
    return ok(rows[:200], request_id)


def _invoke_lab(payload: dict[str, Any]) -> dict[str, Any]:
    """Synchronous call to the lab-controller Lambda, which alone holds the lab's
    SSM permissions (ADR-018). Fails closed: no controller means no lab."""
    name = os.environ.get("LAB_CONTROLLER_FUNCTION", "")
    if not name:
        return {"status": 503, "error": {"code": "LAB_UNAVAILABLE", "message": "The Simulation Lab is not configured."}}
    import boto3

    res = boto3.client("lambda").invoke(
        FunctionName=name, InvocationType="RequestResponse", Payload=json.dumps(payload).encode()
    )
    if res.get("FunctionError"):
        raise RuntimeError("lab controller failed")
    out = json.loads(res["Payload"].read())
    if not isinstance(out, dict) or not isinstance(out.get("status"), int):
        raise RuntimeError("lab controller returned an unexpected shape")
    return out


def _lab_reply(out: Mapping[str, Any], request_id: str) -> Response:
    if out["status"] == 200:
        return ok(out.get("data"), request_id)
    err = out.get("error") or {}
    return error(int(out["status"]), str(err.get("code", "LAB_ERROR")), str(err.get("message", "")), request_id)


def list_labs(event: Mapping[str, Any], request_id: str, **_: str) -> Response:
    actor, role, _key = _caller(event)
    require_role(role, "ADMIN")  # lab readiness is admin-only (§4.2, §5.2)
    return _lab_reply(
        _invoke_lab({"source": "opsentra-api", "command": "list", "role": role, "actor": actor}), request_id
    )


def _lab_action(command: str) -> Callable[..., Response]:
    def action(event: Mapping[str, Any], request_id: str, scenario_id: str = "", **_: str) -> Response:
        actor, role, key = _caller(event)  # role and actor from verified claims only
        body = _body(event)
        payload: dict[str, Any] = {
            "source": "opsentra-api",
            "command": command,
            "scenarioId": scenario_id,  # a catalog ID; the target comes from the registry
            "role": role,
            "actor": actor,
            "idempotencyKey": key,
        }
        if command == "start":
            payload["acknowledgeImpact"] = body.get("acknowledgeImpact") is True
        # Admin checks and denial audits happen in the controller, next to the data.
        return _lab_reply(_invoke_lab(payload), request_id)

    return action


_ID = r"([A-Za-z0-9._:-]{1,128})"

ROUTES: list[tuple[str, re.Pattern[str], Callable[..., Response], tuple[str, ...]]] = [
    ("GET", re.compile(r"^/v1/health$"), health, ()),
    ("GET", re.compile(r"^/v1/me$"), me, ()),
    ("GET", re.compile(r"^/v1/overview$"), overview, ()),
    ("GET", re.compile(r"^/v1/resources$"), list_resources, ()),
    ("GET", re.compile(rf"^/v1/resources/{_ID}$"), get_resource, ("resource_id",)),
    ("GET", re.compile(r"^/v1/incidents$"), list_incidents, ()),
    ("GET", re.compile(rf"^/v1/incidents/{_ID}$"), get_incident, ("incident_id",)),
    ("GET", re.compile(rf"^/v1/incidents/{_ID}/timeline$"), incident_timeline, ("incident_id",)),
    ("POST", re.compile(rf"^/v1/incidents/{_ID}/acknowledge$"), _incident_action("acknowledge"), ("incident_id",)),
    ("POST", re.compile(rf"^/v1/incidents/{_ID}/investigate$"), _incident_action("investigate"), ("incident_id",)),
    ("POST", re.compile(rf"^/v1/incidents/{_ID}/close$"), _incident_action("close"), ("incident_id",)),
    ("POST", re.compile(rf"^/v1/incidents/{_ID}/request-remediation$"), request_remediation, ("incident_id",)),
    ("GET", re.compile(r"^/v1/remediations$"), list_remediations, ()),
    ("GET", re.compile(rf"^/v1/remediations/{_ID}$"), get_remediation, ("remediation_id",)),
    ("POST", re.compile(rf"^/v1/remediations/{_ID}/decision$"), decide_remediation, ("remediation_id",)),
    ("GET", re.compile(r"^/v1/runbooks$"), list_runbooks, ()),
    ("GET", re.compile(r"^/v1/audit$"), list_audit, ()),
    ("GET", re.compile(r"^/v1/labs$"), list_labs, ()),
    ("POST", re.compile(rf"^/v1/labs/{_ID}/start$"), _lab_action("start"), ("scenario_id",)),
    ("POST", re.compile(rf"^/v1/labs/{_ID}/reset$"), _lab_action("reset"), ("scenario_id",)),
]


def match(method: str, path: str) -> tuple[Callable[..., Response], dict[str, str]] | None:
    for m, pattern, fn, names in ROUTES:
        found = pattern.match(path)
        if m == method and found:
            return fn, dict(zip(names, found.groups(), strict=True))
    return None


def lambda_handler(event: Mapping[str, Any], context: Any) -> Response:
    request_id = _request_id(event, context)
    http = (event.get("requestContext") or {}).get("http") or {}
    method = str(http.get("method", "")).upper()
    path = str(event.get("rawPath") or http.get("path") or "")
    route = match(method, path)

    try:
        if route is None:
            response = error(404, "NOT_FOUND", "No such route.", request_id)
        else:
            fn, params = route
            response = fn(event, request_id, **params)
    except AuthError as exc:
        response = error(exc.status, exc.code, exc.message, request_id)
    except NotFound as exc:
        response = error(404, "NOT_FOUND", str(exc), request_id)
    except BadRequest as exc:
        response = error(400, "VALIDATION", str(exc), request_id)
    except Exception:  # noqa: BLE001 — never leak internals to the caller
        logger.exception(json.dumps({"msg": "unhandled", "requestId": request_id}))
        response = error(500, "INTERNAL", "Something went wrong.", request_id)

    _log(logging.INFO, "request", requestId=request_id, method=method, path=path, status=response["statusCode"])
    return response
