# Phase 10 checkpoint: public release, docs and portfolio case study

- **Branch:** `feat/release` (merged into `main` to publish)
- **Status:** **Complete.** Gate approved by the owner on 2026-11-13; released as `v1.0.0`.
- **Design:** [`ADR-021`](../adr/ADR-021-public-release.md) (blueprint v1.12.0)
- **Site:** <https://jervilangelo.github.io/opsentra/>

## What was delivered

| Blueprint §7 work item | Where |
|---|---|
| Publish the GitHub Pages demo; protect all Live endpoints | `.github/workflows/pages.yml`; the Live API needs a JWT on every route except `/v1/health` (Phase 9 probe) |
| README: problem, architecture, demo | [`README.md`](../../README.md): what works (Live, Demo, not built), architecture, security, costs, screenshots, run instructions |
| Architecture diagrams, IAM model, IaC setup, runbooks | [`architecture/overview.md`](../architecture/overview.md) (as built), [`iam-model.md`](../security/iam-model.md), [`operations/terraform.md`](../operations/terraform.md), [`runbooks.md`](../operations/runbooks.md) |
| Sample incidents and cost log | A sanitized live incident export (`phase-8/screenshots/opsentra-live-INC-20261113-1D4F09.json`); [`costs/cost-log.md`](../costs/cost-log.md) |
| Public screenshots and demo video, without IDs or secrets | `docs/screenshots/demo/` (current build), `docs/screenshots/live/` (gate runs), [`media/opsentra-demo-walkthrough.webm`](../media/opsentra-demo-walkthrough.webm) |
| Interview story | [`interview-demo/README.md`](../interview-demo/README.md): story, 8-minute walkthrough, fallback, live procedure, checklist |
| Phase log and ADRs | `docs/phases/`, `docs/adr/` (ADR-005 to ADR-021), [`CHANGELOG.md`](../../CHANGELOG.md) |
| Versioned release | `v1.0.0` (git tag) |
| Demo-only versus working | README "What works" matrix; the Architecture page's "What runs where" |

**Stale UI wording fixed:**
- The Architecture page said "Planned architecture · not yet deployed".
- The sign-in page said Cognito "arrives in Phase 3" and showed a disabled button. It now starts the real Cognito sign-in when the build has Live config.
- Settings always said "Signed in: No", even in Live.
- A "Phase 5+" planned label.

## Gate (blueprint §7, Phase 10)

| Gate item | Evidence | Result |
|---|---|---|
| A visitor can use Demo Mode without login | `check_site.cjs` on the published site: Demo by default, `DEMO — SYNTHETIC DATA`, no sign-in, 4 deep links, scenario control, no CSP violation | **Pass** (12/12, with `--expect-live`) |
| An authenticated admin can show the live workflow when resources are on | **Driven entirely through the public site**, as the admin and operator test users: <ol><li>Simulation Lab preflight → start (07:24:57 UTC);</li><li>incident `INC-20261113-6244B0` detected and linked (07:29:25);</li><li>operator request → admin approval → VERIFYING (07:30:00) → **RESOLVED (07:33:26)**;</li><li>the run COMPLETED.</li></ol> | **Pass** |
| Documentation and screenshots match the implementation | Stale UI text fixed (above). README claims checked against the build: Terraform ≥ 1.10, and "SNS alert" rather than "email alert" because the subscription is unconfirmed. Demo screenshots regenerated from this build; Live screenshots from gate runs. Live axe on the published site: 16/16 screens, no violations | **Pass** |
| No leaked sensitive configuration | `check_bundle.py` in the Pages workflow (no account IDs, keys, JWTs, tokens, secrets or source maps; strict CSP; Demo default). The four public `VITE_*` values were checked for the account ID before publishing. `scan_secrets.py` over the full history is clean | **Pass** |
| (cleanup) Lab destroyed after the run | `verify_teardown.py` | **TEARDOWN VERIFIED** |

## Findings during the phase

1. **A build without the repository variables published a Demo-only site.** Expected and harmless; it failed closed with Live "not configured". `check_site.cjs --expect-live` now catches it, and the rebuild with the variables passed.
2. **The gate scripts assumed `localhost:5173`.** They now take `OPSENTRA_UI_URL` and accept the post-login URL without a trailing slash.
3. **A local build quirk:** Git Bash rewrote `--base /opsentra/` into a Windows path. `check_bundle.py` caught it. CI (Linux) is unaffected; use `MSYS_NO_PATHCONV=1` locally.
4. **Deep links return HTTP 404** with the correct page. That is how the GitHub Pages SPA fallback works; visitors see the page.

## Checks

| Check | Result |
|---|---|
| Dashboard Vitest; `tsc`, ESLint, Prettier, build | 178 passed; clean |
| Playwright E2E (Demo, CSP) | 41 passed, 1 skipped |
| Pages workflow on `main` | Success (twice: Demo-only, then Live-configured) |
| `check_site.cjs --expect-live` (published) | 12/12 |
| Live axe (published site) | 16/16 |

## Open (owner)

- **F2:** Cognito admin MFA.
- **License:** not chosen; the README says all rights reserved.
- Activate the `opsentra:project` cost-allocation tag.
- Confirm the SNS email subscription.
- **Not built (labelled):** live Scenarios B and C, a printable HTML report, tracing, and contract (OpenAPI) tests.
