# Phase 7 checkpoint: Live Simulation Lab and guardrails

- **Branch:** `feat/remediation` (Phase 6 fixes and Phase 7 together; the owner asked to continue into Phase 7)
- **Status:** **Built and tested locally (2026-11-13). Not deployed. Live gate not run.** The AWS CLI session had expired, and only the owner can sign in again. Phase 6's live gate is also still pending (see `phase-6-checkpoint.md` and `HANDOFF.md`).
- **Design:** `docs/adr/ADR-018-live-simulation-lab.md` (blueprint v1.9.0)

## What was built

| Blueprint §7 work item | Where |
|---|---|
| Admin-only scenario registry | `opsentra_incidents.lab.CATALOG` (Scenario A); registry `scenarios` pin written by Terraform (`registry.tf`) |
| Preflight checks | `lab.preflight`: nine ordered checks, re-run on the server at start |
| Confirmation messages | UI confirm dialog (instance, environment, cost); API requires `acknowledgeImpact: true` |
| Cooldown | 5 minutes after a run ends (`LOCK.cooldownUntil`) |
| One-active-scenario lock | Conditional update on the `LOCK` item in `opsentra-dev-lab-runs` |
| Session expiry | Runs end after 45 minutes (or at lab expiry); the watchdog restarts Nginx |
| Nginx stop/restart live flow | Start sends hash-pinned `Opsentra-Lab-StopNginx`. Recovery uses the Phase 6 approved runbook. Reset sends hash-pinned `Opsentra-Lab-RestartNginx` |
| Watchdog for abandoned tests | `lab.watchdog` in the reconciler (every 2 minutes) |
| Teardown automation | Self-terminating instance and probe schedule end (Phase 4), watchdog for a vanished lab, `scripts/gate/verify_teardown.py` (read-only) |
| Budget disclosure | Shown on the Live lab page before every start |
| Fallback demo when labs are off | Live page says "The live lab is off" and offers Demo Mode |
| Lambda regression / SG injection (optional) | **Not built for Live**; Demo only, shown as planned |

## Gate (blueprint §7, Phase 7)

| Gate item | Local evidence | Live |
|---|---|---|
| Every implemented scenario can be started, inspected, recovered/reset without a terminal | `test_start_injects_exactly_the_pinned_document_on_the_registered_instance`, `test_watchdog_confirms_injection_links_incident_and_completes_on_resolution`, `test_reset_restarts_nginx_ends_the_run_and_never_resolves_the_incident`, UI `live-lab.test.tsx` (7 cases) | Pending |
| Expired or disconnected scenarios are safely cleaned up | `test_expired_run_is_reset_with_the_allowlisted_restart`, `test_run_whose_lab_was_destroyed_is_ended_without_commands`, `test_failed_injection_ends_the_run`, `test_a_stale_lock_is_released`, `test_one_broken_run_does_not_stop_the_watchdog` | Pending |
| No non-lab resources affected | `test_untagged_stopped_missing_or_offline_targets_are_never_touched` (4 cases), `test_a_tampered_injection_document_is_not_allowlisted`, `test_start_refuses_without_writes` (7 cases), API `test_start_ignores_any_target_in_the_body`, `test_controller_rejects_malformed_invocations` (5 cases), Terraform `lab_controller_is_least_privilege` (exactly two documents, lab tag, no delete/session/document/instance rights) | Pending |
| (guardrail) One run at a time even under a race | `test_two_starts_that_both_pass_preflight_still_get_one_run` (fails if the lock condition is weakened; checked by mutation) | Pending |

## Local checks (2026-11-13)

| Check | Result |
|---|---|
| `services/incidents` pytest (moto + stubs; strict UpdateExpression grammar check) | 115 passed |
| `services/api` pytest | 61 passed, 6 live skipped |
| `services/health-check` pytest | 16 passed |
| ruff (check + format) | clean |
| Dashboard Vitest | 167 passed |
| Dashboard `tsc -b`, ESLint, Prettier, `npm run build` | clean |
| Dashboard E2E (Playwright, Demo) | 37 passed, 1 skipped |
| `terraform fmt -check`, `validate` | pass (both roots) |
| `terraform test` (mocked) | control-plane 12/12, disposable-labs 7/7 |
| checkov | 202 passed, 0 failed, 7 skipped (documented skips) |

## Live gate plan (owner approval covers these steps, 2026-11-13)

Each step needs a valid AWS session first (`aws login` by the owner).

1. Control-plane `terraform plan`, then `apply`. **Expected changes:** <ul><li>one new DynamoDB table (`lab-runs`);</li><li>one new Lambda with its role, policy and log group (`lab-controller`);</li><li>three API routes;</li><li>API, reconciler and coordinator code and environment updates;</li><li>IAM policy updates (the API may invoke the lab-controller; the data statements cover `lab-runs`).</li></ul> **Stop and report** if the plan shows anything else.
2. Confirm the stuck `INC-20261112-1838F3` escalates (Phase 6 bug 1 fix).
3. Lab `terraform apply` with a 4-hour expiry.
4. **Phase 6 gate:** <ul><li>the happy path to RESOLVED;</li><li>self-approval plus false success, which must end ESCALATED.</li></ul>
5. **Phase 7 gate**, all from the UI (`scripts/gate/live-lab.cjs`): <ul><li>preflight screenshot → start → incident linked → approved recovery → RESOLVED → run COMPLETED;</li><li>a second start during cooldown is refused;</li><li>start → reset → run RESET, incident still open until verified;</li><li>attack checks: operator, viewer and no-token starts, and body targets ignored.</li></ul>
6. **Expiry/disconnect:** <ul><li>leave a run active and destroy the lab;</li><li>the watchdog must end it with no command.</li></ul>
7. Lab `terraform destroy`, then `scripts/gate/verify_teardown.py` must print `TEARDOWN VERIFIED`.
8. Record evidence here, commit, push, and ask the owner for the Phase 6 and Phase 7 gate review.

## Cost impact

- **New:** <ul><li>one on-demand DynamoDB table (a few writes per run);</li><li>one Lambda (a few calls per run);</li><li>one log group (14-day retention).</li></ul> All within the free tiers. SSM Run Command on EC2 is free.
- **Lab while deployed:** about US$0.01–0.02 per hour, unchanged from Phase 4.

## Open items

- Phase 6 live gate (above, step 4).
- Scenarios B and C in Live: planned, not built.
- SNS email subscription still *PendingConfirmation* (owner action).
