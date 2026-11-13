# Phase 9 test report: security hardening, testing, optimization

- **Branch:** `feat/hardening`
- **Date:** 2026-11-13
- **Status:** **Audit complete; local fixes done and tested; cost baseline observed. Gate not yet passable:** the F1/F4 deploy and the lab destroy cycle were requested by the owner ("finish the phase 9"), but the Claude Code auto-mode classifier blocked `terraform apply` ("Protected-Scope IaC Apply"). Nothing was applied. They need the owner to run them or to allow them (see "Pending").
- **Threat model:** [`docs/security/threat-model.md`](../security/threat-model.md). **Runbooks:** [`docs/operations/runbooks.md`](../operations/runbooks.md).

## Findings

Severity is for the public demo and the live admin APIs. **No critical or high findings.**

| ID | Finding | Severity | Status |
|---|---|---|---|
| F1 | Unknown API routes returned API Gateway's own `{"message":"Not Found"}` instead of the `{error:{code,message,requestId}}` envelope | Low | **Fixed in code:** JWT-protected `$default` route → the Lambda's 404 envelope. Terraform test added. Deploy pending approval |
| F2 | Cognito MFA is *optional*, though admins can approve runbooks and start lab failures | Medium | **Open.** The owner's **IAM** user has an MFA device (AWS console and CLI are protected). In **Cognito**, though, the only admin is the shared test user `opsentra-admin`, with no MFA, and the owner has no personal dashboard user, so the authenticator does not cover dashboard admin actions. Options: see Pending |
| F3 | The CI plan role's `ReadOnlyAccess` can read data (such as DynamoDB items) | Low | Accepted and documented: the trust is exact to this repo's PRs and `main`, and fork PRs get no token |
| F4 | The coordinator and reconciler could send any `Opsentra-Lab-*` document, including the fault-injection `StopNginx` (the code prevented it; IAM did not) | Medium | **Fixed in code:** exactly `RestartNginx`. A Terraform test forbids `StopNginx` and the prefix. Deploy pending approval |
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
| AuthZ, IDOR, replay, races | Unit tests plus the live attack runs of Phases 6–7 | Viewer/operator → 403 (audited); forged targets refused; replays → 409 or "skipped"; one SSM command per approval; the lab lock race is mutation-tested |
| Input validation | Oversized, traversal, SQL/HTML-shaped, unicode, NUL and ARN IDs; bad query params | All 4xx, no 5xx, no leaked internals |
| Headers | JSON, `cache-control: no-store`, no framework banner | Pass |
| Browser | XSS sinks (`innerHTML`, `eval`, …) | None in `src` |
| | CSP (F5) | Present; the app and exports run with no violation (E2E, desktop and mobile) |
| | Token storage | sessionStorage, per tab, cleared on sign-out or 401; PKCE; no client secret |
| Cognito | Pool and client settings | Admin-only sign-up; 14-character complex passwords; code flow; 60-minute access tokens; revocation; no user-existence errors; MFA optional (F2) |
| State bucket | Public access block, versioning, encryption, TLS-only policy | All on |
| Accessibility | axe (WCAG 2.0/2.1/2.2 AA) on every Demo page, dark and light, desktop and mobile; keyboard skip link and focus | Pass (E2E). Live-only screens: pending (lab cycle) |
| Latency (bounded, sequential, under the throttle) | Server-side (API access log) | p50 18–35 ms, p95 22–89 ms for the data routes; analytics p95 309 ms (CloudWatch call); one cold start 925 ms |
| | Client-side from the dev machine | p50 230–480 ms; p95 0.6–1.2 s, which is mostly the internet path (≈220 ms floor). No 5xx, no throttling |
| Reliability | DLQs | Both empty |
| | Log retention | All 6 log groups 14 days, small storage |
| Recovery and failure injection | SSM failure, stale health, duplicate and late events, false success, lab disconnect | Unit tests; live in Phases 5–7 (false success → ESCALATED; destroyed lab → run EXPIRED) |
| Core tests | pytest (API 80, incidents 117, health-check 16), Vitest 178, Playwright 41 (+1 skipped) | Pass |

## Pending (needs owner approval or decision)

1. **Deploy F1 and F4.** The control-plane plan is 1 to add (`$default` route), 2 to change (coordinator and reconciler IAM), 0 to destroy. Afterwards, re-run `probe_api.py` and confirm the unknown route returns the envelope.
2. **Lab cycle for the gate.**
   - Deploy the lab.
   - Run axe on the Live-only screens (Simulation Lab, Analytics, incident report).
   - Re-run the Phase 7 attacks under the narrowed IAM.
   - Destroy the lab and run `verify_teardown.py`.
3. **Cost baseline:** done. See "Cost baseline" below.
4. **F2 (MFA).** Either:
   - **(a)** create a personal Cognito admin user with TOTP and remove `opsentra-admin` from the `admin` group, keeping it for gate scripts only when needed; or
   - **(b)** enrol TOTP on `opsentra-admin`; the gate scripts would then need its TOTP secret in `.env.test`.

   Both change Cognito, so they need owner approval.

**What the gate still needs:** "AWS lab destroy verified" (the lab cycle) and "acceptable cost baseline observed" (Cost Explorer or a manual Billing check). F1 and F4 are fixed in code but not live until deployed.

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
