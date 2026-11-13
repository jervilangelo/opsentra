"""Phase 8 Live analytics (ADR-019, blueprint §4.5). Fixtures are the four real
incidents from the Phase 5-7 live gates, with hand-computed expectations."""

import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import boto3
import pytest
from moto import mock_aws
from opsentra_incidents import core

import opsentra_api.handler as h
from opsentra_api import analytics
from test_handler import access, call, event
from test_remediation_api import Reads

VIEWER = access("[viewer]", username="viewer-user")

# Real values (UTC) from opsentra-dev-incidents on 2026-11-13.
INCIDENTS = [
    {
        "id": "INC-20261112-0DA419",
        "state": "RESOLVED",
        "severity": "HIGH",
        "openedAt": "2026-11-12T07:39:15Z",
        "detectedAt": "2026-11-12T07:39:15Z",
        "acknowledgedAt": "2026-11-12T07:43:25Z",
        "verifiedHealthyAt": "2026-11-12T07:47:46Z",
    },
    {
        "id": "INC-20261112-1838F3",
        "state": "ESCALATED",
        "severity": "HIGH",
        "openedAt": "2026-11-12T08:38:27Z",
        "detectedAt": "2026-11-12T08:38:26Z",
        "acknowledgedAt": "2026-11-12T08:39:20Z",
    },
    {
        "id": "INC-20261113-1D4F09",
        "state": "RESOLVED",
        "severity": "HIGH",
        "openedAt": "2026-11-13T01:49:49Z",
        "detectedAt": "2026-11-13T01:49:49Z",
        "acknowledgedAt": "2026-11-13T01:51:45Z",
        "verifiedHealthyAt": "2026-11-13T01:59:07Z",
    },
    {
        "id": "INC-20261113-4DEF6A",
        "state": "RESOLVED",
        "severity": "HIGH",
        "openedAt": "2026-11-13T02:08:50Z",
        "detectedAt": "2026-11-13T02:08:49Z",
        "acknowledgedAt": "2026-11-13T02:09:47Z",
        "verifiedHealthyAt": "2026-11-13T02:27:07Z",
    },
]
REMEDIATIONS = [
    {"requestId": "REQ-20261112-E3312F", "incidentId": "INC-20261112-1838F3", "status": "SUCCEEDED"},
    {"requestId": "REQ-20261113-13927B", "incidentId": "INC-20261113-1D4F09", "status": "SUCCEEDED"},
    {"requestId": "REQ-20261113-37882C", "incidentId": "INC-20261113-4DEF6A", "status": "SUCCEEDED"},
    {"requestId": "REQ-OTHER", "incidentId": "INC-OUT-OF-RANGE", "status": "FAILED"},
]
EVIDENCE = {
    "INC-20261112-0DA419": {"check": "independent HTTP probe", "afterClear": "2026-11-12T07:44:15Z"},
    "INC-20261113-1D4F09": {"check": "independent HTTP probe", "requestId": "REQ-20261113-13927B"},
    "INC-20261113-4DEF6A": {"check": "independent HTTP probe", "afterClear": "2026-11-13T02:23:49Z"},
}
FROM, TO = analytics.parse("2026-11-12T00:00:00Z"), analytics.parse("2026-11-14T00:00:00Z")


def test_live_gate_incidents_reconcile_by_hand() -> None:
    out = analytics.compute(INCIDENTS, REMEDIATIONS, EVIDENCE, {"healthy": 60, "total": 90}, FROM, TO)
    assert out["incidentCount"] == 4
    assert out["bySeverity"] == {"CRITICAL": 0, "HIGH": 4, "MEDIUM": 0, "LOW": 0}
    assert (out["active"], out["escalated"]) == (1, 1)
    # MTTA: 250, 54, 116, 58 s -> mean 119.5 -> 120 (halves up, like Math.round); median (58+116)/2 = 87.
    assert out["mtta"] == {"count": 4, "excluded": 0, "meanSeconds": 120, "medianSeconds": 87}
    # MTTR: 511, 558, 1098 s -> mean 722.33 -> 722; median 558; the escalated one is excluded.
    assert out["mttr"] == {"count": 3, "excluded": 1, "meanSeconds": 722, "medianSeconds": 558}
    assert out["runbooks"] == {"succeeded": 3, "failed": 0, "rejected": 0, "total": 3}
    assert out["recoveries"] == {"afterRunbook": 1, "selfHealed": 2, "unknown": 0}
    assert out["availability"] == {"healthyProbes": 60, "totalProbes": 90, "expectedProbes": 2880}
    assert any("cover 3%" in n for n in out["dataQuality"])
    assert any("no verified recovery" in n for n in out["dataQuality"])


def test_tiny_coverage_is_not_rounded_to_zero() -> None:
    out = analytics.compute([], [], {}, {"healthy": 55, "total": 128}, FROM, FROM + timedelta(days=30))
    assert any("cover less than 1% of this range" in n for n in out["dataQuality"])


def test_range_filters_by_detection_time() -> None:
    out = analytics.compute(INCIDENTS, REMEDIATIONS, EVIDENCE, None, analytics.parse("2026-11-13T00:00:00Z"), TO)
    assert out["incidentCount"] == 2 and out["runbooks"]["total"] == 2
    assert "medianSeconds" not in out["mtta"]  # n = 2 < 3: no median


def test_no_probes_means_unknown_never_zero_or_full() -> None:
    for probes, note in ((None, "could not be read"), ({"healthy": 0, "total": 0}, "no health probes ran")):
        out = analytics.compute(INCIDENTS, [], {}, probes, FROM, TO)
        assert "availability" not in out
        assert any(note in n for n in out["dataQuality"])


def test_empty_range_has_honest_denominators() -> None:
    out = analytics.compute([], [], {}, None, FROM, TO)
    assert out["incidentCount"] == 0
    assert out["mtta"] == {"count": 0, "excluded": 0} and out["mttr"] == {"count": 0, "excluded": 0}
    assert out["runbooks"]["total"] == 0


def test_percentiles_need_enough_data() -> None:
    rows = [
        {"id": f"I{n}", "detectedAt": "2026-11-13T00:00:00Z", "acknowledgedAt": f"2026-11-13T00:00:{n:02d}Z"}
        for n in range(1, 11)
    ]
    m = analytics.mean_duration(rows, "acknowledgedAt")
    assert (m["meanSeconds"], m["medianSeconds"], m["p90Seconds"]) == (6, 6, 9)  # 5.5 -> 6; nearest rank 9


def test_unknown_recovery_evidence_is_flagged() -> None:
    out = analytics.compute(INCIDENTS, [], {}, None, FROM, TO)
    assert out["recoveries"]["unknown"] == 3
    assert any("no recorded evidence type" in n for n in out["dataQuality"])


@pytest.mark.parametrize(
    ("frm", "to", "message"),
    [
        ("2026-11-13", "2026-11-12T00:00:00Z", "UTC offset"),
        ("2026-11-14T00:00:00Z", "2026-11-13T00:00:00Z", "before"),
        ("2026-01-01T00:00:00Z", "2026-11-13T00:00:00Z", "92 days"),
        ("2026-11-13T00:00:00Z", "2026-11-14T00:00:00Z", "future"),
        ("yesterday", None, "ISO-8601"),
    ],
)
def test_bad_ranges_are_rejected(frm: str, to: str | None, message: str) -> None:
    now = analytics.parse("2026-11-13T03:00:00Z")
    with pytest.raises(analytics.RangeError, match=message):
        analytics.parse_range(frm, to, now)


def test_default_range_is_thirty_days() -> None:
    now = analytics.parse("2026-11-13T03:00:00Z")
    frm, to = analytics.parse_range(None, None, now)
    assert (to, to - frm) == (now, timedelta(days=30))


def test_probe_period_follows_cloudwatch_retention() -> None:
    now = datetime(2026, 11, 13, tzinfo=UTC)
    assert h.probe_period(now - timedelta(days=1), now, now) == 60
    assert h.probe_period(now - timedelta(days=30), now, now) == 300
    assert h.probe_period(now - timedelta(days=90), now, now) == 3600


# ------------------------------------------------------------------- route ---


class FakeCloudWatch:
    def __init__(self, fail: bool = False) -> None:
        self.calls: list[dict[str, Any]] = []
        self.fail = fail

    def get_metric_statistics(self, **kw: Any) -> dict[str, Any]:
        if self.fail:
            raise RuntimeError("AccessDenied")
        self.calls.append(kw)
        return {"Datapoints": [{"Sum": 40.0, "SampleCount": 45.0}, {"Sum": 5.0, "SampleCount": 5.0}]}


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeCloudWatch]:
    for k, v in {
        "AWS_ACCESS_KEY_ID": "t",
        "AWS_SECRET_ACCESS_KEY": "t",
        "AWS_DEFAULT_REGION": "ap-southeast-1",
        "INCIDENTS_TABLE": "inc",
        "AUDIT_TABLE": "aud",
        "REMEDIATIONS_TABLE": "rem",
    }.items():
        monkeypatch.setenv(k, v)
    cw = FakeCloudWatch()
    h.set_cloudwatch(cw)
    monkeypatch.setattr(h, "utcnow", lambda: analytics.parse("2026-11-13T03:00:00Z"))
    with mock_aws():
        ddb = boto3.client("dynamodb", region_name="ap-southeast-1")
        for name, keys in {
            "inc": [("incidentId", "HASH")],
            "aud": [("PK", "HASH"), ("SK", "RANGE")],
            "rem": [("requestId", "HASH")],
        }.items():
            ddb.create_table(
                TableName=name,
                BillingMode="PAY_PER_REQUEST",
                AttributeDefinitions=[{"AttributeName": k, "AttributeType": "S"} for k, _ in keys],
                KeySchema=[{"AttributeName": k, "KeyType": t} for k, t in keys],
            )
        for i in INCIDENTS:
            item = {("incidentId" if k == "id" else k): v for k, v in i.items()}
            ddb.put_item(TableName="inc", Item=core.ser_item({**item, "version": 5, "correlationKey": "c"}))
        for r in REMEDIATIONS:
            ddb.put_item(TableName="rem", Item=core.ser_item({**r, "requestedAt": "2026-11-13T00:00:00Z"}))
        for iid, detail in EVIDENCE.items():
            ddb.put_item(
                TableName="aud",
                Item=core.ser_item(
                    {
                        "PK": f"INCIDENT#{iid}",
                        "SK": "2026-11-13T00:00:00Z#1",
                        "eventType": "HEALTH_VERIFIED",
                        "detail": detail,
                    }
                ),
            )
        h.set_store(Reads(ddb))  # type: ignore[arg-type]
        yield cw
        h.set_store(None)
        h.set_cloudwatch(None)


def q(**params: str) -> dict[str, Any]:
    e = event("GET", "/v1/analytics", VIEWER)
    e["queryStringParameters"] = params
    return e


def test_route_needs_a_token(api: FakeCloudWatch) -> None:
    assert call(event("GET", "/v1/analytics"))[0] == 401


def test_route_returns_the_same_numbers_as_the_pure_function(api: FakeCloudWatch) -> None:
    status, body = call(q(**{"from": "2026-11-12T00:00:00Z", "to": "2026-11-13T03:00:00Z"}))
    assert status == 200 and body["meta"]["dataset"] == "live"
    data = body["data"]
    assert data["mtta"]["meanSeconds"] == 120 and data["mttr"]["meanSeconds"] == 722
    assert data["recoveries"] == {"afterRunbook": 1, "selfHealed": 2, "unknown": 0}
    # 27 h at 1-minute resolution = 2 calls (at most 1,440 points each); the fake returns 45/50 per call.
    assert data["availability"]["healthyProbes"] == 90 and data["availability"]["totalProbes"] == 100
    first, second = api.calls
    assert first["Namespace"] == "Opsentra/Lab" and first["Statistics"] == ["Sum", "SampleCount"]
    assert first["Period"] == 60 and first["EndTime"] == second["StartTime"]  # contiguous, no overlap
    assert (second["EndTime"] - first["StartTime"]) == timedelta(hours=27)
    assert "arn" not in json.dumps(body).lower()


def test_metric_failure_is_unknown_not_zero(api: FakeCloudWatch) -> None:
    api.fail = True
    status, body = call(q(**{"from": "2026-11-12T00:00:00Z", "to": "2026-11-13T03:00:00Z"}))
    assert status == 200 and "availability" not in body["data"]
    assert any("could not be read" in n for n in body["data"]["dataQuality"])


def test_bad_range_is_400(api: FakeCloudWatch) -> None:
    status, body = call(q(**{"from": "2026-11-14T00:00:00Z", "to": "2026-11-13T00:00:00Z"}))
    assert (status, body["error"]["code"]) == (400, "VALIDATION")
