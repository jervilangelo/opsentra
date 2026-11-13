# ADR-020: Phase 9 security hardening

- **Status:** Agreed (2026-11-13). The owner approved the Phase 9 changes and AWS steps in chat.
- **Phase:** 9
- **Blueprint:** v1.11.0

## Context

The Phase 9 audit ([`phase-9-test-report.md`](../phases/phase-9-test-report.md)) found no critical or high issues, and four medium or low ones worth acting on. This ADR records the scope changes. Everything else stays as designed in ADR-014 to ADR-019.

## Decisions

| Area | Decision |
|---|---|
| Runbook IAM (F4) | The coordinator and reconciler may send **exactly** `Opsentra-Lab-RestartNginx`, no longer the `Opsentra-Lab-*` prefix. Only the lab controller may send `StopNginx`. Verified live with `iam simulate-principal-policy`; a Terraform test forbids `StopNginx` and the prefix for those roles. |
| CSP (F5) | Production builds carry a `<meta>` Content Security Policy, since GitHub Pages cannot send headers. <ul><li>**Scripts:** `'self'` plus the hashed inline theme script.</li><li>**Connections:** `'self'`, the API origin and the Cognito domain from the build's `VITE_*` config.</li><li>**Styles:** `'self' 'unsafe-inline'`, because the toast library injects a `<style>` tag.</li><li>**Locked down:** `object-src 'none'`, `frame-src 'none'`, `base-uri 'self'`, `form-action 'self'`.</li></ul> Not applied to `vite dev`. E2E proves the app runs under the policy (mutation-tested). |
| Unknown-route body (F1) | **Not changed (accepted, low).** A JWT-protected `$default` catch-all would have returned the `{error}` envelope for unknown paths. In practice it also caught CORS preflight (OPTIONS, sent without a token) and answered 401, which broke every browser call in Live. It was deployed, found by the Live axe gate, and reverted within minutes. A Terraform test now forbids `$default`, `OPTIONS` and `ANY` routes, and the probe requires a 2xx preflight. |
| Admin MFA (F2) | **Open (medium).** The owner's IAM user has MFA. The Cognito admin is the shared test user `opsentra-admin`, with no MFA. The options (a personal Cognito admin with TOTP, or TOTP on the test user) need an owner decision and a Cognito change. |
| Accepted | <ul><li>F3: `ReadOnlyAccess` on the CI plan role (solo repo; exact OIDC trust).</li><li>F6: a dev-only `minimatch` advisory (no fix within typescript-eslint's supported range).</li></ul> |
| Repeatable checks | `scripts/security/` holds the repeatable checks: `scan_secrets.py` (full history), `probe_api.py` (TLS, CORS incl. preflight status, auth on every route, input fuzzing, headers), `latency_check.py` (bounded). `scripts/gate/live-axe.cjs` runs axe on every Live screen and fails on a Live error state. |

## Consequences

- Least privilege is tighter: a compromised coordinator or reconciler can no longer inject a fault.
- An XSS bug could not send tokens to another origin, and could not load outside scripts.
- Lesson recorded: a header-only CORS check missed a 401 preflight. Gate checks must assert status codes and refuse to audit error pages.
- **Cost:** none. No new resources; the CSP is static.
