# Phase 4 checkpoint: Real AWS monitoring and inventory

- **Branch:** `feat/live-monitoring`
- **Status:** **In progress.** Code and tests are written and pass locally. The control-plane update, lab deployment and gate test are pending owner approval.

## Gate (blueprint §7, Phase 4)

| Gate item | Evidence | Result |
|---|---|---|
| Stopping Nginx leads to a real health alarm in AWS | `Opsentra-Lab-StopNginx`, then the alarm goes to ALARM and an EventBridge log entry appears | **Pending deploy** |
| The UI shows actual resource and health data | Live Infrastructure after PKCE sign-in, reading `/v1/resources` | **Pending deploy** |
| Metrics and alarm state are not hardcoded | The probe emits from a real HTTP check; health is read from the registry the probe updates | Unit tested; **live pending** |
| The lab can be destroyed | Destroy procedure and verification commands (runbook §5) | **Pending** |

## Local checks (2026-11-12)

| Check | Result |
|---|---|
| Dashboard Vitest | 149 passed (16 new: PKCE, fail-closed Live source, freshness) |
| API pytest | 27 passed, 6 live skipped |
| Health probe pytest | 15 passed, including real HTTP probes; redirects never followed |
| `terraform test` | control-plane 9/9, disposable-labs 6/6, bootstrap 2/2 |
| checkov | 136 passed, 0 failed, 6 lab skips documented inline |
| ruff / eslint / tsc / prettier | Clean |
