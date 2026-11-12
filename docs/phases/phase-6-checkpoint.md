# Phase 6 checkpoint: Controlled automated remediation

- **Branch:** `feat/remediation`
- **Status:** **In progress.** Code and tests pass locally. Deployment and the live gate test are pending owner approval.

## Gate (blueprint §7, Phase 6)

| Gate item | Local evidence | Live |
|---|---|---|
| Genuine Nginx failure recovered without CLI | `test_full_flow_resolves_only_after_three_healthy_probes`, `test_reconciler_run_verifies_and_resolves` | Pending |
| Unauthorized and arbitrary operations denied | `test_roles_are_enforced`, `test_arbitrary_runbooks_are_refused_without_writes` (7 cases), `test_a_changed_document_hash_is_not_allowlisted`, `test_untagged_or_stopped_target_is_never_sent`, `test_coordinator_rejects_untrusted_triggers`, API `test_resource_or_role_in_the_body_is_ignored`, denials audited | Pending |
| Failed recovery with SSM success never marked recovered | `test_success_without_healthy_probes_escalates_after_the_window`, streak must start after the command finished | Pending |
| Replay does not repeat the action | `test_replayed_decision_never_dispatches_twice`, `test_approval_never_picked_up_is_dispatched_once_by_the_reconciler`, API `test_request_then_approve_dispatches_once` | Pending |

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
