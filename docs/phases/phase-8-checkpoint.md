# Phase 8 checkpoint: Analytics, reporting and observability

- **Branch:** `feat/analytics`
- **Status:** **Built, deployed and gate-tested live on 2026-11-13. Waiting for the owner's gate review.**
- **Design:** `docs/adr/ADR-019-analytics-and-observability.md` (blueprint v1.10.0)

## What was built

| Blueprint §7 work item | Where |
|---|---|
| MTTA/MTTR definitions and denominators | `services/api/src/opsentra_api/analytics.py` (Live) and `apps/dashboard/src/domain/analytics.ts` (Demo). Both use the same rules; excluded incidents are counted |
| Time-window filtering | 24 hours, 7, 30 or 90 days in the UI; `?from&to` on the API (max 92 days) |
| Availability with missing-data caveats | Probe `Sum`/`SampleCount` from CloudWatch, with coverage. Unknown when absent; "of probed minutes only" when coverage is under 90 % |
| Runbook success rate, recovery outcomes | Runbook outcomes from requests; recoveries (runbook versus self-heal) from `HEALTH_VERIFIED` evidence |
| Structured logs with request/correlation IDs | `opsentra_incidents.obs`, used by ingest, reconciler, coordinator, lab controller and remediation |
| CloudWatch dashboard links | `opsentra-dev-operations` (Terraform `observability` module); links on Analytics and on each incident (alarm, 4 log searches, dashboard) |
| Sanitized JSON/CSV incident report | Incident page "Report" card; Analytics "Export JSON/CSV" |
| Printable HTML report (optional) | **Not built** |
| Tracing (optional) | **Not built** |

## Gate (blueprint §7, Phase 8)

| Gate item | Local evidence | Live |
|---|---|---|
| Numbers reconciled with source events | `test_live_gate_incidents_reconcile_by_hand` (real incidents, hand-computed values); Vitest `Live/Demo parity` (same fixture, same expected values) | **Pass.** `reconcile_analytics.py` recomputed every field from raw DynamoDB items, `HEALTH_VERIFIED` audit evidence and CloudWatch, then diffed against `GET /v1/analytics`. All 8 field groups matched for 7 days and for 30 days (the 5-minute metric path). |
| Synthetic and live never mixed in one view or report | Vitest `labels demo exports as synthetic…`; query keys and data sources are per mode (existing) | **Pass.** `live-analytics.cjs`: Live Analytics shows `Dataset: live` and no demo banner. Live exports are `dataset: live` and named `opsentra-live-…`. In Demo the banner shows, and exports are `synthetic`, labelled `DEMO — SYNTHETIC DATA`, named `opsentra-DEMO-synthetic-…`, and contain no live incident IDs. |
| Missing signals shown as unknown, not zero | `test_no_probes_means_unknown_never_zero_or_full`, `test_metric_failure_is_unknown_not_zero`, `test_tiny_coverage_is_not_rounded_to_zero`, CSV `unknown` test | **Pass.** Probes covered about 1 % of the week (the lab exists only during tests). The UI shows 42.97 % "of probed minutes only", with coverage and data-quality notes; it never shows a range-wide uptime. |
| (security) No account IDs or ARNs in exports or links | Vitest scrub, allowlist and CSV-injection tests; link tests | **Pass.** The downloaded Live JSON and CSV files and all 7 console links contain no 12-digit IDs or ARNs. |

## Live run (2026-11-13, UTC)

| Step | Result |
|---|---|
| Control-plane apply | 2 added (analytics route, dashboard), 6 changed (API IAM policy, 5 Lambda code updates), 0 destroyed. Then 1 change twice: API code (coverage wording, `alarmName`) |
| `reconcile_analytics.py` (7 days) | 4 incidents; MTTA 120 s (median 87 s); MTTR 722 s (median 558 s, 1 excluded); runbooks 3/3; recoveries 1 after runbook, 2 self-healed; probes 55/128. **RECONCILED** |
| `reconcile_analytics.py` (30 days) | Same values through the 5-minute metric path. **RECONCILED** |
| `live-analytics.cjs` | 13/13 checks passed (screenshots and exported files in `docs/phases/phase-8/screenshots/`) |
| Structured logs | The reconciler logs `{"msg":"reconcile","service":…,"awsRequestId":…,"errors":0,…}` |

`030606-live-analytics.png` shows the availability wording **before** the fix: a bare 42.97 % with only 1 % coverage. `041216-live-analytics.png` shows it after.

## Local checks (2026-11-13)

| Check | Result |
|---|---|
| `services/api` pytest | 80 passed, 6 live skipped |
| `services/incidents` pytest | 117 passed |
| `services/health-check` pytest | 16 passed |
| ruff (services and gate scripts) | clean |
| Dashboard Vitest | 178 passed |
| Dashboard `tsc -b`, ESLint, Prettier, build | clean |
| Dashboard E2E (Playwright, Demo) | 37 passed, 1 skipped |
| `terraform fmt -check`, `validate` | pass (both roots) |
| `terraform test` (mocked) | control-plane 13/13, disposable-labs 7/7 |
| checkov | 202 passed, 0 failed |

## Findings during the phase

1. **Rounding differed between Python and JavaScript.** Python's `round` rounds halves to even, while `Math.round` rounds them up. A mean of 119.5 s would have shown as 120 s in one mode and 119 s elsewhere for other values. Both now round halves up, and a parity test pins it.
2. **"Probes cover 0%"** appeared for 128 probes in 30 days, which is misleading. It now says "less than 1%" (tested).
3. **The headline availability overstated** a 1 %-coverage figure. It is now labelled "of probed minutes only" when coverage is under 90 %.
4. **A Vitest walk-through test timed out** at 5.15 s under full-suite load. Its limit is now 15 s; it passes alone in about 2 s.

## Cost impact

- **Dashboard:** within the free tier (the account had 0 dashboards).
- **`GetMetricStatistics`:** within the free 1 million API requests per month; the Analytics page does not poll.
- **Logs Insights widget:** negligible.
- **No new compute.**

## Not done (by design)

- **Printable HTML report and tracing:** optional, not built.
- **The lab was not deployed this phase.** All Live data comes from the Phase 5–7 runs, which is enough to reconcile against.
