import os
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


@pytest.fixture(autouse=True)
def aws_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for k, v in {
        "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing",
        "AWS_DEFAULT_REGION": REGION,
        "AWS_REGION": REGION,
    }.items():
        monkeypatch.setenv(k, v)


@pytest.fixture
def store() -> Iterator[core.Store]:
    with mock_aws():
        ddb = boto3.client("dynamodb", region_name=REGION)

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
        ddb.put_item(
            TableName="res",
            Item=core.ser_item(
                {
                    "resourceId": RESOURCE,
                    "type": "EC2",
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
        yield core.Store(ddb, core.Tables("inc", "aud", "cor", "res", "rem"))


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
