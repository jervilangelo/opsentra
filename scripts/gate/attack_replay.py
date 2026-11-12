"""Phase 6 gate: attacks and replays against the live API (owner-approved).
Usage: attack_replay.py <incidentId> <requestId> <phase>
  attacks  - while awaiting approval: denied decisions, forged runbooks, body injection
  replay   - after approval: re-send the decision with a new key, re-invoke the coordinator
Tokens come from test users in env vars; nothing secret is printed.
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
incident_id, request_id, phase = sys.argv[1:4]
cog = boto3.client("cognito-idp", region_name=R)


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


def call(method: str, path: str, tok: str | None, body: dict | None = None) -> tuple[int, dict]:
    headers = {"content-type": "application/json", "idempotency-key": f"gate6-{uuid.uuid4()}"}
    if tok:
        headers["authorization"] = f"Bearer {tok}"
    req = urllib.request.Request(API + path, method=method, headers=headers, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def show(name: str, res: tuple[int, dict]) -> None:
    status, body = res
    detail = body.get("error", {}).get("code") or body.get("data", {}).get("status") or body.get("message", "")
    print(f"{name:62s} -> {status} {re.sub(r'[0-9]{12}', '<account>', str(detail))}")


viewer, operator, admin = token("VIEWER"), token("OPERATOR"), token("ADMIN")
inc = call("GET", f"/v1/incidents/{incident_id}", viewer)[1]["data"]
v = inc["version"]
print("incident", incident_id, inc["state"], "version", v)
decision = {"expectedVersion": v, "decision": "APPROVE", "reason": "attack"}

if phase == "attacks":
    show("no token: decision", call("POST", f"/v1/remediations/{request_id}/decision", None, decision))
    show("viewer: decision", call("POST", f"/v1/remediations/{request_id}/decision", viewer, decision))
    show("operator: decision", call("POST", f"/v1/remediations/{request_id}/decision", operator, decision))
    show("operator: decision with role ADMIN in body", call("POST", f"/v1/remediations/{request_id}/decision", operator, {**decision, "role": "ADMIN"}))
    show("viewer: request-remediation", call("POST", f"/v1/incidents/{incident_id}/request-remediation", viewer, {"expectedVersion": v, "runbookId": "rb-restart-nginx", "reason": "x"}))
    for rb in ["AWS-RunShellScript", "rb-restart-nginx; reboot", "Opsentra-Lab-StopNginx", "../../x"]:
        show(f"operator: forged runbookId {rb!r}", call("POST", f"/v1/incidents/{incident_id}/request-remediation", operator, {"expectedVersion": v, "runbookId": rb, "reason": "x"}))
    show("operator: second request while one is pending", call("POST", f"/v1/incidents/{incident_id}/request-remediation", operator, {"expectedVersion": v, "runbookId": "rb-restart-nginx", "reason": "x", "resourceId": "i-0prod", "document": "AWS-RunShellScript"}))
    show("admin: unknown request ID", call("POST", "/v1/remediations/REQ-20261112-FFFFFF/decision", admin, decision))
    show("admin: stale expectedVersion", call("POST", f"/v1/remediations/{request_id}/decision", admin, {**decision, "expectedVersion": v - 1}))

if phase == "replay":
    show("admin: decide again with a new key", call("POST", f"/v1/remediations/{request_id}/decision", admin, decision))
    lam = boto3.client("lambda", region_name=R)
    for n in (1, 2):
        r = lam.invoke(FunctionName="opsentra-dev-remediation-coordinator", Payload=json.dumps({"requestId": request_id}).encode())
        print(f"coordinator re-invoke {n}: {r['Payload'].read().decode()}")
    ssm = boto3.client("ssm", region_name=R)
    cmds = ssm.list_commands(Filters=[{"key": "DocumentName", "value": "Opsentra-Lab-RestartNginx"}])["Commands"]
    print("SSM RestartNginx commands so far:", len(cmds), [c["Status"] for c in cmds])
