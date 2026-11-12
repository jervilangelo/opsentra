"""Phase 5 gate behaviours (blueprint §7 Phase 5, §10.2 tests 4, 5, 6, 9)."""

from typing import Any

import pytest

from conftest import ALARM, alarm_event, incidents, ingest_event, timeline
from opsentra_incidents import core, reconciler


def test_alarm_opens_exactly_one_incident_and_one_email(store: core.Store, emails: list) -> None:
    out = ingest_event(store, alarm_event())
    assert out["result"] == "opened" and out["created"] is True
    [inc] = incidents(store)
    assert inc["state"] == "OPEN" and inc["version"] == 1 and inc["severity"] == "HIGH"
    assert inc["detectedAt"] == "2026-11-12T06:34:24Z"
    assert inc["title"] == "Nginx health check failing on the lab web server"
    assert timeline(store, inc["incidentId"]) == ["ALARM_STATE_CHANGED", "INCIDENT_OPENED"]
    assert len(emails) == 1


def test_duplicate_delivery_is_a_no_op(store: core.Store, emails: list) -> None:
    ingest_event(store, alarm_event())
    out = ingest_event(store, alarm_event())  # same event id
    assert out["result"] == "duplicate"
    assert len(incidents(store)) == 1 and len(emails) == 1


def test_repeated_alarm_adds_evidence_not_an_incident(store: core.Store, emails: list) -> None:
    ingest_event(store, alarm_event())
    out = ingest_event(store, alarm_event(ts="2026-11-12T06:40:00Z", event_id="evt-2"))
    assert out["result"] == "repeated"
    [inc] = incidents(store)
    assert inc["lastSignalAt"] == "2026-11-12T06:40:00Z"
    assert timeline(store, inc["incidentId"]).count("ALARM_REPEATED") == 1
    assert len(emails) == 1  # §10.2 test 4: no repeated notification


def test_delayed_alarm_does_not_move_last_signal_back(store: core.Store, emails: list) -> None:
    ingest_event(store, alarm_event(ts="2026-11-12T06:40:00Z"))
    ingest_event(store, alarm_event(ts="2026-11-12T06:30:00Z", event_id="evt-old"))
    [inc] = incidents(store)
    assert inc["lastSignalAt"] == "2026-11-12T06:40:00Z"


@pytest.mark.parametrize(
    ("override", "why"),
    [
        ({"source": "my.app"}, "unexpected source"),
        ({"account": "999999999999"}, "foreign account or region"),
        ({"region": "us-east-1"}, "foreign account or region"),
        (
            {
                "detail": {
                    "alarmName": "someone-elses-alarm",
                    "state": {"value": "ALARM", "timestamp": "2026-11-12T06:34:24Z"},
                }
            },
            "alarm not registered",
        ),
        ({"detail": {"alarmName": ALARM, "state": {"value": "BROKEN"}}}, "unexpected state"),
        (
            {"detail": {"alarmName": ALARM, "state": {"value": "ALARM", "timestamp": "yesterday"}}, "time": "x"},
            "bad timestamp",
        ),
        ({"detail": "not-an-object"}, "missing detail"),
        ({"id": ""}, "missing alarm name or event id"),
    ],
)
def test_malformed_or_foreign_events_write_nothing(store: core.Store, emails: list, override: dict, why: str) -> None:
    out = ingest_event(store, alarm_event(**override))
    assert out == {"result": "rejected", "why": why}
    assert incidents(store) == [] and emails == []
    assert store.c.scan(TableName="aud")["Count"] == 0


def test_ok_before_any_alarm_is_ignored(store: core.Store, emails: list) -> None:
    assert ingest_event(store, alarm_event("OK"))["result"] == "ignored"
    assert incidents(store) == []


def test_ok_records_a_clear_but_never_resolves(store: core.Store, emails: list) -> None:
    ingest_event(store, alarm_event())
    out = ingest_event(store, alarm_event("OK", ts="2026-11-12T06:37:24Z", event_id="evt-ok"))
    assert out["result"] == "cleared"
    [inc] = incidents(store)
    assert inc["state"] == "OPEN" and inc["signalClearedAt"] == "2026-11-12T06:37:24Z"
    assert "verifiedHealthyAt" not in inc and "resolvedAt" not in inc


def test_out_of_order_ok_older_than_alarm_is_ignored(store: core.Store, emails: list) -> None:
    ingest_event(store, alarm_event(ts="2026-11-12T06:40:00Z"))
    out = ingest_event(store, alarm_event("OK", ts="2026-11-12T06:35:00Z", event_id="evt-ok-old"))
    assert out["result"] == "stale"
    assert "signalClearedAt" not in incidents(store)[0]


def test_insufficient_data_is_not_a_signal(store: core.Store, emails: list) -> None:
    assert ingest_event(store, alarm_event("INSUFFICIENT_DATA"))["result"] == "ignored"


def test_concurrent_alarms_open_one_incident(store: core.Store, emails: list) -> None:
    # Two different deliveries racing: the conditional transaction lets one win.
    a = ingest_event(store, alarm_event(event_id="race-a"))
    b = ingest_event(store, alarm_event(event_id="race-b", ts="2026-11-12T06:34:25Z"))
    assert {a["result"], b["result"]} == {"opened", "repeated"}
    assert len(incidents(store)) == 1 and len(emails) == 1


# --------------------------------------------------------- self-heal ---


class FakeCloudWatch:
    def __init__(self, state: str, at: str) -> None:
        from datetime import datetime

        self.alarm = {
            "AlarmName": ALARM,
            "StateValue": state,
            "StateUpdatedTimestamp": datetime.fromisoformat(at.replace("Z", "+00:00")),
        }

    def describe_alarms(self, **_: Any) -> dict:
        return {"MetricAlarms": [self.alarm]}


def set_health(store: core.Store, health: str, checked: str) -> None:
    store.c.update_item(
        TableName="res",
        Key={"resourceId": {"S": "i-0lab"}},
        UpdateExpression="SET health = :h, lastCheckedAt = :c",
        ExpressionAttributeValues={":h": {"S": health}, ":c": {"S": checked}},
    )


def reconcile(store: core.Store, state: str, at: str) -> dict:
    return reconciler.run(store, FakeCloudWatch(state, at), "111122223333", "ap-southeast-1", "")


def test_self_heal_needs_a_healthy_probe_two_minutes_after_the_clear(store: core.Store, emails: list) -> None:
    ingest_event(store, alarm_event())
    ingest_event(store, alarm_event("OK", ts="2026-11-12T06:37:24Z", event_id="ok"))

    set_health(store, "HEALTHY", "2026-11-12T06:38:00Z")  # only 36 s after the clear
    assert reconcile(store, "OK", "2026-11-12T06:37:24Z")["resolved"] == 0
    set_health(store, "UNHEALTHY", "2026-11-12T06:40:00Z")  # probe disagrees
    assert reconcile(store, "OK", "2026-11-12T06:37:24Z")["resolved"] == 0

    set_health(store, "HEALTHY", "2026-11-12T06:39:30Z")
    assert reconcile(store, "OK", "2026-11-12T06:37:24Z")["resolved"] == 1
    [inc] = incidents(store)
    assert inc["state"] == "RESOLVED" and inc["verifiedHealthyAt"] == "2026-11-12T06:39:30Z"
    events = timeline(store, inc["incidentId"])
    assert {"HEALTH_VERIFIED", "INCIDENT_RESOLVED"} <= set(events)


def test_never_resolves_while_the_alarm_is_still_firing(store: core.Store, emails: list) -> None:
    ingest_event(store, alarm_event())
    ingest_event(store, alarm_event("OK", ts="2026-11-12T06:37:24Z", event_id="ok"))
    set_health(store, "HEALTHY", "2026-11-12T06:45:00Z")
    assert reconcile(store, "ALARM", "2026-11-12T06:44:00Z")["resolved"] == 0


def test_old_alarm_never_reopens_a_resolved_episode(store: core.Store, emails: list) -> None:
    """§10.2 test 9 / §4.4: out-of-order ALARM after a verified resolution."""
    ingest_event(store, alarm_event())
    ingest_event(store, alarm_event("OK", ts="2026-11-12T06:37:24Z", event_id="ok"))
    set_health(store, "HEALTHY", "2026-11-12T06:40:00Z")
    reconcile(store, "OK", "2026-11-12T06:37:24Z")
    out = ingest_event(store, alarm_event(ts="2026-11-12T06:36:00Z", event_id="late"))
    assert out["result"] == "stale"
    assert len(incidents(store)) == 1 and len(emails) == 1


def test_a_new_alarm_after_resolution_opens_a_new_incident(store: core.Store, emails: list) -> None:
    ingest_event(store, alarm_event())
    ingest_event(store, alarm_event("OK", ts="2026-11-12T06:37:24Z", event_id="ok"))
    set_health(store, "HEALTHY", "2026-11-12T06:40:00Z")
    reconcile(store, "OK", "2026-11-12T06:37:24Z")
    out = ingest_event(store, alarm_event(ts="2099-01-01T00:00:00Z", event_id="new"))
    assert out["result"] == "opened"
    assert len(incidents(store)) == 2 and len(emails) == 2


def test_reconciler_repairs_a_missed_alarm_once(store: core.Store, emails: list) -> None:
    assert reconcile(store, "ALARM", "2026-11-12T06:34:24Z")["opened"] == 1
    assert reconcile(store, "ALARM", "2026-11-12T06:34:24Z")["opened"] == 0
    [inc] = incidents(store)
    assert inc["source"] == "reconciler" and len(emails) == 1


def test_reconciler_repairs_a_missed_ok(store: core.Store, emails: list) -> None:
    ingest_event(store, alarm_event())
    assert reconcile(store, "OK", "2026-11-12T06:37:24Z")["cleared"] == 1
    assert incidents(store)[0]["signalClearedAt"] == "2026-11-12T06:37:24Z"
