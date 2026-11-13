import os
import re
from collections.abc import Iterator
from typing import Any

import boto3
import pytest
from moto import mock_aws

from opsentra_incidents import core, ingest

ACCOUNT = "111122223333"
REGION = "ap-southeast-1"
ALARM = "opsentra-lab-nginx-availability"
RESOURCE = "i-0lab"
DOC_HASH = "a" * 64
STOP_HASH = "b" * 64


@pytest.fixture(autouse=True)
def aws_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for k, v in {
        "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing",
        "AWS_DEFAULT_REGION": REGION,
        "AWS_REGION": REGION,
    }.items():
        monkeypatch.setenv(k, v)


_CLAUSE = re.compile(r"\b(SET|REMOVE|ADD|DELETE)\b")


def check_update_expression(expr: str) -> None:
    """DynamoDB's UpdateExpression grammar, which moto does not enforce: each
    clause keyword at most once, clauses separated by whitespace only (no comma
    before the next keyword), REMOVE takes bare attribute paths."""
    parts = _CLAUSE.split(expr)
    assert parts[0].strip() == "", f"text before the first clause: {expr!r}"
    seen: set[str] = set()
    for kw, body in zip(parts[1::2], parts[2::2], strict=True):
        assert kw not in seen, f"{kw} appears twice: {expr!r}"
        seen.add(kw)
        text = body.strip()
        assert text and not text.endswith(",") and not text.startswith(","), f"bad {kw} clause: {expr!r}"
        if kw == "REMOVE":
            assert all(re.fullmatch(r"[#A-Za-z][\w.#\[\]]*", a.strip()) for a in text.split(",")), expr


def _strict(params: dict[str, Any], **_: Any) -> None:
    items = params.get("TransactItems") or [{"Update": params}]
    for item in items:
        expr = (item.get("Update") or {}).get("UpdateExpression")
        if expr:
            check_update_expression(expr)


@pytest.fixture
def store() -> Iterator[core.Store]:
    with mock_aws():
        ddb = boto3.client("dynamodb", region_name=REGION)
        ddb.meta.events.register("provide-client-params.dynamodb.UpdateItem", _strict)
        ddb.meta.events.register("provide-client-params.dynamodb.TransactWriteItems", _strict)

        def table(name: str, keys: list[tuple[str, str]]) -> None:
            ddb.create_table(
                TableName=name,
                BillingMode="PAY_PER_REQUEST",
                AttributeDefinitions=[{"AttributeName": k, "AttributeType": "S"} for k, _ in keys],
                KeySchema=[{"AttributeName": k, "KeyType": t} for k, t in keys],
            )

        table("inc", [("incidentId", "HASH")])
        table("aud", [("PK", "HASH"), ("SK", "RANGE")])
        table("cor", [("correlationKey", "HASH")])
        table("res", [("resourceId", "HASH")])
        table("rem", [("requestId", "HASH")])
        table("lab", [("runId", "HASH")])
        ddb.put_item(
            TableName="res",
            Item=core.ser_item(
                {
                    "resourceId": RESOURCE,
                    "type": "EC2",
                    "environment": "lab",
                    "scenario": "nginx",
                    "labExpiresAt": "2099-01-01T00:00:00Z",
                    "scenarios": {"nginx-outage": {"document": "Opsentra-Lab-StopNginx", "documentHash": STOP_HASH}},
                    "severity": "HIGH",
                    "alarmNames": [ALARM],
                    "alarmTitles": {ALARM: "Nginx health check failing on the lab web server"},
                    "health": "UNHEALTHY",
                    "runbooks": {
                        "rb-restart-nginx": {"document": "Opsentra-Lab-RestartNginx", "documentHash": DOC_HASH}
                    },
                }
            ),
        )
        yield core.Store(ddb, core.Tables("inc", "aud", "cor", "res", "rem", "lab"))


@pytest.fixture
def emails(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    sent: list[dict[str, Any]] = []
    monkeypatch.setattr(ingest, "notify", lambda topic, incident: sent.append(dict(incident)))
    return sent


def alarm_event(state: str = "ALARM", ts: str = "2026-11-12T06:34:24Z", event_id: str = "evt-1", **over: Any) -> dict:
    e = {
        "id": event_id,
        "source": "aws.cloudwatch",
        "detail-type": "CloudWatch Alarm State Change",
        "account": ACCOUNT,
        "region": REGION,
        "time": ts,
        "detail": {"alarmName": ALARM, "state": {"value": state, "timestamp": ts}},
    }
    e.update(over)
    return e


def ingest_event(store: core.Store, event: dict) -> dict:
    return ingest.handle(event, store, ACCOUNT, REGION, "arn:aws:sns:ap-southeast-1:111122223333:t")


def incidents(store: core.Store) -> list[dict]:
    return [core.de_item(i) for i in store.c.scan(TableName="inc")["Items"]]


def timeline(store: core.Store, incident_id: str) -> list[str]:
    items = store.c.query(
        TableName="aud",
        KeyConditionExpression="PK = :p",
        ExpressionAttributeValues={":p": {"S": f"INCIDENT#{incident_id}"}},
    )["Items"]
    return [core.de_item(i)["eventType"] for i in sorted(items, key=lambda i: i["SK"]["S"])]


os.environ.setdefault("AWS_DEFAULT_REGION", REGION)
