import json
from collections.abc import Iterator
from typing import Any

import boto3
import pytest
from moto import mock_aws
from opsentra_incidents import core

import opsentra_api.handler as h
from test_handler import access, call, event
from test_reads import FakeStore


@pytest.fixture
def writer(monkeypatch: pytest.MonkeyPatch) -> Iterator[core.Store]:
    for k, v in {
        "AWS_ACCESS_KEY_ID": "t",
        "AWS_SECRET_ACCESS_KEY": "t",
        "AWS_DEFAULT_REGION": "ap-southeast-1",
    }.items():
        monkeypatch.setenv(k, v)
    with mock_aws():
        ddb = boto3.client("dynamodb", region_name="ap-southeast-1")
        for name, keys in {"inc": [("incidentId", "HASH")], "aud": [("PK", "HASH"), ("SK", "RANGE")]}.items():
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
                    "state": "OPEN",
                    "version": 1,
                    "openedAt": "2026-11-12T06:34:30Z",
                }
            ),
        )
        s = core.Store(ddb, core.Tables("inc", "aud", "cor", "res"))
        h.set_incident_store(s)
        yield s
        h.set_incident_store(None)


def post(path: str, claims: dict[str, Any] | None, body: Any, key: str | None = "key-1") -> dict[str, Any]:
    e = event("POST", path, claims, body=json.dumps(body))
    if key is not None:
        e["headers"] = {"Idempotency-Key": key}
    return e


OP = access("[operator]")


def test_acknowledge_records_who_and_bumps_the_version(writer: core.Store) -> None:
    status, body = call(post("/v1/incidents/INC-1/acknowledge", OP, {"expectedVersion": 1, "reason": "on it"}))
    assert status == 200
    assert body["data"]["state"] == "ACKNOWLEDGED" and body["data"]["version"] == 2


def test_viewer_cannot_act(writer: core.Store) -> None:
    status, body = call(
        post("/v1/incidents/INC-1/acknowledge", access("[viewer]"), {"expectedVersion": 1, "reason": "x"})
    )
    assert (status, body["error"]["code"]) == (403, "FORBIDDEN")


def test_role_in_the_body_is_ignored(writer: core.Store) -> None:
    status, _ = call(
        post(
            "/v1/incidents/INC-1/acknowledge",
            access("[viewer]"),
            {"expectedVersion": 1, "reason": "x", "role": "ADMIN"},
        )
    )
    assert status == 403


def test_needs_a_token(writer: core.Store) -> None:
    assert call(post("/v1/incidents/INC-1/acknowledge", None, {"expectedVersion": 1, "reason": "x"}))[0] == 401


def test_needs_an_idempotency_key(writer: core.Store) -> None:
    status, body = call(post("/v1/incidents/INC-1/acknowledge", OP, {"expectedVersion": 1, "reason": "x"}, key=None))
    assert (status, body["error"]["code"]) == (400, "IDEMPOTENCY_KEY_REQUIRED")


def test_replay_returns_the_same_result(writer: core.Store) -> None:
    first = call(post("/v1/incidents/INC-1/acknowledge", OP, {"expectedVersion": 1, "reason": "x"}))
    again = call(post("/v1/incidents/INC-1/acknowledge", OP, {"expectedVersion": 1, "reason": "x"}))
    assert first[0] == again[0] == 200
    assert first[1]["data"] == again[1]["data"]


def test_version_conflict_is_409(writer: core.Store) -> None:
    status, body = call(post("/v1/incidents/INC-1/acknowledge", OP, {"expectedVersion": 3, "reason": "x"}))
    assert (status, body["error"]["code"]) == (409, "VERSION_CONFLICT")


def test_bad_body_is_400(writer: core.Store) -> None:
    e = post("/v1/incidents/INC-1/acknowledge", OP, {})
    e["body"] = "not json"
    assert call(e)[0] == 400


def test_unknown_incident_is_404(writer: core.Store) -> None:
    assert call(post("/v1/incidents/INC-404/acknowledge", OP, {"expectedVersion": 1, "reason": "x"}))[0] == 404


def test_no_delete_or_patch_routes_exist(writer: core.Store) -> None:
    for method in ("DELETE", "PUT", "PATCH"):
        assert call(event(method, "/v1/incidents/INC-1", OP))[0] == 404


# ------------------------------------------------------- audit and list ---


@pytest.fixture
def reads(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeStore]:
    monkeypatch.setenv("INCIDENTS_TABLE", "inc")
    monkeypatch.setenv("AUDIT_TABLE", "aud")
    monkeypatch.setenv("RESOURCES_TABLE", "res")
    s = FakeStore(
        {
            "inc": [
                {"incidentId": f"INC-{n}", "state": st, "severity": sev, "openedAt": f"2026-11-1{n}T00:00:00Z"}
                for n, st, sev in [(1, "OPEN", "HIGH"), (2, "RESOLVED", "LOW"), (3, "ACKNOWLEDGED", "HIGH")]
            ],
            "aud": [
                {
                    "PK": "INCIDENT#INC-1",
                    "SK": "2026-11-12T06:34:24Z#a",
                    "action": "INCIDENT_OPENED",
                    "occurredAt": "2026-11-12T06:34:24Z",
                },
                {"PK": "EVENT#abc", "SK": "EVENT"},
                {"PK": "IDEMPOTENCY#k", "SK": "IDEMPOTENCY", "response": "{}"},
            ],
        }
    )
    h.set_store(s)
    yield s
    h.set_store(None)


def test_audit_is_admin_only_and_hides_internal_items(reads: FakeStore) -> None:
    assert call(event("GET", "/v1/audit", access("[operator]")))[0] == 403
    status, body = call(event("GET", "/v1/audit", access("[admin]")))
    assert status == 200
    assert [a["action"] for a in body["data"]] == ["INCIDENT_OPENED"]


def with_query(e: dict[str, Any], q: dict[str, str]) -> dict[str, Any]:
    e["queryStringParameters"] = q
    return e


def test_incident_filters_and_paging(reads: FakeStore) -> None:
    v = access("[viewer]")
    _, body = call(with_query(event("GET", "/v1/incidents", v), {"state": "ACTIVE"}))
    assert {i["id"] for i in body["data"]} == {"INC-1", "INC-3"}
    _, body = call(with_query(event("GET", "/v1/incidents", v), {"severity": "LOW"}))
    assert [i["id"] for i in body["data"]] == ["INC-2"]
    _, page1 = call(with_query(event("GET", "/v1/incidents", v), {"limit": "2"}))
    assert len(page1["data"]) == 2 and page1["meta"]["nextToken"]
    _, page2 = call(
        with_query(event("GET", "/v1/incidents", v), {"limit": "2", "nextToken": page1["meta"]["nextToken"]})
    )
    assert len(page2["data"]) == 1 and "nextToken" not in page2["meta"]
    assert call(with_query(event("GET", "/v1/incidents", v), {"limit": "x"}))[0] == 400
