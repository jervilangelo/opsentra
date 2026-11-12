from collections.abc import Iterator, Mapping
from typing import Any

import pytest

import opsentra_api.handler as h
from test_handler import access, call, event


class FakeStore:
    def __init__(self, data: dict[str, list[dict[str, Any]]]) -> None:
        self.data = data

    def scan(self, table: str) -> Iterator[dict[str, Any]]:
        yield from self.data.get(table, [])

    def get(self, table: str, key: Mapping[str, Any]) -> dict[str, Any] | None:
        ((name, value),) = key.items()
        return next((i for i in self.data.get(table, []) if i.get(name) == value), None)

    def query_pk(self, table: str, pk_name: str, pk_value: str) -> list[dict[str, Any]]:
        return [i for i in self.data.get(table, []) if i.get(pk_name) == pk_value]


ARN = "arn:aws:ec2:ap-southeast-1:000000000000:instance/i-0lab"

DATA = {
    "res": [
        {
            "resourceId": "i-0lab",
            "type": "EC2",
            "environment": "lab",
            "region": "ap-southeast-1",
            "health": "HEALTHY",
            "lastCheckedAt": "2026-11-12T05:00:00Z",
            "arn": ARN,
            "allowedRunbookIds": ["rb-restart-nginx"],
        },
        {"resourceId": "opsentra-lab-regression", "type": "LAMBDA", "health": "weird-value"},
    ],
    "inc": [],
    "aud": [],
}


@pytest.fixture(autouse=True)
def fake_store(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeStore]:
    monkeypatch.setenv("RESOURCES_TABLE", "res")
    monkeypatch.setenv("INCIDENTS_TABLE", "inc")
    monkeypatch.setenv("AUDIT_TABLE", "aud")
    store = FakeStore({k: [dict(i) for i in v] for k, v in DATA.items()})
    h.set_store(store)
    yield store
    h.set_store(None)


VIEWER = access("[viewer]")


@pytest.mark.parametrize("path", ["/v1/overview", "/v1/resources", "/v1/resources/i-0lab", "/v1/incidents"])
def test_reads_need_a_token(path: str) -> None:
    assert call(event("GET", path))[0] == 401


@pytest.mark.parametrize("path", ["/v1/overview", "/v1/resources", "/v1/incidents"])
def test_reads_need_a_role(path: str) -> None:
    assert call(event("GET", path, access(None)))[0] == 403


def test_resources_are_shaped_and_never_leak_arns() -> None:
    status, body = call(event("GET", "/v1/resources", VIEWER))
    assert status == 200
    assert body["meta"]["dataset"] == "live"
    first = body["data"][0]
    assert first == {
        "id": "i-0lab",
        "type": "EC2",
        "environment": "lab",
        "region": "ap-southeast-1",
        "health": "HEALTHY",
        "evidenceAvailable": True,
        "lastCheckedAt": "2026-11-12T05:00:00Z",
    }
    raw = str(body)
    assert "arn:aws" not in raw and "000000000000" not in raw and "allowedRunbookIds" not in raw


def test_unknown_health_values_become_unknown() -> None:
    _, body = call(event("GET", "/v1/resources", VIEWER))
    fn = next(r for r in body["data"] if r["id"] == "opsentra-lab-regression")
    assert fn["health"] == "UNKNOWN"
    assert fn["evidenceAvailable"] is False


def test_overview_counts_come_from_rows() -> None:
    status, body = call(event("GET", "/v1/overview", VIEWER))
    assert status == 200
    assert body["data"] == {
        "monitoredResources": 2,
        "healthCounts": {"HEALTHY": 1, "DEGRADED": 0, "UNHEALTHY": 0, "UNKNOWN": 1},
        "activeIncidents": 0,
        "activeBySeverity": {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0},
        "lastSyncAt": "2026-11-12T05:00:00Z",
    }


def test_empty_incidents_are_an_honest_empty_list() -> None:
    status, body = call(event("GET", "/v1/incidents", VIEWER))
    assert (status, body["data"]) == (200, [])


def test_missing_items_are_404_in_the_envelope() -> None:
    status, body = call(event("GET", "/v1/resources/i-nope", VIEWER))
    assert status == 404 and body["error"]["code"] == "NOT_FOUND"
    assert call(event("GET", "/v1/incidents/INC-1", VIEWER))[0] == 404
    assert call(event("GET", "/v1/incidents/INC-1/timeline", VIEWER))[0] == 404


def test_timeline_is_ordered(fake_store: FakeStore) -> None:
    fake_store.data["inc"].append(
        {"incidentId": "INC-1", "title": "t", "severity": "HIGH", "state": "OPEN", "openedAt": "2026-11-12T05:01:00Z"}
    )
    fake_store.data["aud"] += [
        {"PK": "INCIDENT#INC-1", "SK": "2026-11-12T05:02:00Z#b", "eventType": "B"},
        {"PK": "INCIDENT#INC-1", "SK": "2026-11-12T05:01:00Z#a", "eventType": "A", "actorType": "USER", "actorId": "u"},
    ]
    status, body = call(event("GET", "/v1/incidents/INC-1/timeline", VIEWER))
    assert status == 200
    assert [e["eventType"] for e in body["data"]] == ["A", "B"]
    assert body["data"][0]["actorType"] == "USER"


def test_path_ids_are_validated() -> None:
    assert call(event("GET", "/v1/resources/../../etc", VIEWER))[0] == 404
    assert call(event("GET", "/v1/resources/" + "x" * 200, VIEWER))[0] == 404
