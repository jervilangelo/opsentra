# Phase 6 checkpoint: Controlled automated remediation

- **Branch:** `feat/remediation`
- **Status:** **In progress.** Control plane deployed; first live gate run on 2026-11-12 found two bugs (see below and `HANDOFF.md`), fixed on 2026-11-13 (blueprint v1.8.1, commit `884bacb`). **Live gate re-run passed on 2026-11-13 (run 2 below); awaiting the owner's gate review.** Lab destroyed, teardown verified.

## Gate (blueprint §7, Phase 6)

| Gate item | Local evidence | Live |
|---|---|---|
| Genuine Nginx failure recovered without CLI | `test_full_flow_resolves_only_after_three_healthy_probes`, `test_reconciler_run_verifies_and_resolves` | **Pass (run 2).** `INC-20261113-1D4F09`: operator request and admin approval in the UI, one restart, SSM Success 01:55:52, streak from 01:56:07, **RESOLVED 01:59:15** after 4 healthy probes |
| Unauthorized and arbitrary operations denied | `test_roles_are_enforced`, `test_arbitrary_runbooks_are_refused_without_writes` (7 cases), `test_a_changed_document_hash_is_not_allowlisted`, `test_untagged_or_stopped_target_is_never_sent`, `test_coordinator_rejects_untrusted_triggers`, API `test_resource_or_role_in_the_body_is_ignored`, denials audited | **Pass (run 1)** |
| Failed recovery with SSM success never marked recovered | `test_success_without_healthy_probes_escalates_after_the_window`, streak must start after the command finished | **Pass (run 2).** `INC-20261113-4DEF6A`: admin self-approved (`selfApproved: true`), RestartNginx SSM Success, Nginx stopped again 02:10:02; request SUCCEEDED but incident **ESCALATED** at 02:21:15 (`VERIFICATION_FAILED`, "Recovery not verified"), never RESOLVED |
| Replay does not repeat the action | `test_replayed_decision_never_dispatches_twice`, `test_approval_never_picked_up_is_dispatched_once_by_the_reconciler`, API `test_request_then_approve_dispatches_once` | **Pass (run 1)** |

## Local checks (2026-11-12)

| Check | Result |
|---|---|
| `services/incidents` pytest (moto + stubs) | 67 passed |
| `services/api` pytest | 48 passed, 6 live skipped |
| `services/health-check` pytest | 16 passed |
| Dashboard Vitest | 158 passed |
| Dashboard E2E | 37 passed |
| `terraform test` | control-plane 11/11, disposable-labs 7/7 |
| checkov | 191 passed, 0 failed |

## Live run 1 (2026-11-12, UTC)

| Time | Step |
|---|---|
| 08:34 | Control plane (11 added, 7 changed) and lab (41) applied; registry carries the hash-pinned runbook; probe streak counting |
| 08:35:32 | `Opsentra-Lab-StopNginx`; incident `INC-20261112-1838F3` opened 08:38:27 |
| 08:39–08:41 | Operator, in the Live UI: acknowledge, investigate, request "Restart Nginx" (`REQ-20261112-E3312F`) |
| 08:41:39–08:42:01 | Attacks via the API: all refused and audited (table below) |
| 08:42:13 | Admin approved in the Live UI; coordinator sent **one** SSM command at 08:42:18 |
| 08:42:24 | SSM `Success`; request SUCCEEDED; incident **VERIFYING** (not resolved) |
| 08:42:25 | Replay: decision re-sent → 409; two coordinator re-invokes → `skipped`; SSM shows one command for this request |
| 08:42–08:58 | Probe HEALTHY with an unbroken streak, but verification never passed (bug 2) and escalation failed (bug 1) |
| 08:58:12 | Lab destroyed (41); teardown verified |

| Attack | Result |
|---|---|
| No token: decision | 401 |
| Viewer / operator decision; operator with `role: ADMIN` in body | 403 FORBIDDEN (audited) |
| Viewer request | 403 (audited) |
| Forged runbook IDs (`AWS-RunShellScript`, `rb-restart-nginx; reboot`, `Opsentra-Lab-StopNginx`, `../../x`) | 400 VALIDATION, no write |
| Second request while pending, with `resourceId`/`document` in body | 409 INVALID_STATE (audited) |
| Unknown request ID | 404 |
| Stale `expectedVersion` | 409 VERSION_CONFLICT (audited) |
| Burst of calls | 429 from the stage rate limit |

### Bugs found

1. Escalation updates combine `SET … , REMOVE …` in one clause; DynamoDB rejects it (moto did not). The reconciler errors every 2 minutes on the stuck incident.
2. Verification requires the healthy streak to start after `completedAt`; live, it started 1 s before, so a real recovery could never verify.

Both are fixed first in the next session, then the run is repeated.

## Live run 2 (2026-11-13, UTC)

Run together with the Phase 7 gate; full timeline in `phase-7-checkpoint.md`.

| Time | Step |
|---|---|
| 01:41 | Fixes deployed (control plane) |
| 01:42 | Reconciler escalated the stuck `INC-20261112-1838F3` (`VERIFICATION_FAILED` → ESCALATED, `activeRequestId` cleared): **bug 1 fixed live** |
| 01:55–01:59 | Happy path `INC-20261113-1D4F09` → **RESOLVED** with the streak starting after SSM completion: **bug 2 fixed live** |
| 02:09–02:21 | Self-approval + false success `INC-20261113-4DEF6A` → **ESCALATED**, never RESOLVED |
| 02:29 | Lab destroyed; teardown verified |
