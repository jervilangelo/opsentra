"""Phase 9: bounded latency check of the live API (read-only GETs).

Usage: latency_check.py [requests_per_route=40]
Sequential requests with a pause, so the rate stays below the stage throttle
(5 req/s): this measures latency, it is not a stress test. Reports p50/p95/max
per route, cold starts (first request) separately, and any non-200.
Target: client-side warm p95 < 1,500 ms (it includes the internet path from the
machine running it), no 5xx. Server-side latency is in the API access log
(`latencyMs`); compare both before blaming the API (Phase 9 test report).
"""

from __future__ import annotations

import os
import statistics
import sys
import time
import urllib.error
import urllib.request

import boto3

API = os.environ["OPSENTRA_API_URL"].rstrip("/")
ROUTES = ["/v1/health", "/v1/overview", "/v1/incidents", "/v1/incidents/INC-20261113-1D4F09/timeline", "/v1/analytics"]
P95_TARGET_MS = 1500


def token() -> str:
    res = boto3.client("cognito-idp", region_name="ap-southeast-1").admin_initiate_auth(
        UserPoolId=os.environ["OPSENTRA_USER_POOL_ID"],
        ClientId=os.environ["OPSENTRA_TEST_CLIENT_ID"],
        AuthFlow="ADMIN_USER_PASSWORD_AUTH",
        AuthParameters={
            "USERNAME": os.environ["OPSENTRA_TEST_VIEWER_USER"],
            "PASSWORD": os.environ["OPSENTRA_TEST_VIEWER_PASSWORD"],
        },
    )
    return res["AuthenticationResult"]["AccessToken"]


def timed(path: str, tok: str) -> tuple[int, float]:
    req = urllib.request.Request(API + path, headers={"authorization": f"Bearer {tok}"})
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            r.read()
            status = r.status
    except urllib.error.HTTPError as e:
        status = e.code
    return status, (time.perf_counter() - start) * 1000


def main() -> int:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    tok = token()
    bad = 0
    print(f"{'route':48s} {'first':>7s} {'p50':>6s} {'p95':>6s} {'max':>6s}  non-200")
    for route in ROUTES:
        samples, errors = [], {}
        for _ in range(n):
            status, ms = timed(route, tok)
            samples.append(ms)
            if status != 200:
                errors[status] = errors.get(status, 0) + 1
            time.sleep(0.25)
        warm = sorted(samples[1:])
        p95 = warm[max(0, round(0.95 * len(warm)) - 1)]
        slow = p95 > P95_TARGET_MS
        bad += slow or any(s >= 500 for s in errors)
        print(
            f"{route:48s} {samples[0]:7.0f} {statistics.median(warm):6.0f} {p95:6.0f} {max(warm):6.0f}  "
            f"{errors or '-'}{'  SLOW' if slow else ''}"
        )
    print("WITHIN TARGET" if not bad else f"{bad} route(s) over target or with 5xx")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
