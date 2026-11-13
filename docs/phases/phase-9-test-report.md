# Phase 9 test report: security hardening, testing, optimization

- **Branch:** `feat/hardening`
- **Date:** 2026-11-13
- **Status:** **Complete.** Gate approved by the owner on 2026-11-13. No critical or high findings are open. The lab was deployed, attacked, audited and destroyed, and teardown was verified. One medium finding (F2, admin MFA) needs an owner decision.
- **Design:** [`ADR-020`](../adr/ADR-020-security-hardening.md) (blueprint v1.11.0).
- **Threat model:** [`docs/security/threat-model.md`](../security/threat-model.md). **Runbooks:** [`docs/operations/runbooks.md`](../operations/runbooks.md).

## Findings

Severity is for the public demo and the live admin APIs. **No critical or high findings.**

| ID | Finding | Severity | Status |
|---|---|---|---|
| F1 | Unknown API routes return API Gateway's own `{"message":"Not Found"}` instead of the `{error:{code,message,requestId}}` envelope | Low | **Accepted.** The fix (a JWT `$default` route) broke CORS preflight in Live and was reverted (see the live gate run). Unknown routes still give 404 with nothing leaked |
| F2 | Cognito MFA is *optional*, though admins can approve runbooks and start lab failures | Medium | **Open.** The owner's **IAM** user has an MFA device (AWS console and CLI are protected). In **Cognito**, though, the only admin is the shared test user `opsentra-admin`, with no MFA, and the owner has no personal dashboard user, so the authenticator does not cover dashboard admin actions. Options: see Pending |
| F3 | The CI plan role's `ReadOnlyAccess` can read data (such as DynamoDB items) | Low | Accepted and documented: the trust is exact to this repo's PRs and `main`, and fork PRs get no token |
| F4 | The coordinator and reconciler could send any `Opsentra-Lab-*` document, including the fault-injection `StopNginx` (the code prevented it; IAM did not) | Medium | **Fixed and deployed:** exactly `RestartNginx`; verified live with the IAM policy simulator; a Terraform test forbids `StopNginx` and the prefix |
| F5 | No Content Security Policy on the dashboard | Medium | **Fixed:** a build-time `<meta>` CSP (scripts self plus a hashed inline script; connections only to the API and Cognito). E2E proves the app runs with no violation. Mutation-tested: a wrong hash fails the test |
| F6 | Dev-only advisory: `minimatch` ReDoS via typescript-eslint (7 moderate, all lint tooling) | Low | Accepted: already the latest typescript-eslint, no fix within its supported range, and input is our own config |
| F7 | `iam-model.md` predated the Phase 7–8 roles and permissions | Info | **Fixed** |

## Results

| Area | Check | Result |
|---|---|---|
| Secrets | `scripts/security/scan_secrets.py` over the full git history (AWS keys, private keys, JWTs, GitHub tokens, passwords, account IDs) | **Clean.** The real account ID appears in no commit; only documented placeholders. gitleaks also runs in CI |
| Dependencies | `npm audit --omit=dev` (shipped code) | **0** vulnerabilities |
| | `npm audit` (incl. dev) | 7 moderate, dev-only (F6) |
| | `pip-audit` on all three services' requirements | **0** |
| IaC | `terraform fmt`/`validate`/`test` | Both roots valid; control plane 13/13, lab 7/7 |
| | checkov | 202 passed, 0 failed (7 documented skips) |
| | Drift (`terraform plan`, control plane) | **No changes:** live equals code |
| IAM | Access Analyzer `validate-policy`, all 7 inline policies | **No findings** |
| Transport | TLS | TLS 1.3 negotiated; TLS 1.0/1.1 refused; no plain HTTP |
| CORS | Unknown origin, `null` origin, credentials, methods | No allow-origin for unknown or `null`; exact dashboard origin; no credentials; GET/POST/OPTIONS only |
| AuthN | 20 protected routes × {no token, malformed, ID token} | **60/60 → 401**; `/v1/health` minimal |
| CORS preflight | `OPTIONS` without a token must succeed | **204** (added after the regression) |
| AuthZ, IDOR, replay, races | Unit tests plus the live attack runs of Phases 6–7 | Viewer/operator → 403 (audited); forged targets refused; replays → 409 or "skipped"; one SSM command per approval; the lab lock race is mutation-tested |
| Input validation | Oversized, traversal, SQL/HTML-shaped, unicode, NUL and ARN IDs; bad query params | All 4xx, no 5xx, no leaked internals |
| Headers | JSON, `cache-control: no-store`, no framework banner | Pass |
| Browser | XSS sinks (`innerHTML`, `eval`, …) | None in `src` |
| | CSP (F5) | Present; the app and exports run with no violation (E2E, desktop and mobile) |
| | Token storage | sessionStorage, per tab, cleared on sign-out or 401; PKCE; no client secret |
| Cognito | Pool and client settings | Admin-only sign-up; 14-character complex passwords; code flow; 60-minute access tokens; revocation; no user-existence errors; MFA optional (F2) |
| State bucket | Public access block, versioning, encryption, TLS-only policy | All on |
| Accessibility | axe (WCAG 2.0/2.1/2.2 AA) on every Demo page, dark and light, desktop and mobile; keyboard skip link and focus | Pass (E2E) |
| | axe on all 8 **Live** screens, dark and light, with the lab ready and with a run active | **32/32, no violations** (`live-axe.cjs`) |
| Latency (bounded, sequential, under the throttle) | Server-side (API access log) | p50 18–35 ms, p95 22–89 ms for the data routes; analytics p95 309 ms (CloudWatch call); one cold start 925 ms |
| | Client-side from the dev machine | p50 230–480 ms; p95 0.6–1.2 s, which is mostly the internet path (≈220 ms floor). No 5xx, no throttling |
| Reliability | DLQs | Both empty |
| | Log retention | All 6 log groups 14 days, small storage |
| Recovery and failure injection | SSM failure, stale health, duplicate and late events, false success, lab disconnect | Unit tests; live in Phases 5–7 (false success → ESCALATED; destroyed lab → run EXPIRED) |
| Core tests | pytest (API 80, incidents 117, health-check 16), Vitest 178, Playwright 41 (+1 skipped) | Pass |

## Live gate run (2026-11-13, UTC)

| Time | Step | Result |
|---|---|---|
| 06:3x | Control-plane apply of F1 and F4 | 1 added (`$default`), 2 changed (IAM) |
| — | `probe_api.py` | 44/44 at the time, but it checked CORS **headers** only (see the regression below) |
| — | `iam simulate-principal-policy` | Coordinator and reconciler: RestartNginx **allowed**, StopNginx and AWS-RunShellScript **implicitDeny**. Lab controller: both lab documents allowed, AWS-RunShellScript denied. **F4 verified live** |
| 06:33 | Lab applied (41 resources, 4 h expiry); HEALTHY and SSM Online at 06:34 | |
| 06:4x | First Live axe run | **Regression found:** Live pages showed "The Opsentra API could not be reached". The `$default` JWT route caught CORS preflight → 401, so every browser call failed. The axe passes on the first three pages were on the error state and are discarded |
| 06:47 | Revert: control-plane apply, `$default` route destroyed (1 destroyed) | Preflight back to 204 at 06:48 (about 10 s of propagation); the Live UI works again |
| 06:48 | Guards added | Terraform test forbids `$default`, `OPTIONS` and `ANY` routes. `probe_api.py` requires a 2xx preflight. `live-axe.cjs` fails on a Live error state |
| 06:49 | `probe_api.py` | **45/45** (unknown route: 404, nothing leaked; F1 accepted) |
| 06:50 | **Live axe, lab ready:** 8 Live screens × dark and light | **16/16, no violations** |
| 06:51 | Live run started in the UI; `lab_attacks.py` twice | **15/15 refused** each time; exactly 1 SSM command on this lab (the UI start) |
| 06:51 | **Live axe, run active** | **16/16, no violations** |
| 06:52 | Reset in the UI | Run RESET; no active runs |
| 06:5x | Lab destroy | 41 destroyed |
| 06:5x | `verify_teardown.py` | **TEARDOWN VERIFIED** (all 11 categories 0) |

**Exposure from the regression:** about 15 minutes, with Live browser calls failing closed (an error was shown and no data was faked). The API itself stayed protected: every route still needed a JWT. It was found by the gate, not by a user.

**Slip (recorded honestly):** an unmasked AWS CLI error during the investigation printed the real account ID in the session output. It is not in any file, commit or log in the repo.

## Open

- **F2 (admin MFA, medium).** The owner's IAM user has MFA, but the Cognito admin `opsentra-admin` has none. Either:
  - **(a)** create a personal Cognito admin with TOTP and remove `opsentra-admin` from `admin`; or
  - **(b)** enrol TOTP on `opsentra-admin`, with its secret added to `.env.test` for the gate scripts.

  Both are Cognito changes for the owner to approve.
- **Owner action:** activate the `opsentra:project` cost-allocation tag.

## Cost baseline (observed 2026-11-13)

Read-only Cost Explorer calls: one tag-status check, then one usage-only query by service. Credits were excluded and no credit balance was read or printed. The `opsentra:project` cost-allocation tag is **inactive**, so the figures are per service for the whole shared account.

| Service (usage only, 2026-11-01 to 11-13) | US$ | Opsentra? |
|---|---|---|
| EC2 compute | 0.0178 | Yes (lab instances) |
| VPC (public IPv4) | 0.0091 | Yes (lab) |
| S3 | 0.0030 | Mostly (Terraform state) |
| EC2 other (EBS) | 0.0027 | Yes (lab volumes) |
| DynamoDB | 0.0018 | Yes |
| API Gateway | 0.0006 | Yes |
| Lambda, CloudWatch, Cognito, SNS, SQS | 0 | Yes, within the free tiers |
| Cost Explorer | 0.0400 | Yes (these reads, $0.01 each) |
| AWS Amplify, AppSync | 0.1862 | **No:** other projects on the shared account |

**Opsentra baseline ≈ US$0.035** for 13 days of building and testing, excluding the Cost Explorer reads. That is far below the guardrails (§11), with no always-on compute. Billing data lags by about a day. **Owner action:** activate the `opsentra:project` cost-allocation tag so future checks can filter by project instead of by service.

## Limitations

- The latency check is bounded and sequential by design (shared account, stage throttle). It is not a stress test.
- The 45-minute lab auto-reset is covered by unit tests only.
- The cost baseline needs billing data from the owner (above).
