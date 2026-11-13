# ADR-019: Live analytics, reports and observability

- **Status:** Agreed (2026-11-13). The owner approved Phase 8 work in chat ("I allow everything until phase 8 finishes").
- **Phase:** 8
- **Blueprint:** v1.10.0

## Context

Phase 8 turns incident evidence into numbers an engineer can trust. The gate demands three things:

- every number reconciles with its source events;
- synthetic and live datasets never mix in one view or report;
- missing signals show as unknown, never as zero failure.

Demo Mode already computed the §4.5 metrics in TypeScript. Live Mode had no analytics route, no exports, and logs without shared identifiers.

## Decisions

| Area | Decision |
|---|---|
| Definitions | **One set of definitions for Live and Demo** (§4.5): <ul><li>an incident is in range by `detectedAt` (else `openedAt`);</li><li>MTTA and MTTR are means over qualifying incidents only, with excluded incidents counted;</li><li>MTTR uses `verifiedHealthyAt`, never runbook completion;</li><li>a median appears when n ≥ 3, and a p90 (nearest rank) when n ≥ 10.</li></ul> Both implementations round halves up, matching JavaScript's `Math.round` (Python's `round` rounds to even). A shared fixture of the four real live-gate incidents pins both to identical results. |
| Live route | `GET /v1/analytics?from&to` (Viewer+). The default range is 30 days, at most 92, and `to` can't be more than 5 minutes in the future; anything else returns 400. Incidents and remediations come from DynamoDB. **Recovery outcomes** come from each incident's `HEALTH_VERIFIED` audit evidence: a remediation `requestId` counts as "after runbook", and `afterClear` counts as "self-healed". |
| Availability | Healthy probes divided by probes **received**, from the `Opsentra/Lab NginxAvailability` metric (CloudWatch `Sum` / `SampleCount`). The period depends on the data's age, because CloudWatch keeps 1-minute data for 15 days, 5-minute data for 63 days and hourly data for 455 days. Requests are split into chunks of at most 1,440 points. **No probes, or an unreadable metric: availability is omitted (unknown).** It is never 0 % or 100 %. When coverage (probes ÷ minutes in range) is below 90 %, a data-quality note says so, and the UI labels the figure "of probed minutes only". |
| Data quality | The response carries plain-language `dataQuality` notes: availability unknown, low coverage, incidents excluded from MTTA or MTTR, and recoveries without an evidence type. Demo returns the same kind of notes. |
| IAM | The API role gains `cloudwatch:GetMetricStatistics` on `*`. This is a read-only call that has no resource-level permissions. It is the **only** wildcard on the API role, which a Terraform test enforces. The API still never calls SSM or EC2. |
| Exports | Incident and analytics reports in JSON and CSV, built in the browser from allowlisted DTO fields only. Every string is scrubbed of 12-digit account IDs and ARNs. CSV cells are quoted, and cells that would start a spreadsheet formula are neutralised. The first line and the file name state the dataset: `opsentra-live-…` or `opsentra-DEMO-synthetic-…` with `DEMO — SYNTHETIC DATA`. A printable HTML report is **not built** (optional in §7). |
| Structured logs | `opsentra_incidents.obs` gives every pipeline Lambda one JSON shape: `msg`, `service` and `awsRequestId`, plus whichever of `incidentId`, `correlationKey`, `requestId`, `runId`, `scenarioId`, `eventId` and `commandId` apply. Empty fields are dropped. User-typed reasons, tokens and account IDs are never logged (tested). |
| Investigation links | Live, on the incident page: the alarm, plus log searches in the ingest, reconciler, coordinator and API log groups, filtered by the incident ID, plus the dashboard. On Analytics: the dashboard. Console URLs carry only the region, never an account ID, and need the viewer's own AWS sign-in. `alarmName` is added to the Incident DTO for this. |
| Dashboard | One CloudWatch dashboard, `opsentra-dev-operations`, managed by Terraform (new `observability` module). It shows: <ul><li>probe availability;</li><li>API requests, 4xx, 5xx and p90 latency;</li><li>Lambda errors, invocations and throttles;</li><li>dead-letter queue depth;</li><li>a Logs Insights "incident trail" table.</li></ul> |
| Reconciliation | `scripts/gate/reconcile_analytics.py` recomputes every field from raw DynamoDB items and CloudWatch with its own code, and diffs it against the API (read-only). |
| Tracing | Not added. X-Ray is optional in §7, and the structured IDs are enough for this scale. |

## Consequences

- **Cost:**
  - The dashboard is within the free tier (3 per account; this account had none on 2026-11-13).
  - `GetMetricStatistics` calls count against the free 1 million API requests per month. The Analytics page does not poll.
  - The dashboard's Logs Insights widget bills per GB scanned when viewed, which is negligible at 14-day retention and these volumes.
- Availability describes the lab's Nginx service across lab lifetimes (the metric dimension is the scenario, not the instance). Gaps between labs are unknown, not downtime.
- Recovery outcomes exist only for incidents whose verification wrote evidence. Older items without it count as "unknown" and are flagged, never guessed.
