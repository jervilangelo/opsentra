"""Opsentra HTTP API Lambda handler (API Gateway HTTP API, payload format 2.0).

Routes (blueprint §4.2). Everything except /v1/health needs a Cognito access
token; the read routes need at least the viewer role.
  GET /v1/health                         public heartbeat, no resource discovery
  GET /v1/me                             identity, role, permitted actions
  GET /v1/overview                       counts and last sync
  GET /v1/resources[/{id}]               registered resources and their health
  GET /v1/incidents[/{id}[/timeline]]    incidents and their timelines

Responses are `{data, meta}` on success and `{error: {code, message, requestId}}`
on failure. Timestamps are ISO-8601 UTC. Errors never include stack traces.
"""

from __future__ import annotations

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
    _viewer(event)
    return ok(_incidents(), request_id)


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
    except Exception:  # noqa: BLE001 — never leak internals to the caller
        logger.exception(json.dumps({"msg": "unhandled", "requestId": request_id}))
        response = error(500, "INTERNAL", "Something went wrong.", request_id)

    _log(logging.INFO, "request", requestId=request_id, method=method, path=path, status=response["statusCode"])
    return response
