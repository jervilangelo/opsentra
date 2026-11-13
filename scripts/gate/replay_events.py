"""Phase 5 gate: replay crafted events to the ingest Lambda (owner-approved).

Takes the real ALARM event from the lab's alarm log group and sends a duplicate,
malformed variants, a delayed ALARM and an out-of-order OK. Prints results with
account IDs masked.
"""

import copy
import json
import re
import sys
from datetime import UTC, datetime, timedelta

import boto3

R = "ap-southeast-1"
FN = "opsentra-dev-incident-ingest"
logs = boto3.client("logs", region_name=R)
lam = boto3.client("lambda", region_name=R)


def mask(s: str) -> str:
    return re.sub(r"\d{12}", "<account>", s)


events = [e for p in logs.get_paginator("filter_log_events").paginate(logGroupName="/aws/events/opsentra-lab-alarms") for e in p["events"]]
real = None
for e in events:
    m = json.loads(e["message"])
    if m["detail"]["alarmName"] == "opsentra-lab-nginx-availability" and m["detail"]["state"]["value"] == "ALARM":
        real = m
if real is None:
    sys.exit("no real ALARM event found")

ts = datetime.fromisoformat(real["detail"]["state"]["timestamp"].replace("+0000", "+00:00"))
earlier = (ts - timedelta(minutes=10)).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000+0000")


def variant(eid: str, **changes) -> dict:
    v = copy.deepcopy(real)
    v["id"] = eid
    for path, value in changes.items():
        tgt = v
        keys = path.split("__")
        for k in keys[:-1]:
            tgt = tgt[k]
        if value is None:
            tgt.pop(keys[-1], None)
        else:
            tgt[keys[-1]] = value
    return v


cases = [
    ("duplicate delivery (same event id)", copy.deepcopy(real)),
    ("malformed: no state", variant("gate5-malformed-1", detail__state=None)),
    ("malformed: bad timestamp", variant("gate5-malformed-2", detail__state={"value": "ALARM", "timestamp": "yesterday"})),
    ("malformed: foreign source", variant("gate5-malformed-3", source="custom.attacker")),
    ("malformed: unregistered alarm", variant("gate5-malformed-4", detail__alarmName="opsentra-lab-not-registered")),
    ("delayed ALARM (10 min older)", variant("gate5-delayed-alarm", detail__state={**real["detail"]["state"], "timestamp": earlier})),
    ("out-of-order OK (older than ALARM)", variant("gate5-old-ok", detail__state={**real["detail"]["state"], "value": "OK", "timestamp": earlier})),
]

print("real event:", real["id"], real["detail"]["state"]["timestamp"])
for name, ev in cases:
    r = lam.invoke(FunctionName=FN, Payload=json.dumps(ev).encode())
    body = r["Payload"].read().decode()
    print(f"{name:40s} -> {r['StatusCode']} {r.get('FunctionError', '')} {mask(body)}")
