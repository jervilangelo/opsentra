"""Phase 7 API routes (ADR-018): admin-only lab list, start and reset; targets
come from the registry only; refusals are audited."""

import json
from collections.abc import Iterator
from typing import Any

import boto3
import pytest
from moto import mock_aws
from opsentra_incidents import core, lab_controller

import opsentra_api.handler as h
from test_handler import access, call, event
from test_remediation_api import Reads

ADMIN = access("[admin]", username="admin-user")
OP = access("[operator]", username="op-user")
VIEWER = access("[viewer]", username="viewer-user")
INSTANCE = "i-0lab"


class FakeSSM:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    def send_command(self, **kw: Any) -> dict[str, Any]:
        self.sent.append(kw)
        return {"Command": {"CommandId": f"cmd-{len(self.sent)}"}}

    def describe_instance_information(self, Filters: Any) -> dict[str, Any]:  # noqa: N803
        return {"InstanceInformationList": [{"InstanceId": INSTANCE, "PingStatus": "Online"}]}


class FakeEC2:
    def describe_instances(self, InstanceIds: list[str]) -> dict[str, Any]:  # noqa: N803
        tags = [{"Key": "opsentra:lab", "Value": "true"}]
        return {
            "Reservations": [
                {"Instances": [{"InstanceId": InstanceIds[0], "Tags": tags, "State": {"Name": "running"}}]}
            ]
        }


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, Any]]:
    for k, v in {
        "AWS_ACCESS_KEY_ID": "t",
        "AWS_SECRET_ACCESS_KEY": "t",
        "AWS_DEFAULT_REGION": "ap-southeast-1",
        "RESOURCES_TABLE": "res",
        "AUDIT_TABLE": "aud",
        "INCIDENTS_TABLE": "inc",
    }.items():
        monkeypatch.setenv(k, v)
    ssm = FakeSSM()
    with mock_aws():
        ddb = boto3.client("dynamodb", region_name="ap-southeast-1")
        for name, keys in {
            "inc": [("incidentId", "HASH")],
            "aud": [("PK", "HASH"), ("SK", "RANGE")],
            "res": [("resourceId", "HASH")],
            "rem": [("requestId", "HASH")],
            "cor": [("correlationKey", "HASH")],
            "lab": [("runId", "HASH")],
        }.items():
            ddb.create_table(
                TableName=name,
                BillingMode="PAY_PER_REQUEST",
                AttributeDefinitions=[{"AttributeName": k, "AttributeType": "S"} for k, _ in keys],
                KeySchema=[{"AttributeName": k, "KeyType": t} for k, t in keys],
            )
        ddb.put_item(
            TableName="res",
            Item=core.ser_item(
                {
                    "resourceId": INSTANCE,
                    "type": "EC2",
                    "environment": "lab",
                    "scenario": "nginx",
                    "labExpiresAt": "2099-01-01T00:00:00Z",
                    "health": "HEALTHY",
                    "lastCheckedAt": core.now_iso(),
                    "scenarios": {"nginx-outage": {"document": "Opsentra-Lab-StopNginx", "documentHash": "c" * 64}},
                    "runbooks": {
                        "rb-restart-nginx": {"document": "Opsentra-Lab-RestartNginx", "documentHash": "d" * 64}
                    },
                }
            ),
        )
        lab_store = core.Store(ddb, core.Tables("inc", "aud", "cor", "res", "rem", "lab"))
        calls: list[dict[str, Any]] = []

        def invoke(payload: dict[str, Any]) -> dict[str, Any]:
            calls.append(payload)
            return json.loads(json.dumps(lab_controller.handle(payload, lab_store, ssm, FakeEC2())))

        monkeypatch.setattr(h, "_invoke_lab", invoke)
        h.set_incident_store(lab_store)
        h.set_store(Reads(ddb))  # type: ignore[arg-type]
        yield {"ddb": ddb, "ssm": ssm, "calls": calls}
        h.set_incident_store(None)
        h.set_store(None)


def post(path: str, claims: Any, body: Any, key: str | None = "k-1") -> dict[str, Any]:
    e = event("POST", path, claims, body=json.dumps(body))
    if key is not None:
        e["headers"] = {"Idempotency-Key": key}
    return e


def lab_audit(api: dict[str, Any]) -> list[str]:
    items = [core.de_item(i) for i in api["ddb"].scan(TableName="aud")["Items"]]
    return sorted(i["eventType"] for i in items if str(i["PK"]).startswith("LAB#"))


def test_list_is_admin_only(api: dict[str, Any]) -> None:
    assert call(event("GET", "/v1/labs"))[0] == 401
    for claims in (VIEWER, OP):
        assert call(event("GET", "/v1/labs", claims))[0] == 403
    assert api["calls"] == []  # refused before the controller is invoked
    status, body = call(event("GET", "/v1/labs", ADMIN))
    assert status == 200 and body["meta"]["dataset"] == "live"
    [sc] = body["data"]
    assert sc["id"] == "nginx-outage" and sc["available"] is True
    assert all(c["ok"] for c in sc["preflight"])
    assert "arn" not in json.dumps(body).lower()


def test_start_needs_admin_and_is_audited_when_denied(api: dict[str, Any]) -> None:
    status, body = call(post("/v1/labs/nginx-outage/start", OP, {"acknowledgeImpact": True}))
    assert (status, body["error"]["code"]) == (403, "FORBIDDEN")
    assert api["ssm"].sent == []
    assert lab_audit(api) == ["LAB_START_DENIED"]


def test_start_requires_confirmation(api: dict[str, Any]) -> None:
    status, body = call(post("/v1/labs/nginx-outage/start", ADMIN, {}))
    assert (status, body["error"]["code"]) == (400, "CONFIRMATION_REQUIRED")


def test_start_ignores_any_target_in_the_body(api: dict[str, Any]) -> None:
    body = {
        "acknowledgeImpact": True,
        "instanceId": "i-0production",
        "document": "AWS-RunShellScript",
        "commands": ["rm -rf /"],
        "role": "ADMIN",
    }
    status, out = call(post("/v1/labs/nginx-outage/start", ADMIN, body))
    assert status == 200 and out["data"]["activeRun"]["status"] == "ACTIVE"
    [cmd] = api["ssm"].sent
    assert cmd["InstanceIds"] == [INSTANCE] and cmd["DocumentName"] == "Opsentra-Lab-StopNginx"
    assert "Parameters" not in cmd
    # Only these keys reach the controller; role and actor come from the token.
    [payload] = api["calls"]
    assert set(payload) == {"source", "command", "scenarioId", "role", "actor", "idempotencyKey", "acknowledgeImpact"}
    assert (payload["role"], payload["actor"]) == ("ADMIN", "admin-user")


def test_second_start_is_409_and_reset_frees_it(api: dict[str, Any]) -> None:
    assert call(post("/v1/labs/nginx-outage/start", ADMIN, {"acknowledgeImpact": True}))[0] == 200
    status, body = call(post("/v1/labs/nginx-outage/start", ADMIN, {"acknowledgeImpact": True}, key="k-2"))
    assert (status, body["error"]["code"]) == (409, "LAB_BUSY")
    status, body = call(post("/v1/labs/nginx-outage/reset", ADMIN, {}, key="r-1"))
    assert status == 200 and body["data"]["lastRun"]["status"] == "RESET"
    assert [c["DocumentName"] for c in api["ssm"].sent] == ["Opsentra-Lab-StopNginx", "Opsentra-Lab-RestartNginx"]
    assert "LAB_START_DENIED" in lab_audit(api)


def test_unknown_scenarios_and_missing_keys(api: dict[str, Any]) -> None:
    assert call(post("/v1/labs/i-0abc/start", ADMIN, {"acknowledgeImpact": True}))[0] == 404
    assert call(post("/v1/labs/nginx-outage/start", ADMIN, {"acknowledgeImpact": True}, key=None))[0] == 400
    assert call(post("/v1/labs/nginx-outage/reset", VIEWER, {}))[0] == 403
    assert api["ssm"].sent == []


def test_lab_events_appear_in_the_admin_audit(api: dict[str, Any]) -> None:
    call(post("/v1/labs/nginx-outage/start", ADMIN, {"acknowledgeImpact": True}))
    status, body = call(event("GET", "/v1/audit", ADMIN))
    lab_rows = [a for a in body["data"] if a["targetType"] == "LAB"]
    assert status == 200 and {a["action"] for a in lab_rows} >= {"LAB_SCENARIO_STARTED", "LAB_INJECTION_SENT"}


def test_no_controller_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LAB_CONTROLLER_FUNCTION", raising=False)
    status, body = call(event("GET", "/v1/labs", ADMIN))
    assert (status, body["error"]["code"]) == (503, "LAB_UNAVAILABLE")


@pytest.mark.parametrize(
    "payload",
    [
        {"command": "start", "role": "ADMIN", "actor": "x"},  # no source
        {"source": "opsentra-api", "command": "destroy", "role": "ADMIN", "actor": "x"},
        {"source": "opsentra-api", "command": "start", "role": "ROOT", "actor": "x"},
        {"source": "opsentra-api", "command": "start", "role": "ADMIN", "actor": ""},
        "not an object",
    ],
)
def test_controller_rejects_malformed_invocations(api: dict[str, Any], payload: Any) -> None:
    out = lab_controller.handle(payload, h.incident_store(), api["ssm"], FakeEC2())
    assert out["status"] == 400 and api["ssm"].sent == []


def test_audit_with_nested_numbers_serializes(monkeypatch: pytest.MonkeyPatch) -> None:
    """Live gate 2026-11-13: VERIFICATION_FAILED stores consecutiveHealthyChecks
    (a number) inside detail; the real store returned Decimal and /v1/audit 500ed."""
    from opsentra_api import store

    for k, v in {
        "AWS_ACCESS_KEY_ID": "t",
        "AWS_SECRET_ACCESS_KEY": "t",
        "AWS_DEFAULT_REGION": "ap-southeast-1",
        "AUDIT_TABLE": "aud",
    }.items():
        monkeypatch.setenv(k, v)
    with mock_aws():
        ddb = boto3.client("dynamodb", region_name="ap-southeast-1")
        ddb.create_table(
            TableName="aud",
            BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[
                {"AttributeName": "PK", "AttributeType": "S"},
                {"AttributeName": "SK", "AttributeType": "S"},
            ],
            KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
        )
        ddb.put_item(
            TableName="aud",
            Item=core.ser_item(
                {
                    "PK": "INCIDENT#INC-1",
                    "SK": "2026-11-13T01:42:07Z#1",
                    "eventType": "VERIFICATION_FAILED",
                    "detail": {"consecutiveHealthyChecks": 0, "total": 12, "list": [1, 2]},
                }
            ),
        )
        h.set_store(store.DynamoStore())
        try:
            status, body = call(event("GET", "/v1/audit", ADMIN))
        finally:
            h.set_store(None)
    assert status == 200
    assert body["data"][0]["detail"] == {"consecutiveHealthyChecks": 0, "total": 12, "list": [1, 2]}
