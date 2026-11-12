"""Remediation coordinator Lambda (ADR-017).

Two triggers, both carrying no user-controlled targets:
  * async invoke from the API after an approval commits: {"requestId": "..."};
  * EventBridge "EC2 Command Status-change Notification" from SSM, limited by
    the rule to Opsentra lab documents in this account and region.
The request ID is looked up server-side; the resource, instance and document
always come from the stored request and the registry, never from the event.
"""

from __future__ import annotations

import json
import logging
import os
import re
from collections.abc import Mapping
from typing import Any

from . import core, remediation

logger = logging.getLogger("opsentra-remediation-coordinator")
logger.setLevel(logging.INFO)

REQUEST_ID = re.compile(r"^REQ-\d{8}-[0-9A-F]{6}$")


def handle(event: Any, store: core.Store, ssm: Any, ec2: Any, account: str, region: str) -> dict[str, str]:
    if not isinstance(event, Mapping):
        return {"result": "rejected"}
    if event.get("source") == "aws.ssm":
        if event.get("account") != account or event.get("region") != region:
            return {"result": "rejected"}
        if event.get("detail-type") != "EC2 Command Status-change Notification":
            return {"result": "ignored"}
        return {"result": remediation.on_ssm_status(store, event)}
    rid = event.get("requestId")
    if isinstance(rid, str) and REQUEST_ID.match(rid):
        return {"result": remediation.dispatch(store, ssm, ec2, rid)}
    return {"result": "rejected"}


def lambda_handler(event: Any, context: Any) -> dict[str, str]:
    import boto3

    store = core.Store(boto3.client("dynamodb"), core.Tables.from_env())
    out = handle(
        event,
        store,
        boto3.client("ssm"),
        boto3.client("ec2"),
        os.environ["ACCOUNT_ID"],
        os.environ["AWS_REGION"],
    )
    logger.info(json.dumps({"msg": "coordinator", **out}))
    return out
