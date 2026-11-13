"""Phase 6: approved remediation (ADR-017). Gate: unauthorized and arbitrary
operations denied; SSM success never means recovered; replay never repeats."""

from datetime import timedelta
from typing import Any

import pytest

from conftest import (
    ACCOUNT,
    DOC_HASH,
    REGION,
    RESOURCE,
    alarm_event,
    check_update_expression,
    incidents,
    ingest_event,
    timeline,
)
from opsentra_incidents import coordinator, core, remediation


class FakeSSM:
    def __init__(self, fail: bool = False) -> None:
        self.sent: list[dict[str, Any]] = []
        self.fail = fail
        self.status: dict[str, str] = {}

    def send_command(self, **kw: Any) -> dict[str, Any]:
        if self.fail:
            raise RuntimeError("AccessDenied")
        self.sent.append(kw)
        return {"Command": {"CommandId": f"cmd-{len(self.sent)}"}}

    def get_command_invocation(self, CommandId: str, InstanceId: str) -> dict[str, str]:  # noqa: N803
        return {"Status": self.status.get(CommandId, "InProgress")}


class FakeEC2:
    def __init__(self, lab: bool = True, state: str = "running") -> None:
        self.lab, self.state = lab, state

    def describe_instances(self, InstanceIds: list[str]) -> dict[str, Any]:  # noqa: N803
        tags = [{"Key": "opsentra:lab", "Value": "true" if self.lab else "false"}]
        return {
            "Reservations": [
                {"Instances": [{"InstanceId": InstanceIds[0], "Tags": tags, "State": {"Name": self.state}}]}
            ]
        }


@pytest.fixture
def investigating(store: core.Store, emails: list) -> str:
    ingest_event(store, alarm_event())
    iid = incidents(store)[0]["incidentId"]
    for n, cmd in enumerate(("acknowledge", "investigate"), start=1):
        core.user_transition(
            store,
            incident_id=iid,
            command=cmd,
            role="OPERATOR",
            actor="opsentra-operator",
            expected_version=n,
            reason="mine",
            idempotency_key=f"setup-{n}",
        )
    return iid


def inc(store: core.Store, iid: str) -> dict[str, Any]:
    return store.incident(iid) or {}


def ask(
    store: core.Store,
    iid: str,
    *,
    role: str = "OPERATOR",
    runbook: Any = "rb-restart-nginx",
    key: str = "r1",
    actor: str = "opsentra-operator",
) -> dict[str, Any]:
    return remediation.request_remediation(
        store,
        incident_id=iid,
        role=role,
        actor=actor,
        expected_version=inc(store, iid)["version"],
        runbook_id=runbook,
        reason="Nginx is down",
        idempotency_key=key,
    )


def decide(
    store: core.Store,
    rid: str,
    iid: str,
    *,
    decision: str = "APPROVE",
    role: str = "ADMIN",
    actor: str = "opsentra-admin",
    key: str = "d1",
    version: int | None = None,
) -> dict[str, Any]:
    return remediation.decide_remediation(
        store,
        request_id=rid,
        role=role,
        actor=actor,
        expected_version=version if version is not None else inc(store, iid)["version"],
        decision=decision,
        reason="approved for the lab",
        idempotency_key=key,
    )


def set_probe(store: core.Store, *, health: str, streak: int, since: str, checked: str) -> None:
    store.c.update_item(
        TableName="res",
        Key={"resourceId": {"S": RESOURCE}},
        UpdateExpression="SET health = :h, healthyStreak = :n, healthyStreakSince = :s, lastCheckedAt = :c",
        ExpressionAttributeValues={
            ":h": {"S": health},
            ":n": {"N": str(streak)},
            ":s": {"S": since},
            ":c": {"S": checked},
        },
    )


def shift(monkeypatch: pytest.MonkeyPatch, minutes: float) -> None:
    later = core.iso(core.parse_iso(core.now_iso()) + timedelta(minutes=minutes))
    monkeypatch.setattr(remediation, "now_iso", lambda: later)


def approved_and_sent(store: core.Store, iid: str, ssm: FakeSSM) -> str:
    rid = ask(store, iid)["request"]["requestId"]
    assert decide(store, rid, iid)["dispatch"] is True
    assert remediation.dispatch(store, ssm, FakeEC2(), rid) == "sent"
    return rid


def ssm_event(command_id: str, status: str, **over: Any) -> dict[str, Any]:
    e = {
        "source": "aws.ssm",
        "detail-type": "EC2 Command Status-change Notification",
        "account": ACCOUNT,
        "region": REGION,
        "detail": {"command-id": command_id, "status": status, "document-name": "Opsentra-Lab-RestartNginx"},
    }
    e.update(over)
    return e


# ------------------------------------------------------------ happy path ---


def test_full_flow_resolves_only_after_three_healthy_probes(
    store: core.Store, investigating: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    ssm = FakeSSM()
    rid = approved_and_sent(store, investigating, ssm)
    assert inc(store, investigating)["state"] == "REMEDIATING"
    [cmd] = ssm.sent
    assert cmd == {
        "InstanceIds": [RESOURCE],
        "DocumentName": "Opsentra-Lab-RestartNginx",
        "DocumentHash": DOC_HASH,
        "DocumentHashType": "Sha256",
        "TimeoutSeconds": 120,
        "Comment": f"Opsentra {rid}",
    }

    # SSM Success is not recovery.
    out = coordinator.handle(ssm_event("cmd-1", "Success"), store, ssm, FakeEC2(), ACCOUNT, REGION)
    assert out == {"result": "updated"}
    assert inc(store, investigating)["state"] == "VERIFYING"
    done = remediation.request(store, rid)["completedAt"]
    at = lambda m: core.iso(core.parse_iso(done) + timedelta(minutes=m))  # noqa: E731
    first, after = at(0.5), at(2.5)  # probes at +0.5, +1.5, +2.5 minutes

    res = lambda: store.get("res", {"resourceId": RESOURCE})  # noqa: E731
    set_probe(store, health="HEALTHY", streak=2, since=first, checked=at(1.5))  # only 2 probes
    assert remediation.verify(store, inc(store, investigating), res(), alarm_ok=True) == "waiting"
    set_probe(store, health="HEALTHY", streak=3, since=at(-2), checked=at(0.5))  # 2 of 3 before the fix
    assert remediation.verify(store, inc(store, investigating), res(), alarm_ok=True) == "waiting"
    set_probe(store, health="UNHEALTHY", streak=0, since=first, checked=after)  # streak broken
    assert remediation.verify(store, inc(store, investigating), res(), alarm_ok=True) == "waiting"
    set_probe(store, health="HEALTHY", streak=3, since=first, checked=after)
    later = at(4)  # the probes are in the past now
    monkeypatch.setattr(core, "now_iso", lambda: later)
    monkeypatch.setattr(remediation, "now_iso", lambda: later)
    assert remediation.verify(store, inc(store, investigating), res(), alarm_ok=False) == "waiting"
    assert remediation.verify(store, inc(store, investigating), res(), alarm_ok=True) == "resolved"

    final = inc(store, investigating)
    assert final["state"] == "RESOLVED" and final["verifiedHealthyAt"] == after
    assert remediation.request(store, rid)["status"] == "SUCCEEDED"
    events = timeline(store, investigating)
    order = [
        "REMEDIATION_REQUESTED",
        "REMEDIATION_APPROVED",
        "REMEDIATION_STARTED",
        "REMEDIATION_SUCCEEDED",
        "VERIFICATION_STARTED",
        "HEALTH_VERIFIED",
        "INCIDENT_RESOLVED",
    ]
    assert [e for e in events if e in order] == order


def test_self_approval_is_allowed_and_flagged(store: core.Store, investigating: str) -> None:
    rid = ask(store, investigating, role="ADMIN", actor="opsentra-admin")["request"]["requestId"]
    out = decide(store, rid, investigating, actor="opsentra-admin")
    assert out["request"]["selfApproved"] is True
    other = remediation.request(store, rid)
    assert other["approvedBy"] == "opsentra-admin"


# ------------------------------------------------------------- denials ---


def test_roles_are_enforced(store: core.Store, investigating: str) -> None:
    with pytest.raises(core.IncidentError) as e:
        ask(store, investigating, role="VIEWER")
    assert e.value.status == 403
    rid = ask(store, investigating)["request"]["requestId"]
    for role in ("VIEWER", "OPERATOR"):
        with pytest.raises(core.IncidentError) as e:
            decide(store, rid, investigating, role=role)
        assert e.value.status == 403
    assert remediation.request(store, rid)["status"] == "PENDING"


@pytest.mark.parametrize(
    "runbook,code",
    [
        ("rb-unknown", "RUNBOOK_NOT_ALLOWED"),
        ("rb-lambda-alias-rollback", "RUNBOOK_NOT_ALLOWED"),
        ("rb-restart-nginx; rm -rf /", "VALIDATION"),
        ("Opsentra-Lab-StopNginx", "VALIDATION"),
        ("../../etc", "VALIDATION"),
        ({"document": "AWS-RunShellScript"}, "VALIDATION"),
        (None, "VALIDATION"),
    ],
)
def test_arbitrary_runbooks_are_refused_without_writes(
    store: core.Store, investigating: str, runbook: Any, code: str
) -> None:
    with pytest.raises(core.IncidentError) as e:
        ask(store, investigating, runbook=runbook)
    assert (e.value.status, e.value.code) == (400, code)
    assert store.c.scan(TableName="rem")["Count"] == 0
    assert inc(store, investigating)["state"] == "INVESTIGATING"


def test_a_resource_without_registered_runbooks_gets_none(store: core.Store, investigating: str) -> None:
    store.c.update_item(TableName="res", Key={"resourceId": {"S": RESOURCE}}, UpdateExpression="REMOVE runbooks")
    with pytest.raises(core.IncidentError) as e:
        ask(store, investigating)
    assert e.value.code == "RUNBOOK_NOT_ALLOWED"


def test_a_changed_document_hash_is_not_allowlisted(store: core.Store, investigating: str) -> None:
    store.c.update_item(
        TableName="res",
        Key={"resourceId": {"S": RESOURCE}},
        UpdateExpression="SET runbooks = :r",
        ExpressionAttributeValues={
            ":r": core.ser({"rb-restart-nginx": {"document": "AWS-RunShellScript", "documentHash": DOC_HASH}})
        },
    )
    with pytest.raises(core.IncidentError) as e:
        ask(store, investigating)
    assert e.value.code == "RUNBOOK_NOT_ALLOWED"


def test_denied_attempts_are_audited_only_for_real_incidents(store: core.Store, investigating: str) -> None:
    core.record_denied(
        store,
        incident_id=investigating,
        action="REMEDIATION_DECISION",
        actor="opsentra-viewer",
        role="VIEWER",
        code="FORBIDDEN",
    )
    core.record_denied(store, incident_id="INC-NOPE", action="X", actor="a", role="VIEWER", code="FORBIDDEN")
    assert "REMEDIATION_DECISION_DENIED" in timeline(store, investigating)
    pks = {i["PK"]["S"] for i in store.c.scan(TableName="aud")["Items"]}
    assert "INCIDENT#INC-NOPE" not in pks


# -------------------------------------------------- expiry and replays ---


def test_expired_request_cannot_be_approved(
    store: core.Store, investigating: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    rid = ask(store, investigating)["request"]["requestId"]
    shift(monkeypatch, 16)
    with pytest.raises(core.IncidentError) as e:
        decide(store, rid, investigating)
    assert (e.value.status, e.value.code) == (409, "APPROVAL_EXPIRED")
    req = remediation.request(store, rid)
    assert (req["status"], req["errorSummary"]) == ("REJECTED", "Approval expired")
    assert inc(store, investigating)["state"] == "ESCALATED"
    assert remediation.dispatch(store, FakeSSM(), FakeEC2(), rid) == "skipped"


def test_reconciler_expires_pending_requests(
    store: core.Store, investigating: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    ask(store, investigating)
    shift(monkeypatch, 16)
    assert remediation.reconcile(store, FakeSSM(), FakeEC2())["expired"] == 1
    assert inc(store, investigating)["state"] == "ESCALATED"


def test_replayed_decision_never_dispatches_twice(store: core.Store, investigating: str) -> None:
    ssm = FakeSSM()
    rid = ask(store, investigating)["request"]["requestId"]
    first = decide(store, rid, investigating, version=4)
    again = decide(store, rid, investigating, version=4)
    assert first["dispatch"] is True and again["dispatch"] is False
    assert again["request"] == first["request"]
    with pytest.raises(core.IncidentError) as e:  # a new key for a decided request
        decide(store, rid, investigating, key="d2")
    assert e.value.status == 409
    remediation.dispatch(store, ssm, FakeEC2(), rid)
    remediation.dispatch(store, ssm, FakeEC2(), rid)
    coordinator.handle({"requestId": rid}, store, ssm, FakeEC2(), ACCOUNT, REGION)
    assert len(ssm.sent) == 1


def test_rejection_escalates_and_never_runs(store: core.Store, investigating: str) -> None:
    ssm = FakeSSM()
    rid = ask(store, investigating)["request"]["requestId"]
    assert decide(store, rid, investigating, decision="REJECT")["dispatch"] is False
    assert inc(store, investigating)["state"] == "ESCALATED"
    assert remediation.dispatch(store, ssm, FakeEC2(), rid) == "skipped"
    assert ssm.sent == []


# ------------------------------------------------------------- failures ---


def test_ssm_failure_escalates(store: core.Store, investigating: str) -> None:
    ssm = FakeSSM()
    rid = approved_and_sent(store, investigating, ssm)
    coordinator.handle(ssm_event("cmd-1", "TimedOut"), store, ssm, FakeEC2(), ACCOUNT, REGION)
    assert inc(store, investigating)["state"] == "ESCALATED"
    req = remediation.request(store, rid)
    assert (req["status"], req["errorSummary"]) == ("FAILED", "SSM status: TimedOut")


def test_send_refused_by_ssm_escalates(store: core.Store, investigating: str) -> None:
    rid = ask(store, investigating)["request"]["requestId"]
    decide(store, rid, investigating)
    assert remediation.dispatch(store, FakeSSM(fail=True), FakeEC2(), rid) == "failed"
    assert inc(store, investigating)["state"] == "ESCALATED"


@pytest.mark.parametrize("ec2", [FakeEC2(lab=False), FakeEC2(state="stopped")])
def test_untagged_or_stopped_target_is_never_sent(store: core.Store, investigating: str, ec2: FakeEC2) -> None:
    ssm = FakeSSM()
    rid = ask(store, investigating)["request"]["requestId"]
    decide(store, rid, investigating)
    assert remediation.dispatch(store, ssm, ec2, rid) == "failed"
    assert ssm.sent == []
    assert remediation.request(store, rid)["status"] == "FAILED"
    assert inc(store, investigating)["state"] == "ESCALATED"


def test_success_without_healthy_probes_escalates_after_the_window(
    store: core.Store, investigating: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Gate: a failed recovery with SSM 'Success' is never marked recovered."""
    ssm = FakeSSM()
    approved_and_sent(store, investigating, ssm)
    coordinator.handle(ssm_event("cmd-1", "Success"), store, ssm, FakeEC2(), ACCOUNT, REGION)
    res = store.get("res", {"resourceId": RESOURCE})
    assert remediation.verify(store, inc(store, investigating), res, alarm_ok=False) == "waiting"
    shift(monkeypatch, 11)
    assert remediation.verify(store, inc(store, investigating), res, alarm_ok=False) == "escalated"
    assert inc(store, investigating)["state"] == "ESCALATED"
    assert "INCIDENT_RESOLVED" not in timeline(store, investigating)


def test_lost_status_event_is_recovered_by_polling(
    store: core.Store, investigating: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    ssm = FakeSSM()
    approved_and_sent(store, investigating, ssm)
    ssm.status["cmd-1"] = "Success"
    shift(monkeypatch, 4)
    assert remediation.reconcile(store, ssm, FakeEC2())["finished"] == 1
    assert inc(store, investigating)["state"] == "VERIFYING"


def test_stuck_command_fails_after_ten_minutes(
    store: core.Store, investigating: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    ssm = FakeSSM()
    approved_and_sent(store, investigating, ssm)
    shift(monkeypatch, 11)
    remediation.reconcile(store, ssm, FakeEC2())
    assert inc(store, investigating)["state"] == "ESCALATED"


def test_approval_never_picked_up_is_dispatched_once_by_the_reconciler(
    store: core.Store, investigating: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    ssm = FakeSSM()
    rid = ask(store, investigating)["request"]["requestId"]
    decide(store, rid, investigating)
    shift(monkeypatch, 2)
    remediation.reconcile(store, ssm, FakeEC2())
    remediation.reconcile(store, ssm, FakeEC2())
    assert len(ssm.sent) == 1


# ----------------------------------------------------------- coordinator ---


@pytest.mark.parametrize(
    "event",
    [
        {"requestId": "REQ-1; DROP"},
        {"requestId": "arn:aws:ssm:x"},
        {"instanceId": "i-0other", "document": "AWS-RunShellScript"},
        ssm_event("cmd-1", "Success", account="999999999999"),
        ssm_event("cmd-1", "Success", region="us-east-1"),
        "not an object",
    ],
)
def test_coordinator_rejects_untrusted_triggers(store: core.Store, event: Any) -> None:
    assert coordinator.handle(event, store, FakeSSM(), FakeEC2(), ACCOUNT, REGION)["result"] == "rejected"


def test_status_for_an_unknown_command_or_document_is_ignored(store: core.Store, investigating: str) -> None:
    ssm = FakeSSM()
    approved_and_sent(store, investigating, ssm)
    other_doc = ssm_event("cmd-1", "Success")
    other_doc["detail"]["document-name"] = "Opsentra-Lab-StopNginx"
    for e in (ssm_event("cmd-999", "Success"), other_doc):
        assert coordinator.handle(e, store, ssm, FakeEC2(), ACCOUNT, REGION) == {"result": "ignored"}
    assert inc(store, investigating)["state"] == "REMEDIATING"


class FakeCloudWatch:
    def __init__(self, state: str) -> None:
        self.state = state

    def describe_alarms(self, AlarmNames: list[str]) -> dict[str, Any]:  # noqa: N803
        return {"MetricAlarms": [{"AlarmName": n, "StateValue": self.state} for n in AlarmNames]}


def test_reconciler_run_verifies_and_resolves(
    store: core.Store, investigating: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    ssm = FakeSSM()
    rid = approved_and_sent(store, investigating, ssm)
    coordinator.handle(ssm_event("cmd-1", "Success"), store, ssm, FakeEC2(), ACCOUNT, REGION)
    done = core.parse_iso(remediation.request(store, rid)["completedAt"])
    probe = core.iso(done + timedelta(minutes=1))
    set_probe(store, health="HEALTHY", streak=3, since=probe, checked=core.iso(done + timedelta(minutes=3)))
    later = core.iso(done + timedelta(minutes=4))
    monkeypatch.setattr(core, "now_iso", lambda: later)
    monkeypatch.setattr(remediation, "now_iso", lambda: later)

    from opsentra_incidents import reconciler

    assert reconciler.run(store, FakeCloudWatch("ALARM"), ACCOUNT, REGION, "", ssm, FakeEC2())["resolved"] == 0
    assert reconciler.run(store, FakeCloudWatch("OK"), ACCOUNT, REGION, "", ssm, FakeEC2())["resolved"] == 1
    assert inc(store, investigating)["state"] == "RESOLVED"


# ------------------------------------------- regressions from live run 1 ---


def test_streak_that_began_just_before_ssm_success_still_verifies(
    store: core.Store, investigating: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Live run 1: the probe streak began at 08:42:23, SSM completedAt was
    08:42:24. A genuine recovery must still resolve, but only once the probes
    after completion span 2 minutes (>= 3 probes after the fix)."""
    ssm = FakeSSM()
    rid = approved_and_sent(store, investigating, ssm)
    coordinator.handle(ssm_event("cmd-1", "Success"), store, ssm, FakeEC2(), ACCOUNT, REGION)
    done = core.parse_iso(remediation.request(store, rid)["completedAt"])
    since = core.iso(done - timedelta(seconds=1))
    res = lambda: store.get("res", {"resourceId": RESOURCE})  # noqa: E731

    set_probe(store, health="HEALTHY", streak=3, since=since, checked=core.iso(done + timedelta(minutes=1)))
    assert remediation.verify(store, inc(store, investigating), res(), alarm_ok=True) == "waiting"
    checked = core.iso(done + timedelta(minutes=2))
    set_probe(store, health="HEALTHY", streak=4, since=since, checked=checked)
    later = core.iso(done + timedelta(minutes=3))
    monkeypatch.setattr(core, "now_iso", lambda: later)
    monkeypatch.setattr(remediation, "now_iso", lambda: later)
    assert remediation.verify(store, inc(store, investigating), res(), alarm_ok=True) == "resolved"
    assert inc(store, investigating)["verifiedHealthyAt"] == checked


def test_escalation_update_expression_is_valid_dynamodb(store: core.Store, investigating: str) -> None:
    """moto accepted `SET ..., REMOVE x`; real DynamoDB rejects it."""
    update = remediation._incident_update(store, inc(store, investigating), "ESCALATED", remove=["activeRequestId"])
    expr = update["Update"]["UpdateExpression"]
    assert expr == "SET #s = :to, version = version + :one REMOVE activeRequestId"
    check_update_expression(expr)
    with pytest.raises(ValueError):
        remediation._incident_update(store, inc(store, investigating), "ESCALATED", remove=["a, b = :x"])


@pytest.mark.parametrize(
    "expr",
    [
        "SET #s = :to, version = version + :one, REMOVE activeRequestId",
        "SET a = :a SET b = :b",
        "REMOVE a = :a",
        "a = :a",
    ],
)
def test_the_strict_expression_check_rejects_invalid_syntax(expr: str) -> None:
    with pytest.raises(AssertionError):
        check_update_expression(expr)


@pytest.mark.parametrize("path", ["reject", "expire", "ssm_failed", "verify_failed"], ids=lambda p: f"escalates-on-{p}")
def test_every_escalation_path_clears_the_active_request(
    store: core.Store, investigating: str, monkeypatch: pytest.MonkeyPatch, path: str
) -> None:
    ssm = FakeSSM()
    if path == "reject":
        rid = ask(store, investigating)["request"]["requestId"]
        decide(store, rid, investigating, decision="REJECT")
    elif path == "expire":
        ask(store, investigating)
        shift(monkeypatch, 16)
        assert remediation.reconcile(store, ssm, FakeEC2())["expired"] == 1
    else:
        approved_and_sent(store, investigating, ssm)
        status = "Failed" if path == "ssm_failed" else "Success"
        coordinator.handle(ssm_event("cmd-1", status), store, ssm, FakeEC2(), ACCOUNT, REGION)
        if path == "verify_failed":
            shift(monkeypatch, 11)
            assert remediation.verify(store, inc(store, investigating), None, alarm_ok=False) == "escalated"
    final = inc(store, investigating)
    assert final["state"] == "ESCALATED" and "activeRequestId" not in final


def test_one_bad_request_does_not_stop_the_reconcile_run(
    store: core.Store, investigating: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    store.c.put_item(
        TableName="rem",
        Item=core.ser_item({"requestId": "REQ-BAD", "status": "PENDING", "expiresAt": "not-a-time", "incidentId": "x"}),
    )
    ask(store, investigating)
    shift(monkeypatch, 16)
    report = remediation.reconcile(store, FakeSSM(), FakeEC2())
    assert (report["expired"], report["errors"]) == (1, 1)
    assert inc(store, investigating)["state"] == "ESCALATED"


def test_one_bad_incident_does_not_stop_the_reconciler(
    store: core.Store, investigating: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    from opsentra_incidents import reconciler

    ssm = FakeSSM()
    approved_and_sent(store, investigating, ssm)
    coordinator.handle(ssm_event("cmd-1", "Success"), store, ssm, FakeEC2(), ACCOUNT, REGION)

    def boom(*_: Any, **__: Any) -> str:
        raise RuntimeError("ValidationException")

    monkeypatch.setattr(remediation, "verify", boom)
    monkeypatch.setattr(remediation, "reconcile", boom)
    report = reconciler.run(store, FakeCloudWatch("OK"), ACCOUNT, REGION, "", ssm, FakeEC2())
    assert report["errors"] == 2 and report["checked"] == 1
