"""Phase 7 gate: attacks against the live lab routes (owner-approved).
Usage: lab_attacks.py
Run while a lab run is active or in cooldown, so that no attack can start a
new run even if it slipped past the role checks. Tokens come from test users
in env vars; nothing secret is printed. Expected codes are shown next to the
actual ones; the script exits 1 if any differ.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid

import boto3

R = "ap-southeast-1"
API = os.environ["OPSENTRA_API_URL"].rstrip("/")
cog = boto3.client("cognito-idp", region_name=R)
failures = 0


def token(role: str) -> str:
    res = cog.admin_initiate_auth(
        UserPoolId=os.environ["OPSENTRA_USER_POOL_ID"],
        ClientId=os.environ["OPSENTRA_TEST_CLIENT_ID"],
        AuthFlow="ADMIN_USER_PASSWORD_AUTH",
        AuthParameters={
            "USERNAME": os.environ[f"OPSENTRA_TEST_{role}_USER"],
            "PASSWORD": os.environ[f"OPSENTRA_TEST_{role}_PASSWORD"],
        },
    )
    return res["AuthenticationResult"]["AccessToken"]


def call(method: str, path: str, tok: str | None, body: dict | None = None, key: bool = True) -> tuple[int, dict]:
    headers = {"content-type": "application/json"}
    if key:
        headers["idempotency-key"] = f"gate7-{uuid.uuid4()}"
    if tok:
        headers["authorization"] = f"Bearer {tok}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, method=method, headers=headers, data=data)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def check(name: str, expected: int, res: tuple[int, dict]) -> None:
    global failures
    status, body = res
    code = body.get("error", {}).get("code", "")
    mark = "ok " if status == expected else "BAD"
    failures += status != expected
    print(f"{mark} {name:58s} -> {status} {re.sub(r'[0-9]{12}', '<account>', code)} (expected {expected})")


viewer, operator, admin = token("VIEWER"), token("OPERATOR"), token("ADMIN")
start = "/v1/labs/nginx-outage/start"
reset = "/v1/labs/nginx-outage/reset"
ack = {"acknowledgeImpact": True}

check("no token: list labs", 401, call("GET", "/v1/labs", None))
check("viewer: list labs", 403, call("GET", "/v1/labs", viewer))
check("operator: list labs", 403, call("GET", "/v1/labs", operator))
check("no token: start", 401, call("POST", start, None, ack))
check("viewer: start", 403, call("POST", start, viewer, ack))
check("operator: start", 403, call("POST", start, operator, ack))
check("operator: start with role ADMIN in body", 403, call("POST", start, operator, {**ack, "role": "ADMIN"}))
check("operator: reset", 403, call("POST", reset, operator, {}))
check("admin: start without confirmation", 400, call("POST", start, admin, {}))
check("admin: start without Idempotency-Key", 400, call("POST", start, admin, ack, key=False))
for sid in ["i-0123456789abcdef0", "AWS-RunShellScript", "nginx-outage;reboot", "lambda-regression"]:
    check(f"admin: unknown scenario {sid!r}", 404, call("POST", f"/v1/labs/{sid}/start", admin, ack))
forged = {**ack, "instanceId": "i-0123456789abcdef0", "document": "AWS-RunShellScript", "commands": ["reboot"]}
check("admin: start with a forged target while busy/cooling", 409, call("POST", start, admin, forged))

ssm = boto3.client("ssm", region_name=R)
cmds = ssm.list_commands(Filters=[{"key": "DocumentName", "value": "Opsentra-Lab-StopNginx"}])["Commands"]
print("StopNginx commands so far:", len(cmds), sorted({t for c in cmds for t in c.get("InstanceIds", [])}))
sys.exit(1 if failures else 0)
