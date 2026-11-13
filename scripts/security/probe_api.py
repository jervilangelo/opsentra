"""Phase 9: black-box security probe of the live API (read-only).

Usage: probe_api.py      (needs OPSENTRA_API_URL; test-user env vars for the
                          authenticated checks; nothing secret is printed)

Every request is a GET, an OPTIONS, or a POST that the API must refuse before
it changes anything (no token, malformed token, or invalid input). Checks:
  * TLS: HTTPS only, TLS < 1.2 refused, valid certificate;
  * CORS: unknown origins get no Access-Control-Allow-Origin; the dashboard
    origin does; credentials are not allowed;
  * auth: every protected route returns 401 without a token, with a
    malformed token, and with an ID token instead of an access token;
  * input handling: oversized, traversal, injection-shaped and unicode IDs and
    bad query parameters give 4xx, never 5xx, and never echo internals;
  * headers and bodies: JSON, no-store, no stack traces or account IDs.
Exit 1 if any check fails.
"""

from __future__ import annotations

import json
import os
import re
import socket
import ssl
import sys
import urllib.error
import urllib.request
import warnings
from urllib.parse import quote, urlparse

API = os.environ["OPSENTRA_API_URL"].rstrip("/")
HOST = urlparse(API).hostname or ""
DASHBOARD_ORIGIN = os.environ.get("OPSENTRA_DASHBOARD_ORIGIN", "http://localhost:5173")
failures = 0

PROTECTED = [
    ("GET", "/v1/me"),
    ("GET", "/v1/overview"),
    ("GET", "/v1/resources"),
    ("GET", "/v1/resources/i-0123456789abcdef0"),
    ("GET", "/v1/incidents"),
    ("GET", "/v1/incidents/INC-20261113-1D4F09"),
    ("GET", "/v1/incidents/INC-20261113-1D4F09/timeline"),
    ("POST", "/v1/incidents/INC-20261113-1D4F09/acknowledge"),
    ("POST", "/v1/incidents/INC-20261113-1D4F09/investigate"),
    ("POST", "/v1/incidents/INC-20261113-1D4F09/close"),
    ("POST", "/v1/incidents/INC-20261113-1D4F09/request-remediation"),
    ("GET", "/v1/remediations"),
    ("GET", "/v1/remediations/REQ-20261113-13927B"),
    ("POST", "/v1/remediations/REQ-20261113-13927B/decision"),
    ("GET", "/v1/runbooks"),
    ("GET", "/v1/analytics"),
    ("GET", "/v1/audit"),
    ("GET", "/v1/labs"),
    ("POST", "/v1/labs/nginx-outage/start"),
    ("POST", "/v1/labs/nginx-outage/reset"),
]


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    failures += not ok
    detail = re.sub(r"\d{12}", "<account>", detail)
    print(f"{'ok ' if ok else 'BAD'} {name}" + (f"  [{detail}]" if detail else ""))


def request(
    method: str, path: str, headers: dict[str, str] | None = None, body: bytes | None = None
) -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(API + path, method=method, headers=headers or {}, data=body)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def leaks(body: bytes) -> bool:
    text = body.decode("utf-8", "replace")
    return bool(re.search(r"Traceback|File \"/|botocore|arn:aws|\b\d{12}\b|Exception\b", text))


def tls_checks() -> None:
    check("API is HTTPS", API.startswith("https://"))
    try:
        with socket.create_connection((HOST, 80), timeout=5) as s:
            s.sendall(f"GET /v1/health HTTP/1.1\r\nHost: {HOST}\r\nConnection: close\r\n\r\n".encode())
            first = s.recv(200).decode("latin-1").split("\r\n")[0]
        check("plain HTTP is not served", not first.startswith("HTTP/1.1 200"), first or "no response")
    except OSError as err:
        check("plain HTTP is not served", True, f"port 80 refused: {type(err).__name__}")
    ctx = ssl.create_default_context()
    with socket.create_connection((HOST, 443), timeout=10) as s, ctx.wrap_socket(s, server_hostname=HOST) as t:
        check("certificate valid, TLS >= 1.2 negotiated", t.version() in ("TLSv1.2", "TLSv1.3"), str(t.version()))
    warnings.filterwarnings("ignore", category=DeprecationWarning)  # TLS 1.0/1.1 on purpose
    old = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    old.check_hostname, old.verify_mode = False, ssl.CERT_NONE
    old.maximum_version = ssl.TLSVersion.TLSv1_1
    try:
        old.minimum_version = ssl.TLSVersion.TLSv1
        with socket.create_connection((HOST, 443), timeout=10) as s, old.wrap_socket(s, server_hostname=HOST):
            check("TLS 1.0/1.1 refused", False, "handshake succeeded")
    except (ssl.SSLError, OSError) as err:
        check("TLS 1.0/1.1 refused", True, type(err).__name__)


def cors_checks() -> None:
    pre = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"}
    status, h, _ = request("OPTIONS", "/v1/incidents", {"Origin": "https://evil.example", **pre})
    check("CORS: unknown origin gets no allow-origin", "access-control-allow-origin" not in h, f"{status}")
    status, h, _ = request("OPTIONS", "/v1/incidents", {"Origin": DASHBOARD_ORIGIN, **pre})
    check("CORS: dashboard origin allowed exactly", h.get("access-control-allow-origin") == DASHBOARD_ORIGIN, f"{status}")
    check("CORS: credentials not allowed", h.get("access-control-allow-credentials", "false") != "true")
    check("CORS: only GET, POST, OPTIONS", set(h.get("access-control-allow-methods", "").replace(" ", "").split(",")) <= {"GET", "POST", "OPTIONS"})
    status, h, _ = request("GET", "/v1/health", {"Origin": "null"})
    check("CORS: 'null' origin not allowed", h.get("access-control-allow-origin") not in ("null", "*"))


def auth_checks(id_token: str | None) -> None:
    for method, path in PROTECTED:
        body = b"{}" if method == "POST" else None
        cases = [("no token", {}), ("malformed token", {"Authorization": "Bearer not.a.jwt"})]
        if id_token:
            cases.append(("ID token", {"Authorization": f"Bearer {id_token}"}))
        results = []
        for label, hdrs in cases:
            status, _, raw = request(method, path, {"content-type": "application/json", **hdrs}, body)
            results.append(f"{label}={status}")
            if status != 401 or leaks(raw):
                check(f"401 for {method} {path} ({label})", False, f"{status}")
                break
        else:
            check(f"401 for {method} {path}", True, ", ".join(results))
    status, _, raw = request("GET", "/v1/health")
    body = json.loads(raw)
    check("health is public and minimal", status == 200 and set(body["data"]) == {"status", "service", "version", "time"})


def input_checks(token: str) -> None:
    auth = {"Authorization": f"Bearer {token}"}
    weird = [
        "A" * 129,
        "..%2F..%2Fetc%2Fpasswd",
        quote("' OR 1=1 --", safe=""),
        quote("<script>alert(1)</script>", safe=""),
        quote("ｉｎｃ-unicode-✓", safe=""),
        "%00",
        quote("arn:aws:ec2:ap-southeast-1:000000000000:instance/i-1", safe=""),
    ]
    for w in weird:
        for path in (f"/v1/incidents/{w}", f"/v1/resources/{w}", f"/v1/incidents/{w}/timeline"):
            status, h, raw = request("GET", path, auth)
            ok = 400 <= status < 500 and not leaks(raw)
            if not ok:
                check(f"bad ID {path[:60]}", False, f"{status}")
    check("odd path IDs give 4xx without leaks (21 cases)", True)
    for q in ("limit=abc", "limit=-5", "nextToken=%%%", "nextToken=" + "A" * 2000, "state=%3Cx%3E"):
        status, _, raw = request("GET", f"/v1/incidents?{q}", auth)
        check(f"incidents ?{q[:30]} handled", status in (200, 400) and not leaks(raw), str(status))
    for q in ("from=yesterday", "from=2026-11-14T00:00:00Z&to=2026-11-13T00:00:00Z", "from=1900-01-01T00:00:00Z", "to=2999-01-01T00:00:00Z"):
        status, _, raw = request("GET", f"/v1/analytics?{q}", auth)
        check(f"analytics ?{q[:40]} -> 400", status == 400 and not leaks(raw), str(status))
    status, h, raw = request("GET", "/v1/incidents", auth)
    check("JSON content type", h.get("content-type", "").startswith("application/json"))
    check("responses are not cached", "no-store" in h.get("cache-control", ""))
    check("no server/framework banner", "x-powered-by" not in h)
    status, _, raw = request("GET", "/v1/no-such-route", auth)
    check("unknown route -> 404 envelope", status == 404 and b'"error"' in raw and not leaks(raw), str(status))


def tokens() -> tuple[str | None, str | None]:
    if not os.environ.get("OPSENTRA_TEST_VIEWER_USER"):
        return None, None
    import boto3

    res = boto3.client("cognito-idp", region_name="ap-southeast-1").admin_initiate_auth(
        UserPoolId=os.environ["OPSENTRA_USER_POOL_ID"],
        ClientId=os.environ["OPSENTRA_TEST_CLIENT_ID"],
        AuthFlow="ADMIN_USER_PASSWORD_AUTH",
        AuthParameters={
            "USERNAME": os.environ["OPSENTRA_TEST_VIEWER_USER"],
            "PASSWORD": os.environ["OPSENTRA_TEST_VIEWER_PASSWORD"],
        },
    )["AuthenticationResult"]
    return res["AccessToken"], res["IdToken"]


def main() -> int:
    access, id_token = tokens()
    tls_checks()
    cors_checks()
    auth_checks(id_token)
    if access:
        input_checks(access)
    else:
        print("skip: authenticated input checks (no test user env vars)")
    print("ALL CHECKS PASSED" if not failures else f"FAILURES: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
