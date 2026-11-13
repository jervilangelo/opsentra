# Phase 7 checkpoint: Live Simulation Lab and guardrails

- **Branch:** `feat/remediation` (Phase 6 fixes and Phase 7 together; the owner asked to continue into Phase 7)
- **Status:** **Complete.** Live gate passed and approved by the owner on 2026-11-13. Deployed to the control plane; the lab was deployed for the test and destroyed (teardown verified). Phase 6's live gate passed in the same session (`phase-6-checkpoint.md`).
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
| Every implemented scenario can be started, inspected, recovered/reset without a terminal | `test_start_injects_exactly_the_pinned_document_on_the_registered_instance`, `test_watchdog_confirms_injection_links_incident_and_completes_on_resolution`, `test_reset_restarts_nginx_ends_the_run_and_never_resolves_the_incident`, UI `live-lab.test.tsx` (7 cases) | **Pass.** Run 1: started in the UI → incident linked → approved recovery → RESOLVED → run COMPLETED. Run 2: started → false-success escalation → UI reset → run RESET; the incident stayed ESCALATED until the probe verified health (self-heal RESOLVED). |
| Expired or disconnected scenarios are safely cleaned up | `test_expired_run_is_reset_with_the_allowlisted_restart`, `test_run_whose_lab_was_destroyed_is_ended_without_commands`, `test_failed_injection_ends_the_run`, `test_a_stale_lock_is_released`, `test_one_broken_run_does_not_stop_the_watchdog` | **Pass (disconnect).** Run 3: started, then the lab was destroyed with the run active. The watchdog ended it EXPIRED ("The lab instance is no longer running (terminated)"), sent no command, freed the lock; no incident was left open. The 45-minute time-limit reset is covered by unit tests only (not waited out live). |
| No non-lab resources affected | `test_untagged_stopped_missing_or_offline_targets_are_never_touched` (4 cases), `test_a_tampered_injection_document_is_not_allowlisted`, `test_start_refuses_without_writes` (7 cases), API `test_start_ignores_any_target_in_the_body`, `test_controller_rejects_malformed_invocations` (5 cases), Terraform `lab_controller_is_least_privilege` (exactly two documents, lab tag, no delete/session/document/instance rights) | **Pass.** `lab_attacks.py`: 15/15 refused (no token 401; viewer/operator list, start, reset 403, also with role in body; no confirmation or key 400; 4 forged scenario IDs 404; forged instance/document while busy 409). Every refusal audited `LAB_*_DENIED`. All 7 SSM commands of the session ran on the registered lab instance only (table below). |
| (guardrail) One run at a time, cooldown | `test_two_starts_that_both_pass_preflight_still_get_one_run` (fails if the lock condition is weakened; checked by mutation) | **Pass.** Start while run 1 was active and again during its cooldown → 409 `LAB_BUSY`; the UI showed "Cooldown finished" as failed with the next start time and disabled Start (`015956-lab.png`). |

## Local checks (2026-11-13)

| Check | Result |
|---|---|
| `services/incidents` pytest (moto + stubs; strict UpdateExpression grammar check) | 115 passed |
| `services/api` pytest | 62 passed, 6 live skipped |
| `services/health-check` pytest | 16 passed |
| ruff (check + format) | clean |
| Dashboard Vitest | 169 passed |
| Dashboard `tsc -b`, ESLint, Prettier, `npm run build` | clean |
| Dashboard E2E (Playwright, Demo) | 37 passed, 1 skipped |
| `terraform fmt -check`, `validate` | pass (both roots) |
| `terraform test` (mocked) | control-plane 12/12, disposable-labs 7/7 |
| checkov | 202 passed, 0 failed, 7 skipped (documented skips) |

## Live gate run (2026-11-13, UTC)

| Time | Step |
|---|---|
| 01:41 | Control plane applied: 8 added, 8 changed, 0 destroyed (exactly the planned set) |
| 01:42 | Reconciler (new code) escalated `INC-20261112-1838F3`; `errors: 0` |
| 01:43 | Lab applied (41 resources, expiry 05:42); HEALTHY and SSM Online at 01:44 |
| 01:45 | **Run 1** `LAB-20261113-D91188` started in the UI; all 9 preflight checks passed (`014506-lab-preflight.png`) |
| 01:45 | `lab_attacks.py`: 15/15 refused |
| 01:47 | Watchdog: `LAB_FAULT_INJECTED` (SSM Success) |
| 01:49 | Alarm → incident `INC-20261113-1D4F09` opened; linked to the run at 01:51 |
| 01:55 | Operator request → admin approval (UI) → restart → VERIFYING; **RESOLVED 01:59:15** (Phase 6) |
| 01:59 | Watchdog: run **COMPLETED**; cooldown until 02:04:16 |
| 02:00 | Start during cooldown → 409 `LAB_BUSY`; UI shows the failed check (`015956-lab.png`) |
| 02:04 | **Run 2** `LAB-20261113-0406F4` started; incident `INC-20261113-4DEF6A` linked 02:09 |
| 02:09 | Admin self-approved restart; StopNginx sent right after its Success (02:10:02) |
| 02:21 | Incident **ESCALATED** ("Recovery not verified"), never RESOLVED (Phase 6) |
| 02:21 | UI **reset** → run RESET by opsentra-admin; incident still ESCALATED |
| 02:27 | Alarm cleared 02:23, probe verified 02:27:07 → **RESOLVED** by verified self-heal |
| 02:27 | **Run 3** `LAB-20261113-5E99FD` started; lab destroyed while active (41 destroyed, 02:29) |
| 02:29 | Watchdog: run 3 **EXPIRED** (instance terminated), no command, lock freed |
| 02:29 | `verify_teardown.py`: **TEARDOWN VERIFIED** (all 11 categories 0) |

**SSM commands on the lab instance (all of them):**

| Time | Document | Why |
|---|---|---|
| 01:45:07 | StopNginx | Run 1 start (UI) |
| 01:55:49 | RestartNginx | Approved remediation (Phase 6) |
| 02:04:30 | StopNginx | Run 2 start (UI) |
| 02:09:58 | RestartNginx | Self-approved remediation (Phase 6) |
| 02:10:02 | StopNginx | False-success injection (gate harness, CLI) |
| 02:21:41 | RestartNginx | Run 2 reset (UI) |
| 02:27:53 | StopNginx | Run 3 start (UI) |

**Bugs found live and fixed in this session:**
1. **`GET /v1/audit` returned 500** ("Decimal is not JSON serializable"). The Phase 6 escalation writes a number inside `detail`, and the API store converted only top-level DynamoDB numbers. Fixed with a recursive conversion (`store.plain`) and a moto regression test, which fails on the old code. Redeployed at 01:55 (API Lambda only).
2. **A request failed in the browser with "could not be reached".** The stage throttle (burst 10) answered a CORS preflight with 429, and the browser reports that as a network error. The Live data source now retries a 429 or network failure twice (0.7 s, 1.5 s). This is safe because every write repeats the same `Idempotency-Key`. Tested in Vitest. The throttle guardrail is unchanged.

Screenshots: `docs/phases/phase-7/screenshots/` and `docs/phases/phase-6/screenshots/`.

## Live gate plan (as approved, 2026-11-13)

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
