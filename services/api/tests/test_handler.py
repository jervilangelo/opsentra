import json
from typing import Any

import pytest

from opsentra_api.authz import PERMITTED_ACTIONS, role_from_claims
from opsentra_api.handler import lambda_handler


class Ctx:
    aws_request_id = "lambda-req-1"


def event(method: str, path: str, claims: dict[str, Any] | None = None, body: str | None = None) -> dict[str, Any]:
    ctx: dict[str, Any] = {"requestId": "api-req-1", "http": {"method": method, "path": path}}
    if claims is not None:
        ctx["authorizer"] = {"jwt": {"claims": claims, "scopes": None}}
    e: dict[str, Any] = {"version": "2.0", "rawPath": path, "requestContext": ctx}
    if body is not None:
        e["body"] = body
    return e


def access(groups: str | None, **extra: Any) -> dict[str, Any]:
    c: dict[str, Any] = {"sub": "user-123", "username": "demo-user", "token_use": "access", **extra}
    if groups is not None:
        c["cognito:groups"] = groups
    return c


def call(e: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    r = lambda_handler(e, Ctx())
    return r["statusCode"], json.loads(r["body"])


def test_health_is_public_and_minimal() -> None:
    status, body = call(event("GET", "/v1/health"))
    assert status == 200
    assert body["data"]["status"] == "ok"
    assert set(body["data"]) == {"status", "service", "version", "time"}
    assert body["data"]["time"].endswith("Z")
    assert body["meta"]["requestId"] == "api-req-1"


@pytest.mark.parametrize(
    ("groups", "role"),
    [("[viewer]", "VIEWER"), ("[operator]", "OPERATOR"), ("[admin]", "ADMIN"), ("[viewer admin]", "ADMIN")],
)
def test_me_returns_role_from_trusted_groups(groups: str, role: str) -> None:
    status, body = call(event("GET", "/v1/me", access(groups)))
    assert status == 200
    assert body["data"]["role"] == role
    assert body["data"]["permittedActions"] == list(PERMITTED_ACTIONS[role])  # type: ignore[index]
    assert body["data"]["environment"] == "dev"


def test_me_without_token_is_401() -> None:
    status, body = call(event("GET", "/v1/me"))
    assert status == 401
    assert body["error"]["code"] == "UNAUTHENTICATED"
    assert body["error"]["requestId"] == "api-req-1"


def test_me_rejects_id_tokens() -> None:
    status, body = call(event("GET", "/v1/me", access("[admin]", token_use="id")))
    assert status == 401
    assert body["error"]["code"] == "INVALID_TOKEN"


def test_me_without_trusted_group_is_403() -> None:
    assert call(event("GET", "/v1/me", access(None)))[0] == 403
    assert call(event("GET", "/v1/me", access("[superuser root]")))[0] == 403


def test_role_in_body_or_claims_outside_groups_is_ignored() -> None:
    forged = json.dumps({"role": "ADMIN", "groups": ["admin"]})
    status, body = call(
        event("GET", "/v1/me", access("[viewer]", role="ADMIN", **{"custom:role": "ADMIN"}), body=forged)
    )
    assert status == 200
    assert body["data"]["role"] == "VIEWER"


def test_unknown_route_and_wrong_method_are_404() -> None:
    assert call(event("GET", "/v1/nope"))[0] == 404
    assert call(event("POST", "/v1/health"))[0] == 404


def test_errors_never_leak_internals(monkeypatch: pytest.MonkeyPatch) -> None:
    import opsentra_api.handler as h

    def boom(*_: Any) -> Any:
        raise RuntimeError("secret detail /var/task/x.py")

    monkeypatch.setitem(h.ROUTES, ("GET", "/v1/health"), boom)
    status, body = call(event("GET", "/v1/health"))
    assert status == 500
    assert body == {"error": {"code": "INTERNAL", "message": "Something went wrong.", "requestId": "api-req-1"}}


def test_responses_are_not_cached() -> None:
    r = lambda_handler(event("GET", "/v1/health"), Ctx())
    assert r["headers"]["cache-control"] == "no-store"


def test_group_claim_formats() -> None:
    assert role_from_claims({"cognito:groups": ["operator"]}) == "OPERATOR"
    assert role_from_claims({"cognito:groups": "[viewer, operator]"}) == "OPERATOR"
    assert role_from_claims({}) is None
