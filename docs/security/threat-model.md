# Threat model (Phase 9 review, 2026-11-13)

This review builds on blueprint §5.1 (trust boundaries) and §5.3 (threats). It covers what is **built and deployed** through Phase 8. Each row names the control and the evidence that it works. Findings from the Phase 9 audit are in [`phase-9-test-report.md`](../phases/phase-9-test-report.md).

## Assets

| Asset | Why it matters |
|---|---|
| Lab EC2 instance and its Nginx | The only thing Opsentra may break or fix |
| Incident, audit and remediation data | The evidence; audit is append-only |
| Cognito tokens (admin especially) | An admin token can approve runbooks and start lab failures |
| AWS account (shared) | Cost and blast radius beyond Opsentra |
| Terraform state | Contains resource IDs; state writes change infrastructure |

## Trust boundaries (as built)

1. **Public web.** The static dashboard (Demo needs no network). Production builds ship a strict CSP: scripts only from this origin or a hashed inline script, and connections only to the API and Cognito.
2. **API Gateway.** It verifies the Cognito JWT on every route except `/v1/health`, including the `$default` catch-all (Phase 9). The CORS allow-list is exact, credentials are off, and the stage throttle is a burst of 10 at 5 requests per second.
3. **API Lambda.** It takes the role from `cognito:groups` only; a role in a body or query is ignored. It can read and conditionally write the tables and invoke the coordinator and lab controller. Its only wildcard is the read-only `GetMetricStatistics`. It never calls SSM or EC2.
4. **Privileged Lambdas.**
   - **Coordinator and reconciler:** exactly the `RestartNginx` document (Phase 9), only on `opsentra:lab=true` instances.
   - **Lab controller:** exactly `StopNginx` and `RestartNginx`, same tag condition.

   All three re-check the registry, the document hash and the tag in code.
5. **Lab plane.** Its own VPC, HTTP 80 only, no SSH, IMDSv2, self-terminating at expiry, and a probe that disables itself.
6. **CI.** GitHub OIDC is pinned to this repo's PRs and `main`, with a read-only plan role and a state-write deny.

## Threats, controls and evidence

| # | Threat (STRIDE) | Control | Evidence |
|---|---|---|---|
| T1 | Unauthenticated access to live data or actions (S, I) | JWT on every route except health; `$default` also needs a JWT | `probe_api.py`: 20 routes × {no token, malformed, ID token} → 401. Terraform test: only `/v1/health` is public |
| T2 | Privilege escalation via forged role or claim (E) | Role from trusted Cognito groups only | Unit tests (role in body ignored); live attacks Phases 6 and 7: operator/viewer → 403, audited `*_DENIED` |
| T3 | IDOR or arbitrary target (E, T) | Server-side registry and allowlists; the request carries only a runbook or scenario ID; hash-pinned documents; tag check in IAM and code | Unit tests (forged IDs, tampered hash, untagged or stopped instance); live: forged instance/document/command → refused; 7 of 7 SSM commands hit only the lab instance |
| T4 | Command injection (T, E) | No parameters on SSM documents; IDs validated by pattern; no shell or Terraform endpoints | Unit tests (shell metacharacters → 400/404); `probe_api.py` injection-shaped IDs → 4xx |
| T5 | Replay and races (T) | `Idempotency-Key` on every write; conditional (versioned) writes; coordinator lock; lab lock | Unit tests (replay, mutation-tested lock race); live: re-sent decision 409, coordinator re-invoke "skipped", one SSM command |
| T6 | False recovery (T, R) | RESOLVED only after independent probes (3 healthy after the fix, alarm OK) | Live false-success test: SSM Success + Nginx down → ESCALATED |
| T7 | Audit tampering or repudiation (R) | Append-only audit (no `DeleteItem` anywhere; conditional puts); denied attempts audited | Terraform tests (no delete); live audit shows `*_DENIED` rows |
| T8 | XSS / token theft in the browser (I, E) | React escaping, no raw-HTML sinks; CSP (Phase 9); tokens in sessionStorage for one tab, cleared on sign-out or 401; PKCE, no client secret; 60-minute access tokens with revocation | Code scan (no `innerHTML`/`eval`); E2E: CSP present and the app runs with no violation (mutation-tested) |
| T9 | CORS abuse (I) | Exact origins, no credentials, GET/POST/OPTIONS only | `probe_api.py`: unknown and `null` origins get no allow-origin |
| T10 | Transport attacks (I, T) | HTTPS only, TLS ≥ 1.2 | `probe_api.py`: TLS 1.3 negotiated, TLS 1.0/1.1 refused, no HTTP |
| T11 | SSRF via health checks (I) | The probe target comes from Terraform (`TARGET_URL`), never from a request | Code review; no route accepts a URL |
| T12 | Spoofed or stale events (S, T) | EventBridge rules match the account, region and alarm prefix; correlation, dedup and reconciler | Phase 5 replay tests; Phase 7 watchdog tests |
| T13 | Data leakage in exports, logs or screenshots (I) | DTO allowlists; report scrubbing (account IDs, ARNs); CSV formula neutralising; logs never carry tokens, bodies or reasons | Vitest report tests; `test_obs.py`; `scan_secrets.py` full history clean; live export checks |
| T14 | Denial of wallet or service (D) | Stage throttle; no always-on compute; lab expiry, run limit, cooldown; log retention 14 days | Phase 6 burst → 429; `latency_check.py`; log groups all 14 days |
| T15 | Supply chain (T) | Pinned lockfiles; runtime dependencies are stdlib plus the Lambda runtime's boto3; gitleaks in CI | `npm audit --omit=dev`: 0; `pip-audit`: 0; dev-only advisory accepted (F6) |
| T16 | CI credential misuse (E) | OIDC trust exact to repo PRs and `main`; read-only plan role; state-write deny; fork PRs get no token | Terraform tests; Access Analyzer: no findings |

## Residual risks (accepted or owner decision)

| Risk | Status |
|---|---|
| Admin accounts without MFA could be phished; MFA is optional in the pool (F2) | **Owner decision:** the pool stays OPTIONAL; the owner enrols TOTP on the real admin account (confirmation pending). Test users have no admin rights in production use |
| `ReadOnlyAccess` on the CI plan role can read data such as DynamoDB items (F3) | Accepted for a solo repo; revisit if collaborators are added |
| Dev-only `minimatch` ReDoS via typescript-eslint (F6) | Accepted: lint input is our own config; no fix within the supported range |
| `style-src 'unsafe-inline'` in the CSP | Accepted: the toast library injects styles; scripts stay hash-only |
| Shared AWS account: costs are not isolated without the cost-allocation tag | Owner action: activate `opsentra:project` |
| Cognito deletion protection is off (dev) | Accepted: needed for the deferred control-plane destroy test |
