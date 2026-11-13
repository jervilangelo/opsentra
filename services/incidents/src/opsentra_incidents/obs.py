"""Structured JSON logs (blueprint §7 Phase 8; ADR-019).

One shape for every Opsentra Lambda, so CloudWatch Logs Insights can follow an
incident across ingest, reconciler, coordinator, lab controller and API:

    {"msg", "service", "awsRequestId"?, "incidentId"?, "correlationKey"?,
     "requestId"?, "runId"?, "scenarioId"?, "eventId"?, "commandId"?, ...}

Never log tokens, headers, request bodies, reasons typed by users, or account
IDs. `None` fields are dropped.
"""

from __future__ import annotations

import contextvars
import json
import logging
from typing import Any

_aws_request_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("aws_request_id", default=None)


def bind(context: Any) -> None:
    """Call at the start of a handler: later lines carry the Lambda request ID."""
    _aws_request_id.set(getattr(context, "aws_request_id", None))


def line(service: str, msg: str, **fields: Any) -> str:
    body: dict[str, Any] = {"msg": msg, "service": service}
    rid = _aws_request_id.get()
    if rid:
        body["awsRequestId"] = rid
    body.update({k: v for k, v in fields.items() if v is not None})
    return json.dumps(body, default=str, separators=(",", ":"))


def info(logger: logging.Logger, msg: str, **fields: Any) -> None:
    logger.info(line(logger.name, msg, **fields))


def error(logger: logging.Logger, msg: str, **fields: Any) -> None:
    """Logs at ERROR with the current exception's traceback, if any."""
    logger.exception(line(logger.name, msg, **fields))
