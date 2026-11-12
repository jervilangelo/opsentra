# Phase 5 checkpoint: Incident detection, management and audit

- **Branch:** `feat/incidents`
- **Status:** **In progress.** Code and tests pass locally. Deployment and the live gate test are pending owner approval.

## Gate (blueprint §7, Phase 5)

| Gate item | Local evidence | Live |
|---|---|---|
| Duplicated events behave safely | `test_duplicate_delivery_is_a_no_op`, `test_concurrent_alarms_open_one_incident` | Pending |
| Delayed and out-of-order events behave safely | `test_delayed_alarm_does_not_move_last_signal_back`, `test_out_of_order_ok_older_than_alarm_is_ignored`, `test_old_alarm_never_reopens_a_resolved_episode` | Pending |
| Malformed events behave safely | 8 parametrised rejections with no writes (`test_malformed_or_foreign_events_write_nothing`) | Pending |
| One active incident per active condition | Correlation transaction tests | Pending |
| Notification not repeated per duplicate | `test_repeated_alarm_adds_evidence_not_an_incident` (1 email) | Pending |
| Timeline tracks all user and system changes | Action and self-heal tests check the timeline; the audit write is in the same transaction | Pending |

## Local checks (2026-11-12)

| Check | Result |
|---|---|
| `services/incidents` pytest (moto) | 34 passed |
| `services/api` pytest | 39 passed, 6 live skipped |
| `services/health-check` pytest | 15 passed |
| Dashboard Vitest | 152 passed |
| Dashboard E2E | 37 passed |
| `terraform test` | control-plane 10/10, disposable-labs 6/6, bootstrap 2/2 |
| checkov | 175 passed, 0 failed |
