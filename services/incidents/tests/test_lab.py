"""Phase 7: Live Simulation Lab (ADR-018). Gate: scenarios start, are inspected
and recovered/reset without a terminal; expired or abandoned runs are cleaned
up; nothing outside the registered lab is ever targeted."""

from datetime import timedelta
from typing import Any

import pytest

from conftest import DOC_HASH, RESOURCE, STOP_HASH, alarm_event, incidents, ingest_event
from opsentra_incidents import core, lab, reconciler

ADMIN = {"role": "ADMIN", "actor": "opsentra-admin"}


class NotFound(Exception):
    response = {"Error": {"Code": "InvalidInstanceID.NotFound"}}


class FakeSSM:
    def __init__(self, online: bool = True, refuse: bool = False) -> None:
        self.sent: list[dict[str, Any]] = []
        self.online, self.refuse = online, refuse
        self.status: dict[str, str] = {}

    def send_command(self, **kw: Any) -> dict[str, Any]:
        if self.refuse:
            raise RuntimeError("AccessDenied")
        self.sent.append(kw)
        return {"Command": {"CommandId": f"cmd-{len(self.sent)}"}}

    def describe_instance_information(self, Filters: list[dict[str, Any]]) -> dict[str, Any]:  # noqa: N803
        iid = Filters[0]["Values"][0]
        return {
            "InstanceInformationList": [
                {"InstanceId": iid, "PingStatus": "Online" if self.online else "ConnectionLost"}
            ]
        }

    def get_command_invocation(self, CommandId: str, InstanceId: str) -> dict[str, str]:  # noqa: N803
        return {"Status": self.status.get(CommandId, "InProgress")}

    def docs(self) -> list[str]:
        return [c["DocumentName"] for c in self.sent]


class FakeEC2:
    def __init__(self, lab_tag: bool = True, state: str = "running", gone: bool = False) -> None:
        self.lab_tag, self.state, self.gone = lab_tag, state, gone

    def describe_instances(self, InstanceIds: list[str]) -> dict[str, Any]:  # noqa: N803
        if self.gone:
            raise NotFound()
        tags = [{"Key": "opsentra:lab", "Value": "true" if self.lab_tag else "false"}]
        return {
            "Reservations": [
                {"Instances": [{"InstanceId": InstanceIds[0], "Tags": tags, "State": {"Name": self.state}}]}
            ]
        }


class FakeCloudWatch:
    def __init__(self, state: str) -> None:
        self.state = state

    def describe_alarms(self, AlarmNames: list[str]) -> dict[str, Any]:  # noqa: N803
        return {"MetricAlarms": [{"AlarmName": n, "StateValue": self.state} for n in AlarmNames]}


class Clock:
    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.t = core.parse_iso(core.now_iso())
        self.mp = monkeypatch
        self.set(0)

    def set(self, minutes: float) -> str:
        at = core.iso(self.t + timedelta(minutes=minutes))
        for mod in (lab, core):
            self.mp.setattr(mod, "now_iso", lambda at=at: at)
        from opsentra_incidents import remediation

        self.mp.setattr(remediation, "now_iso", lambda at=at: at)
        return at


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    return Clock(monkeypatch)


def probe(store: core.Store, *, health: str = "HEALTHY", at: str | None = None) -> None:
    store.c.update_item(
        TableName="res",
        Key={"resourceId": {"S": RESOURCE}},
        UpdateExpression="SET health = :h, lastCheckedAt = :c",
        ExpressionAttributeValues={":h": {"S": health}, ":c": {"S": at or core.now_iso()}},
    )


@pytest.fixture
def ready(store: core.Store, clock: Clock) -> core.Store:
    probe(store, at=clock.set(0))
    return store


def start(store: core.Store, ssm: FakeSSM, ec2: FakeEC2 | None = None, key: str = "k1", **over: Any) -> dict:
    args: dict[str, Any] = {"scenario_id": "nginx-outage", "acknowledge": True, "idempotency_key": key, **ADMIN}
    args.update(over)
    return lab.start(store, ssm, ec2 or FakeEC2(), **args)


def reset(store: core.Store, ssm: FakeSSM, key: str = "r1", ec2: FakeEC2 | None = None, **over: Any) -> dict:
    args: dict[str, Any] = {"scenario_id": "nginx-outage", "idempotency_key": key, **ADMIN}
    args.update(over)
    return lab.reset(store, ssm, ec2 or FakeEC2(), **args)


def lab_events(store: core.Store) -> list[str]:
    items = store.c.query(
        TableName="aud",
        KeyConditionExpression="PK = :p",
        ExpressionAttributeValues={":p": {"S": "LAB#nginx-outage"}},
    )["Items"]
    return [core.de_item(i)["eventType"] for i in sorted(items, key=lambda i: i["SK"]["S"])]


def the_run(store: core.Store) -> dict[str, Any]:
    [run] = lab.runs(store)
    return run


def raises(code: str, fn: Any, *a: Any, **kw: Any) -> core.IncidentError:
    with pytest.raises(core.IncidentError) as exc:
        fn(*a, **kw)
    assert exc.value.code == code, exc.value.message
    return exc.value


# --------------------------------------------------------------- listing ---


def test_scenario_is_ready_only_when_every_preflight_check_passes(ready: core.Store) -> None:
    [sc] = lab.list_scenarios(ready, FakeSSM(), FakeEC2())
    assert sc["id"] == "nginx-outage" and sc["available"] is True
    assert sc["resourceId"] == RESOURCE and sc["runbookId"] == "rb-restart-nginx"
    assert [c["id"] for c in sc["preflight"]] == [
        "registered",
        "lock",
        "cooldown",
        "lab-time",
        "instance",
        "ssm-agent",
        "recovery",
        "no-incident",
        "baseline",
    ]
    assert all(c["ok"] for c in sc["preflight"])


def test_lab_not_deployed_is_reported_not_faked(store: core.Store) -> None:
    store.c.delete_item(TableName="res", Key={"resourceId": {"S": RESOURCE}})
    [sc] = lab.list_scenarios(store, FakeSSM(), FakeEC2())
    assert sc["available"] is False and sc["resourceId"] == ""
    assert sc["unavailableReason"] == "The live lab is not deployed."


@pytest.mark.parametrize(
    ("setup", "check"),
    [
        (lambda s, c: None, None),
        (lambda s, c: probe(s, health="UNHEALTHY", at=c.set(0)), "baseline"),
        (lambda s, c: probe(s, at=c.set(-10)) or c.set(0), "baseline"),  # stale probe
        (
            lambda s, c: (
                s.c.update_item(
                    TableName="res",
                    Key={"resourceId": {"S": RESOURCE}},
                    UpdateExpression="SET labExpiresAt = :e",
                    ExpressionAttributeValues={":e": {"S": c.set(20)}},
                )
                or c.set(0)
            ),
            "lab-time",
        ),
    ],
)
def test_preflight_failures_block_the_start(ready: core.Store, clock: Clock, setup: Any, check: str | None) -> None:
    setup(ready, clock)
    ssm = FakeSSM()
    if check is None:
        start(ready, ssm)
        assert ssm.docs() == ["Opsentra-Lab-StopNginx"]
        return
    raises("PREFLIGHT_FAILED", start, ready, ssm)
    assert ssm.sent == [] and lab.runs(ready) == []
    [sc] = lab.list_scenarios(ready, FakeSSM(), FakeEC2())
    assert [c["id"] for c in sc["preflight"] if not c["ok"]][0] == check


@pytest.mark.parametrize(
    ("ssm", "ec2"),
    [
        (FakeSSM(), FakeEC2(lab_tag=False)),
        (FakeSSM(), FakeEC2(state="stopped")),
        (FakeSSM(), FakeEC2(gone=True)),
        (FakeSSM(online=False), FakeEC2()),
    ],
)
def test_untagged_stopped_missing_or_offline_targets_are_never_touched(
    ready: core.Store, ssm: FakeSSM, ec2: FakeEC2
) -> None:
    raises("PREFLIGHT_FAILED", start, ready, ssm, ec2)
    assert ssm.sent == []


def test_an_open_incident_blocks_a_new_run(ready: core.Store, clock: Clock, emails: list) -> None:
    ingest_event(ready, alarm_event(ts=clock.set(0)))
    err = raises("PREFLIGHT_FAILED", start, ready, FakeSSM())
    assert "is OPEN" in err.message


def test_a_tampered_injection_document_is_not_allowlisted(ready: core.Store) -> None:
    ready.c.update_item(
        TableName="res",
        Key={"resourceId": {"S": RESOURCE}},
        UpdateExpression="SET scenarios = :s",
        ExpressionAttributeValues={
            ":s": core.ser({"nginx-outage": {"document": "AWS-RunShellScript", "documentHash": STOP_HASH}})
        },
    )
    raises("PREFLIGHT_FAILED", start, ready, FakeSSM())


# ---------------------------------------------------------------- start ---


def test_start_injects_exactly_the_pinned_document_on_the_registered_instance(ready: core.Store) -> None:
    ssm = FakeSSM()
    sc = start(ready, ssm)
    [cmd] = ssm.sent
    assert cmd["InstanceIds"] == [RESOURCE]
    assert (cmd["DocumentName"], cmd["DocumentHash"], cmd["DocumentHashType"]) == (
        "Opsentra-Lab-StopNginx",
        STOP_HASH,
        "Sha256",
    )
    run = the_run(ready)
    assert (run["status"], run["injection"], run["commandId"]) == ("ACTIVE", "SENT", "cmd-1")
    assert sc["activeRun"]["runId"] == run["runId"] and sc["available"] is False
    assert lab_events(ready) == ["LAB_SCENARIO_STARTED", "LAB_INJECTION_SENT"]


@pytest.mark.parametrize(
    ("over", "code"),
    [
        ({"role": "OPERATOR"}, "FORBIDDEN"),
        ({"role": "VIEWER"}, "FORBIDDEN"),
        ({"idempotency_key": None}, "IDEMPOTENCY_KEY_REQUIRED"),
        ({"acknowledge": None}, "CONFIRMATION_REQUIRED"),
        ({"acknowledge": "true"}, "CONFIRMATION_REQUIRED"),
        ({"scenario_id": "i-0abc; rm -rf /"}, "NOT_FOUND"),
        ({"scenario_id": "Opsentra-Lab-StopNginx"}, "NOT_FOUND"),
    ],
)
def test_start_refuses_without_writes(ready: core.Store, over: dict, code: str) -> None:
    ssm = FakeSSM()
    raises(code, start, ready, ssm, **over)
    assert ssm.sent == [] and lab.runs(ready) == []


def test_one_active_run_and_replay_never_injects_twice(ready: core.Store) -> None:
    ssm = FakeSSM()
    first = start(ready, ssm)
    assert start(ready, ssm) == first  # same key: the stored response, no new command
    raises("LAB_BUSY", start, ready, ssm, key="k2")
    assert len(ssm.sent) == 1


def test_ssm_refusal_fails_the_run_and_frees_the_lock(ready: core.Store) -> None:
    raises("LAB_INJECTION_FAILED", start, ready, FakeSSM(refuse=True))
    assert the_run(ready)["status"] == "FAILED"
    ssm = FakeSSM()
    start(ready, ssm, key="k2")  # no cooldown: nothing ran
    assert len(ssm.sent) == 1


# ------------------------------------------------------------- watchdog ---


def test_watchdog_confirms_injection_links_incident_and_completes_on_resolution(
    ready: core.Store, clock: Clock, emails: list
) -> None:
    ssm, ec2 = FakeSSM(), FakeEC2()
    start(ready, ssm)
    ssm.status["cmd-1"] = "Success"
    clock.set(1)
    lab.watchdog(ready, ssm, ec2)
    assert the_run(ready)["injection"] == "SUCCEEDED"

    ingest_event(ready, alarm_event(ts=clock.set(4)))
    [incident] = incidents(ready)
    assert lab.watchdog(ready, ssm, ec2)["labLinked"] == 1
    assert the_run(ready)["incidentId"] == incident["incidentId"]

    # Verified recovery (here: self-heal path, alarm OK + healthy probe 2 min later).
    ingest_event(ready, alarm_event(state="OK", ts=clock.set(6), event_id="evt-2"))
    probe(ready, at=clock.set(9))
    report = reconciler.run(ready, FakeCloudWatch("OK"), "111122223333", "ap-southeast-1", "", ssm, ec2)
    assert report["resolved"] == 1 and report["labEnded"] == 1
    run = the_run(ready)
    assert run["status"] == "COMPLETED"
    assert lab_events(ready)[-1] == "LAB_SCENARIO_COMPLETED"

    timeline = ready.c.query(
        TableName="aud",
        KeyConditionExpression="PK = :p",
        ExpressionAttributeValues={":p": {"S": f"INCIDENT#{incident['incidentId']}"}},
    )["Items"]
    kinds = {core.de_item(i)["eventType"] for i in timeline}
    assert {"LAB_SCENARIO_LINKED", "LAB_SCENARIO_ENDED"} <= kinds

    # Cooldown, then the next run may start.
    probe(ready, at=clock.set(10))
    raises("LAB_BUSY", start, ready, ssm, key="k2")
    probe(ready, at=clock.set(15))
    start(ready, ssm, key="k3")


def test_failed_injection_ends_the_run(ready: core.Store, clock: Clock) -> None:
    ssm = FakeSSM()
    start(ready, ssm)
    ssm.status["cmd-1"] = "Failed"
    clock.set(1)
    lab.watchdog(ready, ssm, FakeEC2())
    run = the_run(ready)
    assert (run["status"], run["injection"]) == ("FAILED", "FAILED")


def test_expired_run_is_reset_with_the_allowlisted_restart(ready: core.Store, clock: Clock) -> None:
    ssm = FakeSSM()
    start(ready, ssm)
    ssm.status["cmd-1"] = "Success"
    clock.set(46)
    assert lab.watchdog(ready, ssm, FakeEC2())["labEnded"] == 1
    assert ssm.docs() == ["Opsentra-Lab-StopNginx", "Opsentra-Lab-RestartNginx"]
    restart = ssm.sent[1]
    assert restart["InstanceIds"] == [RESOURCE] and restart["DocumentHash"] == DOC_HASH
    run = the_run(ready)
    assert run["status"] == "EXPIRED" and "restart sent" in run["endReason"]


def test_run_whose_lab_was_destroyed_is_ended_without_commands(ready: core.Store, clock: Clock) -> None:
    ssm = FakeSSM()
    start(ready, ssm)
    clock.set(5)
    lab.watchdog(ready, ssm, FakeEC2(gone=True))
    assert the_run(ready)["status"] == "EXPIRED" and len(ssm.sent) == 1
    assert lab._lock(ready).get("activeRunId") is None


def test_a_stale_lock_is_released(ready: core.Store) -> None:
    ready.c.put_item(TableName="lab", Item=core.ser_item({"runId": "LOCK", "activeRunId": "LAB-GONE"}))
    assert lab.watchdog(ready, FakeSSM(), FakeEC2())["labEnded"] == 1
    start(ready, FakeSSM())


def test_one_broken_run_does_not_stop_the_watchdog(ready: core.Store) -> None:
    ready.c.put_item(TableName="lab", Item=core.ser_item({"runId": "LAB-BAD", "status": "ACTIVE", "scenarioId": "x"}))
    assert lab.watchdog(ready, FakeSSM(), FakeEC2())["labErrors"] == 1


# ---------------------------------------------------------------- reset ---


def test_reset_restarts_nginx_ends_the_run_and_never_resolves_the_incident(
    ready: core.Store, clock: Clock, emails: list
) -> None:
    ssm = FakeSSM()
    start(ready, ssm)
    ingest_event(ready, alarm_event(ts=clock.set(4)))
    lab.watchdog(ready, ssm, FakeEC2())
    out = reset(ready, ssm)
    assert ssm.docs() == ["Opsentra-Lab-StopNginx", "Opsentra-Lab-RestartNginx"]
    assert ssm.sent[1]["DocumentHash"] == DOC_HASH
    assert out["lastRun"]["status"] == "RESET" and out["lastRun"]["endedBy"] == "opsentra-admin"
    assert incidents(ready)[0]["state"] == "OPEN"  # only verified health resolves it
    assert reset(ready, ssm) == out and len(ssm.sent) == 2  # replay


def test_reset_without_a_run_is_a_cleanup_restart(ready: core.Store) -> None:
    ssm = FakeSSM()
    reset(ready, ssm)
    assert ssm.docs() == ["Opsentra-Lab-RestartNginx"]
    assert lab_events(ready) == ["LAB_RESET"]


@pytest.mark.parametrize(
    ("over", "code"),
    [
        ({"role": "OPERATOR"}, "FORBIDDEN"),
        ({"scenario_id": "../etc"}, "NOT_FOUND"),
        ({"idempotency_key": ""}, "IDEMPOTENCY_KEY_REQUIRED"),
    ],
)
def test_reset_refuses_without_commands(ready: core.Store, over: dict, code: str) -> None:
    ssm = FakeSSM()
    raises(code, reset, ready, ssm, **over)
    assert ssm.sent == []


def test_reset_refuses_a_non_lab_instance(ready: core.Store) -> None:
    ssm = FakeSSM()
    raises("PREFLIGHT_FAILED", reset, ready, ssm, ec2=FakeEC2(lab_tag=False))
    assert ssm.sent == []


def test_denied_attempts_are_audited(ready: core.Store) -> None:
    lab.record_denied(ready, lab.CATALOG["nginx-outage"], "LAB_START", "opsentra-operator", "OPERATOR", "FORBIDDEN")
    assert lab_events(ready) == ["LAB_START_DENIED"]


def test_two_starts_that_both_pass_preflight_still_get_one_run(
    ready: core.Store, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The conditional lock, not the preflight read, is what serializes starts."""
    ssm = FakeSSM()
    real = lab.preflight
    stale = real(ready, ssm, FakeEC2(), lab.CATALOG["nginx-outage"], core.parse_iso(lab.now_iso()))
    start(ready, ssm)
    monkeypatch.setattr(lab, "preflight", lambda *a, **k: stale)  # a racer read before the first commit
    raises("LAB_BUSY", start, ready, ssm, key="k2")
    assert len(ssm.sent) == 1 and len(lab.runs(ready)) == 1
