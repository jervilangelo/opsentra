# Interview demo: story, live procedure and checklist

How to present Opsentra in about 8 minutes, live on AWS or with the clearly labelled Demo Mode. This follows blueprint §13. Every claim below is backed by a test or a gate run.

## The story (30 seconds)

> "Opsentra is a UI-first cloud operations platform I built to monitor AWS workloads, detect incidents and run approved recovery. The infrastructure is Terraform. There is a public Demo Mode with synthetic data and an authenticated Live AWS Mode. The rule I designed everything around: an incident is only resolved when independent health checks prove the service works again, not when a command says 'Success'."

## Walkthrough (Live, about 8 minutes)

| # | Screen | Say | Point at |
|---|---|---|---|
| 1 | Overview | "Live data from the API in Singapore, behind Cognito." | The `LIVE AWS — ap-southeast-1` badge and the last-sync time |
| 2 | Architecture | "Static frontend, serverless control plane, and a disposable lab I create only for tests." | The three planes; "What runs where" |
| 3 | Simulation Lab | "As admin I break the lab on purpose. Nine preflight checks first, one run at a time, and it can only target the tagged lab instance." | The preflight list, the exact instance ID, the cost note; then *Start live scenario* |
| 4 | Incidents (wait 3–5 minutes) | "The probe fails, the alarm needs 3 failed minutes, EventBridge delivers it, and the incident opens once, deduplicated." | Detection time; the evidence row; the timeline note "caused by a Simulation Lab test" |
| 5 | Incident → Request | "An operator asks for the allowlisted runbook. The request carries only a runbook ID; the server decides the target." | The confirmation dialog: resource, environment |
| 6 | Incident → Approve | "An admin approves. It runs exactly once: replays get a 409." | Recovery progress: Requested → Authorized → Executing |
| 7 | Verifying → Resolved | "SSM said Success, but that is not recovery. It waits for 3 healthy probes after the fix." | The VERIFYING state, then RESOLVED; health-verified time |
| 8 | Analytics, Audit | "MTTA and MTTR with their denominators, reconciled against the raw data. Every action, including denied ones, is in an append-only audit." | The n and excluded counts; `*_DENIED` rows; export JSON |
| 9 | Wrap-up | "Security tests, the threat model, costs (about 3½ cents for the whole build), and I destroy the lab now." | `docs/phases/phase-9-test-report.md`; run teardown |

**Good questions to expect:**
- *Why not auto-remediate?* Approval is the guardrail for a production-like action. The coordinator would run the same way without it.
- *What if SSM succeeds but Nginx stays down?* It escalates. This was tested live.
- *How do you know the numbers are right?* `reconcile_analytics.py` recomputes them from source data.
- *What broke along the way?* A mock accepted an invalid DynamoDB update, and a catch-all API route broke CORS preflight. Both were found by gates, fixed and guarded with tests.

## Fallback: no AWS available

Use the public **Demo Mode** (<https://jervilangelo.github.io/opsentra/>), which needs no sign-in. Say clearly: *"This is the Demo Mode: synthetic data, same workflow."* Then show the real evidence instead of claiming it is live:

- Phase 6 and Phase 7 checkpoints (live timelines);
- the Live screenshots in `docs/screenshots/live/`;
- the [Demo walkthrough video](../media/opsentra-demo-walkthrough.webm).

## Live procedure

Commands are in [runbooks §1–2](../operations/runbooks.md). Every AWS write needs the owner's approval.

1. **The day before:** `aws login`. The control-plane `terraform plan` should show no changes. Run `scripts/security/probe_api.py`; it should print ALL CHECKS PASSED.
2. **20 minutes before:** deploy the lab with a 4-hour expiry. Wait for HEALTHY and SSM Online, about 2 minutes. Open the site, sign in as admin, and check that all preflight checks pass.
3. **Accounts:** an admin user (approves, starts the lab) and an operator user (requests) make the separation of duties visible. One admin works too; the UI then flags "self-approved".
4. **After:** reset any active run, destroy the lab, then `scripts/gate/verify_teardown.py` must print `TEARDOWN VERIFIED`.

## Checklist (repeatable)

| Before | ✓ |
|---|---|
| Control-plane plan: no changes | ☐ |
| `probe_api.py`: all checks pass (TLS, CORS preflight, auth) | ☐ |
| Lab deployed; probe HEALTHY; SSM Online | ☐ |
| Signed in on the public site; Live badge visible; no demo banner | ☐ |
| Simulation Lab: all 9 preflight checks pass | ☐ |

| After | ✓ |
|---|---|
| Incident RESOLVED (or escalated, and explained) | ☐ |
| Lab destroyed; `verify_teardown.py`: TEARDOWN VERIFIED | ☐ |
| No account IDs in any screenshot or recording you share | ☐ |
