"""Opsentra lab health probe (blueprint §3.3, §6.1). Runs every minute from
EventBridge Scheduler while the lab exists.

Each run:
  1. If the lab has expired, mark it UNKNOWN and disable this schedule.
  2. Describe the registered instance and verify it is a running, tagged lab
     resource (opsentra:lab=true). If it is gone or stopped, mark it UNKNOWN
     and disable this schedule (CLAUDE.md: no probing when the lab is down).
  3. Probe the fixed URL from the environment. Healthy only if HTTP 200 and the
     body contains the marker. Redirects are never followed (no SSRF).
  4. Emit one custom metric value (1 healthy / 0 unhealthy, dimension
     Scenario only) and update the registry item with a conditional write.

The URL, instance and table come from Terraform-set environment variables,
never from the event.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger("opsentra-health-check")
logger.setLevel(logging.INFO)

MAX_BODY = 1024


@dataclass(frozen=True)
class Config:
    target_url: str
    marker: str
    instance_id: str
    resources_table: str
    namespace: str
    scenario: str
    schedule_name: str
    schedule_group: str
    expires_at: str
    timeout_s: float = 2.0

    @staticmethod
    def from_env() -> Config:
        e = os.environ
        return Config(
            target_url=e["TARGET_URL"],
            marker=e.get("MARKER", "opsentra-lab ok"),
            instance_id=e["INSTANCE_ID"],
            resources_table=e["RESOURCES_TABLE"],
            namespace=e.get("METRIC_NAMESPACE", "Opsentra/Lab"),
            scenario=e.get("SCENARIO", "nginx"),
            schedule_name=e["SCHEDULE_NAME"],
            schedule_group=e.get("SCHEDULE_GROUP", "default"),
            expires_at=e["EXPIRES_AT"],
        )


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None  # a redirect is treated as unhealthy, never followed


_opener = urllib.request.build_opener(_NoRedirect)


def probe(url: str, marker: str, timeout_s: float) -> tuple[bool, str]:
    """Returns (healthy, short reason)."""
    if not url.startswith(("http://", "https://")):
        return False, "invalid target"
    try:
        with _opener.open(urllib.request.Request(url, method="GET"), timeout=timeout_s) as resp:  # noqa: S310
            body = resp.read(MAX_BODY).decode("utf-8", "replace")
            if resp.status != 200:
                return False, f"HTTP {resp.status}"
            if marker not in body:
                return False, "unexpected body"
            return True, "HTTP 200"
    except urllib.error.HTTPError as err:
        return False, f"HTTP {err.code}"
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        reason = getattr(err, "reason", err)
        return False, f"unreachable: {type(reason).__name__}"


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


class Clients:
    """AWS clients, created lazily; tests replace this object."""

    def __init__(self) -> None:
        import boto3

        self.ec2 = boto3.client("ec2")
        self.cloudwatch = boto3.client("cloudwatch")
        self.dynamodb = boto3.client("dynamodb")
        self.scheduler = boto3.client("scheduler")


_clients: Clients | None = None
_probe: Callable[[str, str, float], tuple[bool, str]] = probe


def _warm() -> None:
    """Create AWS clients during Lambda init (boosted CPU), not in the first run."""
    global _clients
    if os.environ.get("RESOURCES_TABLE") and _clients is None:
        try:
            _clients = Clients()
        except Exception:  # noqa: BLE001 — fall back to lazy creation
            _clients = None


def clients() -> Clients:
    global _clients
    if _clients is None:
        _clients = Clients()
    return _clients


def instance_status(c: Clients, instance_id: str) -> tuple[str, bool]:
    """(state, is_tagged_lab). state is 'missing' if the instance does not exist."""
    try:
        res = c.ec2.describe_instances(InstanceIds=[instance_id])
    except Exception as err:  # noqa: BLE001 — InvalidInstanceID.NotFound and friends
        if "NotFound" in type(err).__name__ or "NotFound" in str(err):
            return "missing", False
        raise
    instances = [i for r in res.get("Reservations", []) for i in r.get("Instances", [])]
    if not instances:
        return "missing", False
    inst = instances[0]
    tags = {t["Key"]: t["Value"] for t in inst.get("Tags", [])}
    return inst["State"]["Name"], tags.get("opsentra:lab") == "true"


def disable_schedule(c: Clients, cfg: Config) -> None:
    current = c.scheduler.get_schedule(Name=cfg.schedule_name, GroupName=cfg.schedule_group)
    if current.get("State") == "DISABLED":
        return
    c.scheduler.update_schedule(
        Name=cfg.schedule_name,
        GroupName=cfg.schedule_group,
        ScheduleExpression=current["ScheduleExpression"],
        FlexibleTimeWindow=current["FlexibleTimeWindow"],
        Target=current["Target"],
        State="DISABLED",
        Description=current.get("Description", "") + " (disabled by probe: lab down or expired)",
    )


def update_registry(c: Clients, cfg: Config, health: str, state: str, checked_at: str, verified: bool) -> None:
    names = {"#h": "health", "#c": "lastCheckedAt", "#s": "instanceState"}
    values: dict[str, Any] = {":h": {"S": health}, ":c": {"S": checked_at}, ":s": {"S": state}}
    sets = ["#h = :h", "#c = :c", "#s = :s"]
    if state == "running":
        names["#seen"] = "lastSeenAt"
        sets.append("#seen = :c")
    if verified:
        names["#tv"] = "tagVerificationAt"
        sets.append("#tv = :c")
    c.dynamodb.update_item(
        TableName=cfg.resources_table,
        Key={"resourceId": {"S": cfg.instance_id}},
        UpdateExpression="SET " + ", ".join(sets),
        ConditionExpression="attribute_exists(resourceId)",  # only registered resources
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def put_metric(c: Clients, cfg: Config, healthy: bool) -> None:
    c.cloudwatch.put_metric_data(
        Namespace=cfg.namespace,
        MetricData=[
            {
                "MetricName": "NginxAvailability",
                "Dimensions": [{"Name": "Scenario", "Value": cfg.scenario}],
                "Value": 1.0 if healthy else 0.0,
                "Unit": "Count",
            }
        ],
    )


def run(cfg: Config, c: Clients, now: str) -> dict[str, Any]:
    if now >= cfg.expires_at:
        update_registry(c, cfg, "UNKNOWN", "expired", now, verified=False)
        disable_schedule(c, cfg)
        return {"result": "expired", "scheduleDisabled": True}

    state, tagged = instance_status(c, cfg.instance_id)
    if state != "running" or not tagged:
        update_registry(c, cfg, "UNKNOWN", state if tagged or state == "missing" else "untagged", now, verified=False)
        gone = state in ("missing", "stopped", "stopping", "terminated", "shutting-down")
        if gone:
            disable_schedule(c, cfg)
        return {"result": "not-probed", "state": state, "tagged": tagged, "scheduleDisabled": gone}

    healthy, reason = _probe(cfg.target_url, cfg.marker, cfg.timeout_s)
    put_metric(c, cfg, healthy)
    update_registry(c, cfg, "HEALTHY" if healthy else "UNHEALTHY", state, now, verified=True)
    return {"result": "healthy" if healthy else "unhealthy", "reason": reason}


_warm()


def lambda_handler(event: Any, context: Any) -> dict[str, Any]:
    outcome = run(Config.from_env(), clients(), now_iso())
    # Structured log; no URL, IP or account details.
    logger.info(json.dumps({"msg": "probe", **outcome}))
    return outcome
