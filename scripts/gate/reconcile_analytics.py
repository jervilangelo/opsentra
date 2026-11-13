"""Phase 8 gate: reconcile Live analytics with their source data (read-only).

Usage: reconcile_analytics.py [from] [to]      (default: the last 7 days)

Recomputes every number in GET /v1/analytics independently, with its own code
(it does not import the API's analytics module), from:
  * raw DynamoDB items: incidents, remediations, HEALTH_VERIFIED audit items;
  * CloudWatch: the NginxAvailability probe metric, at 1-minute resolution
    where it still exists,
then calls the API as the viewer test user and prints a field-by-field diff.
Exit 0 when everything matches. Nothing is written anywhere.
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
import urllib.request
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import boto3

R = "ap-southeast-1"
API = os.environ["OPSENTRA_API_URL"].rstrip("/")
ddb = boto3.client("dynamodb", region_name=R)
cw = boto3.client("cloudwatch", region_name=R)


def ts(v: str) -> datetime:
    return datetime.fromisoformat(v).astimezone(UTC)


def z(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


def scan(table: str) -> list[dict]:
    out, kw = [], {"TableName": table}
    while True:
        page = ddb.scan(**kw)
        out += page["Items"]
        if "LastEvaluatedKey" not in page:
            return out
        kw["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def s(item: dict, key: str) -> str | None:
    return item.get(key, {}).get("S")


def stats(seconds: list[float]) -> dict:
    out = {"count": len(seconds)}
    if not seconds:
        return out
    v = sorted(seconds)
    out["meanSeconds"] = math.floor(sum(v) / len(v) + 0.5)
    if len(v) >= 3:
        m = len(v) // 2
        out["medianSeconds"] = math.floor((v[m] if len(v) % 2 else (v[m - 1] + v[m]) / 2) + 0.5)
    if len(v) >= 10:
        out["p90Seconds"] = math.floor(v[math.ceil(0.9 * len(v)) - 1] + 0.5)
    return out


def expected(frm: datetime, to: datetime) -> dict:
    incs = []
    for it in scan("opsentra-dev-incidents"):
        det = s(it, "detectedAt") or s(it, "openedAt")
        if det and frm <= ts(det) <= to:
            incs.append(it)
    ids = {s(i, "incidentId") for i in incs}

    def durations(end: str) -> tuple[list[float], int]:
        got = [(ts(s(i, end)) - ts(s(i, "detectedAt"))).total_seconds() for i in incs if s(i, end) and s(i, "detectedAt")]
        return got, len(incs) - len(got)

    ack, ack_x = durations("acknowledgedAt")
    rec, rec_x = durations("verifiedHealthyAt")
    rb = {"succeeded": 0, "failed": 0, "rejected": 0}
    for r in scan("opsentra-dev-remediations"):
        st = (s(r, "status") or "").lower()
        if s(r, "incidentId") in ids and st in rb:
            rb[st] += 1
    rec_kind = {"afterRunbook": 0, "selfHealed": 0, "unknown": 0}
    for i in incs:
        if not s(i, "verifiedHealthyAt"):
            continue
        items = ddb.query(
            TableName="opsentra-dev-audit",
            KeyConditionExpression="PK = :p",
            ExpressionAttributeValues={":p": {"S": f"INCIDENT#{s(i, 'incidentId')}"}},
        )["Items"]
        hv = [x for x in items if s(x, "eventType") == "HEALTH_VERIFIED"]
        detail = hv[0].get("detail", {}).get("M", {}) if hv else {}
        rec_kind["afterRunbook" if "requestId" in detail else "selfHealed" if "afterClear" in detail else "unknown"] += 1

    period = 60 if datetime.now(UTC) - frm <= timedelta(days=14) else 300
    healthy = total = 0
    start = frm
    while start < to:
        end = min(to, start + timedelta(seconds=period * 1440))
        for p in cw.get_metric_statistics(
            Namespace="Opsentra/Lab",
            MetricName="NginxAvailability",
            Dimensions=[{"Name": "Scenario", "Value": "nginx"}],
            StartTime=start,
            EndTime=end,
            Period=period,
            Statistics=["Sum", "SampleCount"],
        )["Datapoints"]:
            healthy += round(p["Sum"])
            total += round(p["SampleCount"])
        start = end

    return {
        "incidentCount": len(incs),
        "bySeverity": {k: sum(1 for i in incs if s(i, "severity") == k) for k in ("CRITICAL", "HIGH", "MEDIUM", "LOW")},
        "escalated": sum(1 for i in incs if s(i, "state") == "ESCALATED"),
        "mtta": {**stats(ack), "excluded": ack_x},
        "mttr": {**stats(rec), "excluded": rec_x},
        "runbooks": {**rb, "total": sum(rb.values())},
        "recoveries": rec_kind,
        "availability": {"healthyProbes": healthy, "totalProbes": total} if total else None,
    }


def token() -> str:
    cog = boto3.client("cognito-idp", region_name=R)
    res = cog.admin_initiate_auth(
        UserPoolId=os.environ["OPSENTRA_USER_POOL_ID"],
        ClientId=os.environ["OPSENTRA_TEST_CLIENT_ID"],
        AuthFlow="ADMIN_USER_PASSWORD_AUTH",
        AuthParameters={
            "USERNAME": os.environ["OPSENTRA_TEST_VIEWER_USER"],
            "PASSWORD": os.environ["OPSENTRA_TEST_VIEWER_PASSWORD"],
        },
    )
    return res["AuthenticationResult"]["AccessToken"]


def main() -> int:
    now = datetime.now(UTC).replace(microsecond=0)
    frm = ts(sys.argv[1]) if len(sys.argv) > 1 else now - timedelta(days=7)
    to = ts(sys.argv[2]) if len(sys.argv) > 2 else now
    url = f"{API}/v1/analytics?{urlencode({'from': z(frm), 'to': z(to)})}"
    req = urllib.request.Request(url, headers={"authorization": f"Bearer {token()}"})
    with urllib.request.urlopen(req, timeout=20) as r:
        body = json.loads(r.read())
    got, want = body["data"], expected(frm, to)
    print(f"range {z(frm)} .. {z(to)}  dataset={body['meta']['dataset']}")
    bad = 0
    for key, exp in want.items():
        act = got.get(key)
        if key == "availability" and act:
            act = {k: act[k] for k in ("healthyProbes", "totalProbes")}
        ok = act == exp
        bad += not ok
        print(f"{'ok ' if ok else 'BAD'} {key:14s} api={json.dumps(act)}" + ("" if ok else f"  expected={json.dumps(exp)}"))
    for note in got.get("dataQuality", []):
        print("    note:", re.sub(r"\d{12}", "<account>", note))
    print("RECONCILED: every number matches its source" if not bad else f"MISMATCH in {bad} field(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
