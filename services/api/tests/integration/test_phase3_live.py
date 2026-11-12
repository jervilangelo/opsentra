"""Phase 3 live checks against the deployed dev API.

Skipped unless the owner sets these environment variables (never commit them):

  OPSENTRA_API_URL            e.g. https://<id>.execute-api.ap-southeast-1.amazonaws.com
  OPSENTRA_USER_POOL_ID       the dev user pool ID
  OPSENTRA_TEST_CLIENT_ID     the integration-test app client ID (no secret)
  OPSENTRA_TEST_VIEWER_USER / _PASSWORD
  OPSENTRA_TEST_OPERATOR_USER / _PASSWORD
  OPSENTRA_TEST_ADMIN_USER / _PASSWORD

Tokens are obtained with AdminInitiateAuth using the caller's AWS credentials,
which never reach the browser. Nothing here writes to AWS.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

import pytest

API = os.environ.get("OPSENTRA_API_URL", "").rstrip("/")
POOL = os.environ.get("OPSENTRA_USER_POOL_ID", "")
CLIENT = os.environ.get("OPSENTRA_TEST_CLIENT_ID", "")

pytestmark = pytest.mark.skipif(not (API and POOL and CLIENT), reason="live Phase 3 environment variables are not set")


def get(path: str, token: str | None = None) -> tuple[int, dict[str, Any]]:
    if not API.startswith("https://"):
        raise ValueError("OPSENTRA_API_URL must be an https URL")
    req = urllib.request.Request(f"{API}{path}", method="GET")  # noqa: S310 — https checked above
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as err:
        body = err.read()
        return err.code, json.loads(body) if body else {}


def access_token(role: str) -> str:
    import boto3

    user = os.environ.get(f"OPSENTRA_TEST_{role}_USER")
    password = os.environ.get(f"OPSENTRA_TEST_{role}_PASSWORD")
    if not user or not password:
        pytest.skip(f"credentials for the {role.lower()} test user are not set")
    client = boto3.client("cognito-idp", region_name="ap-southeast-1")
    result = client.admin_initiate_auth(
        UserPoolId=POOL,
        ClientId=CLIENT,
        AuthFlow="ADMIN_USER_PASSWORD_AUTH",
        AuthParameters={"USERNAME": user, "PASSWORD": password},
    )
    return result["AuthenticationResult"]["AccessToken"]


def test_health_is_public() -> None:
    status, body = get("/v1/health")
    assert status == 200
    assert body["data"]["status"] == "ok"


def test_me_requires_a_token() -> None:
    status, _ = get("/v1/me")
    assert status == 401


def test_me_rejects_a_garbage_token() -> None:
    status, _ = get("/v1/me", token="not-a-jwt")
    assert status == 401


@pytest.mark.parametrize("role", ["VIEWER", "OPERATOR", "ADMIN"])
def test_me_maps_each_role(role: str) -> None:
    status, body = get("/v1/me", token=access_token(role))
    assert status == 200
    assert body["data"]["role"] == role
    assert body["meta"]["dataset"] == "live"
