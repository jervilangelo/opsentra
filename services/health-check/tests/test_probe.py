import http.server
import threading
from collections.abc import Iterator
from typing import Any

import pytest

from opsentra_health import handler as h

CFG = h.Config(
    target_url="http://127.0.0.1:1/health",
    marker="opsentra-lab ok",
    instance_id="i-0lab",
    resources_table="opsentra-dev-resources",
    namespace="Opsentra/Lab",
    scenario="nginx",
    schedule_name="opsentra-lab-health-check",
    schedule_group="default",
    expires_at="2026-11-12T10:00:00Z",
)
NOW = "2026-11-12T06:00:00Z"


class Rec:
    """Records calls; returns canned responses."""

    def __init__(self, **responses: Any) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.responses = responses

    def __getattr__(self, name: str) -> Any:
        def call(**kwargs: Any) -> Any:
            self.calls.append((name, kwargs))
            r = self.responses.get(name, {})
            if isinstance(r, Exception):
                raise r
            return r

        return call


def instance(state: str = "running", lab: str | None = "true") -> dict[str, Any]:
    tags = [{"Key": "opsentra:lab", "Value": lab}] if lab is not None else []
    return {"Reservations": [{"Instances": [{"State": {"Name": state}, "Tags": tags}]}]}


SCHEDULE = {
    "State": "ENABLED",
    "ScheduleExpression": "rate(1 minute)",
    "FlexibleTimeWindow": {"Mode": "OFF"},
    "Target": {"Arn": "arn:aws:lambda:x", "RoleArn": "arn:aws:iam::x"},
}


class Clients:
    def __init__(self, ec2: Any) -> None:
        self.ec2 = ec2
        self.cloudwatch = Rec()
        self.dynamodb = Rec()
        self.scheduler = Rec(get_schedule=dict(SCHEDULE))


def names(rec: Rec) -> list[str]:
    return [n for n, _ in rec.calls]


@pytest.fixture
def fake_probe(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[tuple[bool, str]]]:
    result: list[tuple[bool, str]] = [(True, "HTTP 200")]
    monkeypatch.setattr(h, "_probe", lambda *_: result[0])
    yield result


def test_healthy_run_emits_1_and_updates_registry(fake_probe: list[tuple[bool, str]]) -> None:
    c = Clients(Rec(describe_instances=instance()))
    out = h.run(CFG, c, NOW)  # type: ignore[arg-type]
    assert out == {"result": "healthy", "reason": "HTTP 200"}
    metric = c.cloudwatch.calls[0][1]["MetricData"][0]
    assert metric["Value"] == 1.0 and metric["Dimensions"] == [{"Name": "Scenario", "Value": "nginx"}]
    update = c.dynamodb.calls[0][1]
    assert update["ExpressionAttributeValues"][":h"] == {"S": "HEALTHY"}
    assert update["ConditionExpression"] == "attribute_exists(resourceId)"
    assert names(c.scheduler) == []


def test_unhealthy_run_emits_0(fake_probe: list[tuple[bool, str]]) -> None:
    fake_probe[0] = (False, "unreachable: ConnectionRefusedError")
    c = Clients(Rec(describe_instances=instance()))
    out = h.run(CFG, c, NOW)  # type: ignore[arg-type]
    assert out["result"] == "unhealthy"
    assert c.cloudwatch.calls[0][1]["MetricData"][0]["Value"] == 0.0
    assert c.dynamodb.calls[0][1]["ExpressionAttributeValues"][":h"] == {"S": "UNHEALTHY"}


@pytest.mark.parametrize("state", ["stopped", "terminated", "shutting-down"])
def test_gone_instance_disables_schedule_and_emits_nothing(state: str) -> None:
    c = Clients(Rec(describe_instances=instance(state)))
    out = h.run(CFG, c, NOW)  # type: ignore[arg-type]
    assert out["scheduleDisabled"] is True
    assert c.cloudwatch.calls == []  # missing data, never a fake value
    assert c.dynamodb.calls[0][1]["ExpressionAttributeValues"][":h"] == {"S": "UNKNOWN"}
    upd = [k for n, k in c.scheduler.calls if n == "update_schedule"][0]
    assert upd["State"] == "DISABLED" and upd["ScheduleExpression"] == "rate(1 minute)"


def test_missing_instance_disables_schedule() -> None:
    class NotFound(Exception):
        pass

    NotFound.__name__ = "InvalidInstanceIDNotFound"
    c = Clients(Rec(describe_instances=NotFound("InvalidInstanceID.NotFound")))
    out = h.run(CFG, c, NOW)  # type: ignore[arg-type]
    assert out["state"] == "missing" and out["scheduleDisabled"] is True


def test_pending_instance_is_not_probed_but_schedule_stays() -> None:
    c = Clients(Rec(describe_instances=instance("pending")))
    out = h.run(CFG, c, NOW)  # type: ignore[arg-type]
    assert out["scheduleDisabled"] is False
    assert names(c.scheduler) == []


def test_untagged_instance_is_never_probed(fake_probe: list[tuple[bool, str]]) -> None:
    c = Clients(Rec(describe_instances=instance(lab=None)))
    out = h.run(CFG, c, NOW)  # type: ignore[arg-type]
    assert out["result"] == "not-probed" and out["tagged"] is False
    assert c.cloudwatch.calls == []


def test_expired_lab_disables_schedule() -> None:
    c = Clients(Rec(describe_instances=instance()))
    out = h.run(CFG, c, "2026-11-12T10:00:01Z")  # type: ignore[arg-type]
    assert out == {"result": "expired", "scheduleDisabled": True}
    assert names(c.ec2) == []


# --- the real probe against a local server ---------------------------------


class Server(http.server.BaseHTTPRequestHandler):
    routes: dict[str, tuple[int, bytes, dict[str, str]]] = {
        "/health": (200, b"opsentra-lab ok\n", {}),
        "/wrong": (200, b"welcome to nginx", {}),
        "/down": (503, b"", {}),
        "/redirect": (302, b"", {"Location": "http://169.254.169.254/latest/meta-data/"}),
    }

    def do_GET(self) -> None:  # noqa: N802
        status, body, headers = self.routes.get(self.path, (404, b"", {}))
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: Any) -> None:
        pass


@pytest.fixture(scope="module")
def base_url() -> Iterator[str]:
    srv = http.server.HTTPServer(("127.0.0.1", 0), Server)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


@pytest.mark.parametrize(
    ("path", "healthy"),
    [("/health", True), ("/wrong", False), ("/down", False), ("/redirect", False)],
)
def test_probe_outcomes(base_url: str, path: str, healthy: bool) -> None:
    assert h.probe(base_url + path, "opsentra-lab ok", 2)[0] is healthy


def test_probe_never_follows_redirects(base_url: str) -> None:
    ok, reason = h.probe(base_url + "/redirect", "opsentra-lab ok", 2)
    assert not ok and reason == "HTTP 302"


def test_probe_handles_unreachable_and_bad_scheme() -> None:
    assert h.probe("http://127.0.0.1:1/health", "x", 0.5)[0] is False
    assert h.probe("file:///etc/passwd", "x", 0.5) == (False, "invalid target")
