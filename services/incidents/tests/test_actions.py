"""User transitions: roles, versions, idempotency, append-only audit."""

import pytest

from conftest import alarm_event, incidents, ingest_event, timeline
from opsentra_incidents import core


@pytest.fixture
def incident_id(store: core.Store, emails: list) -> str:
    ingest_event(store, alarm_event())
    return incidents(store)[0]["incidentId"]


def act(
    store: core.Store,
    iid: str,
    command: str,
    version: int = 1,
    role: str = "OPERATOR",
    key: str = "k1",
    reason: str = "mine",
) -> dict:
    return core.user_transition(
        store,
        incident_id=iid,
        command=command,
        role=role,
        actor="opsentra-operator",
        expected_version=version,
        reason=reason,
        idempotency_key=key,
    )


def test_acknowledge_then_investigate(store: core.Store, incident_id: str) -> None:
    r = act(store, incident_id, "acknowledge")
    assert r["incident"]["state"] == "ACKNOWLEDGED" and r["incident"]["version"] == 2
    assert r["incident"]["assignedTo"] == "opsentra-operator" and r["incident"]["acknowledgedAt"]
    act(store, incident_id, "investigate", version=2, key="k2", reason="")
    assert incidents(store)[0]["state"] == "INVESTIGATING"
    events = timeline(store, incident_id)
    assert events.index("INCIDENT_ACKNOWLEDGED") < events.index("INVESTIGATION_STARTED")


def test_viewer_is_forbidden(store: core.Store, incident_id: str) -> None:
    with pytest.raises(core.IncidentError) as e:
        act(store, incident_id, "acknowledge", role="VIEWER")
    assert e.value.status == 403


def test_stale_version_is_409_and_changes_nothing(store: core.Store, incident_id: str) -> None:
    """§10.2 test 6."""
    with pytest.raises(core.IncidentError) as e:
        act(store, incident_id, "acknowledge", version=7)
    assert (e.value.status, e.value.code) == (409, "VERSION_CONFLICT")
    assert incidents(store)[0]["state"] == "OPEN"


def test_wrong_state_is_409(store: core.Store, incident_id: str) -> None:
    with pytest.raises(core.IncidentError) as e:
        act(store, incident_id, "close")
    assert e.value.code == "INVALID_STATE"


def test_replay_returns_the_original_result_once(store: core.Store, incident_id: str) -> None:
    first = act(store, incident_id, "acknowledge", key="same")
    again = act(store, incident_id, "acknowledge", key="same")
    assert again == first
    assert timeline(store, incident_id).count("INCIDENT_ACKNOWLEDGED") == 1


def test_key_reused_for_another_request_is_refused(store: core.Store, incident_id: str) -> None:
    act(store, incident_id, "acknowledge", key="same")
    with pytest.raises(core.IncidentError) as e:
        act(store, incident_id, "investigate", version=2, key="same", reason="")
    assert e.value.code == "IDEMPOTENCY_KEY_REUSED"


@pytest.mark.parametrize(
    ("version", "key", "reason", "code"),
    [
        ("1", "k", "x", "VALIDATION"),
        (True, "k", "x", "VALIDATION"),
        (1, "", "x", "IDEMPOTENCY_KEY_REQUIRED"),
        (1, "k", "   ", "VALIDATION"),
    ],
)
def test_input_validation(
    store: core.Store, incident_id: str, version: object, key: str, reason: str, code: str
) -> None:
    with pytest.raises(core.IncidentError) as e:
        core.user_transition(
            store,
            incident_id=incident_id,
            command="acknowledge",
            role="ADMIN",
            actor="a",
            expected_version=version,
            reason=reason,
            idempotency_key=key,
        )
    assert e.value.code == code


def test_audit_items_are_append_only(store: core.Store, incident_id: str) -> None:
    item = store.c.scan(
        TableName="aud", FilterExpression="begins_with(PK, :p)", ExpressionAttributeValues={":p": {"S": "INCIDENT#"}}
    )["Items"][0]
    with pytest.raises(Exception) as e:
        store.c.transact_write_items(
            TransactItems=[
                {"Put": {"TableName": "aud", "Item": item, "ConditionExpression": "attribute_not_exists(PK)"}}
            ]
        )
    assert "TransactionCanceled" in type(e.value).__name__ or "TransactionCanceled" in str(e.value)
