# ADR-016: Incident pipeline (ingest, correlation, self-heal, audit)

- **Status:** Agreed (2026-11-12)
- **Phase:** 5
- **Blueprint:** v1.7.0

## Context

Phase 5 must persist alarm signals as incidents that stay correct under duplicated, delayed, malformed and out-of-order EventBridge delivery. It needs operator actions with roles, versioning and idempotency, an append-only audit trail, one alert per incident, and repair of missed events. Resolution must never come from a timeout or from runbook success alone.

## Decisions

| Area | Decision |
|---|---|
| Code layout | One package `services/incidents` (`core`, `ingest`, `reconciler`). The API bundles the same package, so correlation, the state machine and audit writes exist once. |
| Validation | Ingest accepts only `aws.cloudwatch` alarm state changes from this account and region, for alarms listed in a registry item's `alarmNames` (written by Terraform). Anything else is dropped with no write. |
| Delivery dedup | A conditional `PutItem` of `EVENT#<id>` in the audit table (7-day TTL) before any processing. |
| One active incident | A transaction updates `active-correlations` (`attribute_not_exists(activeIncidentId)` and `lastResolvedAt < signal`), puts the incident and appends audit items. A second ALARM becomes `ALARM_REPEATED` evidence; a delayed one never moves `lastSignalAt` back. |
| No false resolution | `OK` only sets `signalClearedAt`. The reconciler resolves (**verified self-heal**, owner decision) only when the alarm is OK *and* the independent HTTP probe reported HEALTHY at least 2 minutes after the clear. `verifiedHealthyAt` is that probe time. |
| No reopening | An ALARM older than `lastResolvedAt` is ignored as stale (§4.4). |
| Reconciler | Every 5 minutes. It repairs missed ALARM (opens the incident via the same path) and missed OK events. It describes only `opsentra-lab-*` alarms and does nothing when nothing is registered. |
| User actions | `acknowledge`, `investigate` and `close`. The role comes from Cognito claims, an `Idempotency-Key` is required, an `expectedVersion` conditional gives 409 on mismatch, and the audit append happens in the same transaction. Replays return the stored response; a reused key with a different request gives 409. |
| Audit | One item serves as both timeline event and audit record (`PK=INCIDENT#<id>`, SK `<time>#<monotonic>`). No principal has `DeleteItem` (tested). Correlation keys omit the account ID because they reach clients. |
| Alerts | SNS topic (AWS-managed key), email subscription from gitignored tfvars, published once per *new* incident. A failed email never rolls back the incident. |
| Failure handling | Ingest: async retries (2) plus an SQS DLQ (14 days). EventBridge target retries (4, up to 1 hour). |

## Consequences

- Idempotency records are written after success, so two concurrent first attempts with the same key fall back to the version check (one wins, the other gets 409).
- The reconciler runs continuously in the control plane (about 8,600 invocations a month, within the free tier). It reads only registered alarms, so it does nothing while no lab exists.
- Remediation (request, approve, execute) stays Demo-only until Phase 6. In Live, the UI says so instead of offering the buttons.
