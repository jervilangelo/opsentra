"""Opsentra HTTP API Lambda handler (API Gateway HTTP API, payload format 2.0).

Routes (blueprint §4.2):
  GET /v1/health  public, minimal heartbeat with no resource discovery
  GET /v1/me      JWT-protected: identity, role, permitted actions, environment

Responses are `{data, meta}` on success and `{error: {code, message, requestId}}`
on failure. Timestamps are ISO-8601 UTC. Errors never include stack traces.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from typing import Any

from .authz import PERMITTED_ACTIONS, AuthError, require_identity

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


def health(event: Mapping[str, Any], request_id: str) -> Response:
    return ok({"status": "ok", "service": SERVICE, "version": VERSION, "time": _now()}, request_id)


def me(event: Mapping[str, Any], request_id: str) -> Response:
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


ROUTES: dict[tuple[str, str], Callable[[Mapping[str, Any], str], Response]] = {
    ("GET", "/v1/health"): health,
    ("GET", "/v1/me"): me,
}


def lambda_handler(event: Mapping[str, Any], context: Any) -> Response:
    request_id = _request_id(event, context)
    http = (event.get("requestContext") or {}).get("http") or {}
    method = str(http.get("method", "")).upper()
    path = str(event.get("rawPath") or http.get("path") or "")
    route = ROUTES.get((method, path))

    try:
        if route is None:
            response = error(404, "NOT_FOUND", "No such route.", request_id)
        else:
            response = route(event, request_id)
    except AuthError as exc:
        response = error(exc.status, exc.code, exc.message, request_id)
    except Exception:  # noqa: BLE001 — never leak internals to the caller
        logger.exception(json.dumps({"msg": "unhandled", "requestId": request_id}))
        response = error(500, "INTERNAL", "Something went wrong.", request_id)

    _log(logging.INFO, "request", requestId=request_id, method=method, path=path, status=response["statusCode"])
    return response
