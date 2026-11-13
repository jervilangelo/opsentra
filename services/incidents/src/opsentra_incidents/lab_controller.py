"""Lab controller Lambda (blueprint §4.1 `lab-controller`; ADR-018).

Invoked synchronously by the API Lambda only (IAM: the API role is the only
principal allowed to invoke it). The API passes the caller's role and username
taken from verified Cognito claims; the request body contributes only the
scenario ID (from the URL), the confirmation flag and the Idempotency-Key.
This function holds the lab's SSM permissions, so the API role never does.

Returns {"status": 200, "data": ...} or {"status": n, "error": {code, message}}.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from typing import Any

from . import core, lab

logger = logging.getLogger("opsentra-lab-controller")
logger.setLevel(logging.INFO)

COMMANDS = ("list", "start", "reset")
ROLES = ("VIEWER", "OPERATOR", "ADMIN")


def _err(status: int, code: str, message: str) -> dict[str, Any]:
    return {"status": status, "error": {"code": code, "message": message}}


def handle(event: Any, store: core.Store, ssm: Any, ec2: Any) -> dict[str, Any]:
    if not isinstance(event, Mapping) or event.get("source") != "opsentra-api":
        return _err(400, "REJECTED", "Unexpected caller.")
    command, role, actor = event.get("command"), event.get("role"), event.get("actor")
    if command not in COMMANDS or role not in ROLES or not isinstance(actor, str) or not actor:
        return _err(400, "REJECTED", "Malformed lab command.")
    scenario_id = event.get("scenarioId")
    try:
        if command == "list":
            if role != "ADMIN":
                raise core.IncidentError(403, "FORBIDDEN", "This needs the administrator role.")
            return {"status": 200, "data": lab.list_scenarios(store, ssm, ec2)}
        key = event.get("idempotencyKey")
        key = key if isinstance(key, str) else None
        if command == "start":
            data = lab.start(
                store,
                ssm,
                ec2,
                scenario_id=scenario_id,
                role=role,
                actor=actor,
                acknowledge=event.get("acknowledgeImpact"),
                idempotency_key=key,
            )
        else:
            data = lab.reset(store, ssm, ec2, scenario_id=scenario_id, role=role, actor=actor, idempotency_key=key)
        return {"status": 200, "data": data}
    except core.IncidentError as err:
        if command != "list" and err.status in (403, 409) and scenario_id in lab.CATALOG:
            try:
                lab.record_denied(store, lab.CATALOG[scenario_id], f"LAB_{command.upper()}", actor, role, err.code)
            except Exception:  # noqa: BLE001 - the refusal stands even if the audit write fails
                logger.exception("denied-audit failed")
        return _err(err.status, err.code, err.message)


def lambda_handler(event: Any, context: Any) -> dict[str, Any]:
    import boto3

    store = core.Store(boto3.client("dynamodb"), core.Tables.from_env())
    out = handle(event, store, boto3.client("ssm"), boto3.client("ec2"))
    log = {"msg": "lab-controller", "command": event.get("command") if isinstance(event, Mapping) else None}
    logger.info(json.dumps({**log, "status": out["status"], "code": out.get("error", {}).get("code")}))
    return out
