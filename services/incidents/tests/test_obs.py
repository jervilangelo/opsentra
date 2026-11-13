"""Phase 8 structured logs (ADR-019): one JSON shape with the IDs needed to
follow an incident across Lambdas; nothing sensitive."""

import json
import logging
from types import SimpleNamespace

import pytest

from conftest import ACCOUNT, REGION
from opsentra_incidents import coordinator, core, obs
from test_remediation import FakeEC2, FakeSSM, approved_and_sent, investigating, ssm_event  # noqa: F401 (fixture)


def test_line_shape_drops_empty_fields_and_carries_the_lambda_request_id() -> None:
    obs.bind(SimpleNamespace(aws_request_id="abc-123"))
    body = json.loads(obs.line("opsentra-x", "verified", incidentId="INC-1", requestId=None))
    assert body == {"msg": "verified", "service": "opsentra-x", "awsRequestId": "abc-123", "incidentId": "INC-1"}
    obs.bind(None)
    assert "awsRequestId" not in json.loads(obs.line("s", "m"))


def test_runbook_lines_name_incident_and_request(
    store: core.Store,
    investigating: str,  # noqa: F811 (pytest fixture imported above)
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    ssm = FakeSSM()
    rid = approved_and_sent(store, investigating, ssm)
    coordinator.handle(ssm_event("cmd-1", "Success"), store, ssm, FakeEC2(), ACCOUNT, REGION)
    lines = [json.loads(r.getMessage()) for r in caplog.records if r.getMessage().startswith("{")]
    sent = next(x for x in lines if x["msg"] == "runbook sent")
    done = next(x for x in lines if x["msg"] == "runbook finished")
    assert (sent["incidentId"], sent["requestId"], sent["commandId"]) == (investigating, rid, "cmd-1")
    assert (done["incidentId"], done["outcome"], done["incidentState"]) == (investigating, "SUCCEEDED", "VERIFYING")
    assert "Nginx is down" not in json.dumps(lines)  # reasons typed by users are never logged
