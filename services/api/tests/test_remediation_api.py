"""Phase 6 API routes: request, decision, reads; denials audited; dispatch once."""

import json
from collections.abc import Iterator
from typing import Any

import boto3
import pytest
from moto import mock_aws
from opsentra_incidents import core

import opsentra_api.handler as h
from test_handler import access, call, event

DOC_HASH = "b" * 64
OP = access("[operator]", username="op-user")
ADMIN = access("[admin]", username="admin-user")
VIEWER = access("[viewer]", username="viewer-user")


class Reads:
    """The API's read store over the same moto tables."""

    def __init__(self, ddb: Any) -> None:
        self.ddb = ddb

    def scan(self, table: str) -> Iterator[dict[str, Any]]:
        yield from (core.de_item(i) for i in self.ddb.scan(TableName=table)["Items"])

    def get(self, table: str, key: dict[str, Any]) -> dict[str, Any] | None:
        res = self.ddb.get_item(TableName=table, Key={k: {"S": v} for k, v in key.items()})
        return core.de_item(res["Item"]) if "Item" in res else None

    def query_pk(self, table: str, pk_name: str, pk_value: str) -> list[dict[str, Any]]:
        res = self.ddb.query(
            TableName=table,
            KeyConditionExpression="#p = :v",
            ExpressionAttributeNames={"#p": pk_name},
            ExpressionAttributeValues={":v": {"S": pk_value}},
        )
        return [core.de_item(i) for i in res["Items"]]


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, Any]]:
    for k, v in {
        "AWS_ACCESS_KEY_ID": "t",
        "AWS_SECRET_ACCESS_KEY": "t",
        "AWS_DEFAULT_REGION": "ap-southeast-1",
        "INCIDENTS_TABLE": "inc",
        "AUDIT_TABLE": "aud",
        "RESOURCES_TABLE": "res",
        "REMEDIATIONS_TABLE": "rem",
    }.items():
        monkeypatch.setenv(k, v)
    invoked: list[str] = []
    monkeypatch.setattr(h, "_invoke_coordinator", invoked.append)
    with mock_aws():
        ddb = boto3.client("dynamodb", region_name="ap-southeast-1")
        for name, keys in {
            "inc": [("incidentId", "HASH")],
            "aud": [("PK", "HASH"), ("SK", "RANGE")],
            "res": [("resourceId", "HASH")],
            "rem": [("requestId", "HASH")],
            "cor": [("correlationKey", "HASH")],
        }.items():
            ddb.create_table(
                TableName=name,
                BillingMode="PAY_PER_REQUEST",
                AttributeDefinitions=[{"AttributeName": k, "AttributeType": "S"} for k, _ in keys],
                KeySchema=[{"AttributeName": k, "KeyType": t} for k, t in keys],
            )
        ddb.put_item(
            TableName="inc",
            Item=core.ser_item(
                {
                    "incidentId": "INC-1",
                    "correlationKey": "ap-southeast-1:i-0lab:opsentra-lab-nginx-availability",
                    "resourceId": "i-0lab",
                    "title": "Nginx down",
                    "severity": "HIGH",
                    "state": "INVESTIGATING",
                    "version": 3,
                    "openedAt": "2026-11-12T06:34:30Z",
                }
            ),
        )
        ddb.put_item(
            TableName="res",
            Item=core.ser_item(
                {
                    "resourceId": "i-0lab",
                    "type": "EC2",
                    "runbooks": {
                        "rb-restart-nginx": {"document": "Opsentra-Lab-RestartNginx", "documentHash": DOC_HASH}
                    },
                }
            ),
        )
        h.set_incident_store(core.Store(ddb, core.Tables("inc", "aud", "cor", "res", "rem")))
        h.set_store(Reads(ddb))  # type: ignore[arg-type]
        yield {"ddb": ddb, "invoked": invoked}
        h.set_incident_store(None)
        h.set_store(None)


def post(path: str, claims: Any, body: Any, key: str | None = "k-1") -> dict[str, Any]:
    e = event("POST", path, claims, body=json.dumps(body))
    if key is not None:
        e["headers"] = {"Idempotency-Key": key}
    return e


def request_fix(api: dict[str, Any], claims: Any = OP, **over: Any) -> tuple[int, dict[str, Any]]:
    body = {"expectedVersion": 3, "runbookId": "rb-restart-nginx", "reason": "Nginx is down", **over}
    return call(post("/v1/incidents/INC-1/request-remediation", claims, body, key="req-1"))


def decision(rid: str, claims: Any = ADMIN, key: str = "dec-1", version: int = 4) -> tuple[int, dict[str, Any]]:
    body = {"expectedVersion": version, "decision": "APPROVE", "reason": "lab only"}
    return call(post(f"/v1/remediations/{rid}/decision", claims, body, key=key))


def audit_actions(api: dict[str, Any]) -> list[str]:
    items = [core.de_item(i) for i in api["ddb"].scan(TableName="aud")["Items"]]
    return [i["action"] for i in items if str(i["PK"]).startswith("INCIDENT#")]


def test_request_then_approve_dispatches_once(api: dict[str, Any]) -> None:
    status, body = request_fix(api)
    assert status == 200
    req = body["data"]
    assert req["status"] == "PENDING" and req["actionKey"] == "Opsentra-Lab-RestartNginx"
    assert "documentHash" not in req and "reason" not in req
    rid = req["requestId"]

    status, body = decision(rid)
    assert status == 200 and body["data"]["status"] == "APPROVED"
    status, again = decision(rid)  # replay
    assert status == 200 and again["data"] == body["data"]
    assert api["invoked"] == [rid]


def test_viewer_and_operator_decisions_are_denied_and_audited(api: dict[str, Any]) -> None:
    rid = request_fix(api)[1]["data"]["requestId"]
    for claims, key in ((VIEWER, "v"), (OP, "o")):
        status, body = decision(rid, claims=claims, key=key)
        assert (status, body["error"]["code"]) == (403, "FORBIDDEN")
    assert audit_actions(api).count("REMEDIATION_DECISION_DENIED") == 2
    assert api["invoked"] == []


def test_viewer_request_is_denied_and_audited(api: dict[str, Any]) -> None:
    status, _ = request_fix(api, claims=VIEWER)
    assert status == 403
    assert "REMEDIATION_REQUEST_DENIED" in audit_actions(api)


@pytest.mark.parametrize(
    "over",
    [
        {"runbookId": "AWS-RunShellScript"},
        {"runbookId": "rb-restart-nginx && curl evil"},
        {"runbookId": "rb-unknown"},
    ],
)
def test_arbitrary_targets_are_refused(api: dict[str, Any], over: dict[str, Any]) -> None:
    status, _ = request_fix(api, **over)
    assert status == 400
    assert api["ddb"].scan(TableName="rem")["Count"] == 0


def test_resource_or_role_in_the_body_is_ignored(api: dict[str, Any]) -> None:
    status, body = request_fix(
        api, claims=VIEWER, resourceId="i-0prod", instanceId="i-0prod", role="ADMIN", document="AWS-RunShellScript"
    )
    assert status == 403
    status, body = request_fix(api, resourceId="i-0prod", document="AWS-RunShellScript")
    assert status == 200 and body["data"]["resourceId"] == "i-0lab"
    assert body["data"]["actionKey"] == "Opsentra-Lab-RestartNginx"


def test_reads(api: dict[str, Any]) -> None:
    rid = request_fix(api)[1]["data"]["requestId"]
    status, body = call(event("GET", "/v1/runbooks", VIEWER))
    assert status == 200
    assert body["data"] == [
        {
            "id": "rb-restart-nginx",
            "version": 1,
            "title": "Restart Nginx",
            "description": "Restarts the Nginx service on the lab web server through a fixed SSM document.",
            "actionKey": "Opsentra-Lab-RestartNginx",
            "applicableResourceIds": ["i-0lab"],
            "requiresApproval": True,
        }
    ]
    e = event("GET", "/v1/remediations", VIEWER)
    e["queryStringParameters"] = {"incidentId": "INC-1"}
    assert [r["requestId"] for r in call(e)[1]["data"]] == [rid]
    assert call(event("GET", f"/v1/remediations/{rid}", VIEWER))[1]["data"]["status"] == "PENDING"
    assert call(event("GET", "/v1/remediations/REQ-NOPE", VIEWER))[0] == 404
    assert call(event("GET", "/v1/runbooks", None))[0] == 401


def test_self_approval_is_flagged(api: dict[str, Any]) -> None:
    rid = request_fix(api, claims=ADMIN)[1]["data"]["requestId"]
    status, body = decision(rid)
    assert status == 200 and body["data"]["selfApproved"] is True
