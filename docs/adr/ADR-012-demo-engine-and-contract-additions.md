# ADR-012: Demo Mode engine and Phase 2 contract additions

- **Status:** Agreed (2026-11-12)
- **Phase:** 2
- **Blueprint:** v1.3.0

## Context

Phase 2 makes Demo Mode fully interactive: Detect → Investigate → Approve → Recover, with audit, analytics and reset, and no AWS. To keep Demo honest and reusable for Live, the demo must go through the same `DataSource` interface (one method per §4.2 route) that the Live API adapter will implement in Phases 3–6. Building it exposed these gaps in the blueprint contract:

1. §4.2 has no route that moves an incident to `INVESTIGATING` or `CLOSED`, although §4.4 defines both states.
2. The Recovery Center ("past actions", §2.2) needs a list of remediation requests, but §4.2 only has `GET /v1/remediations/{requestId}`.
3. `GET /v1/runbooks`, `/v1/audit`, `/v1/labs` and `/v1/analytics` have no payload shapes.
4. Scenario C (security group exposure, §6.3) targets a security group, which is not in `ResourceSummary.type`.
5. The mutation inputs (reason, expected version, idempotency key) are described in prose but not typed.

## Decision

### Contract additions (§2.4, §4.2)

| Addition | Shape / behaviour |
|---|---|
| `POST /v1/incidents/{id}/investigate` | Operator+. `ACKNOWLEDGED → INVESTIGATING`. Body `{expectedVersion}` + `Idempotency-Key`. |
| `POST /v1/incidents/{id}/close` | Operator+. `RESOLVED → CLOSED`. Same guard. |
| `GET /v1/remediations?incidentId=` | Viewer+. Newest first. |
| `ResourceType` | adds `'SECURITY_GROUP'` |
| `Runbook` | `id, version, title, description, actionKey, applicableResourceIds, requiresApproval: true` |
| `AuditEvent` | `id, occurredAt, actorType, actorId?, action, targetType ('INCIDENT'\|'REMEDIATION'\|'LAB'), targetId, correlationId, previousState?, newState?, outcome ('SUCCESS'\|'DENIED'\|'FAILED'\|'INFO'), detail` |
| `LabScenario` | `id, group ('A'\|'B'\|'C'), title, summary, expectedOutcome, resourceId, runbookId, available, unavailableReason?` |
| `AnalyticsSummary` | `from, to, incidentCount, bySeverity, active, escalated, mtta, mttr ({meanSeconds?, count, excluded}), runbooks ({succeeded, failed, rejected, total}), availability?` |
| Mutation inputs | `MutationGuard {expectedVersion, idempotencyKey}`; `AcknowledgeInput` adds `reason`; `RemediationRequestInput` adds `runbookId, reason`; `RemediationDecisionInput` adds `decision ('APPROVE'\|'REJECT'), reason`; `StartLabInput {idempotencyKey}` |
| `Role` | `'VIEWER' \| 'OPERATOR' \| 'ADMIN'` (from Cognito groups) |

The caller's identity and role are **never** request parameters (§5.1). In Live they come from the JWT. In Demo they come from a clearly labelled *simulated role* control.

Scenario variants are separate scenario IDs in one group (for example `nginx-outage`, `nginx-restart-fails`, `nginx-stays-down`). That keeps `POST /v1/labs/{scenarioId}/start` free of fault-injection parameters.

### State machine

`src/domain/incident-machine.ts` encodes §4.4, including role requirements:
- Approve and reject need Administrator; everything else needs Operator.
- `request-remediation` is also allowed from `ESCALATED`, so an operator can retry, still behind approval.
- An approval that expires escalates the incident.
- SSM success moves the incident to `VERIFYING`, never `RESOLVED`.

### Demo engine

`src/modes/demo/engine/` is a pure, deterministic simulator:
- **Simulated clock.** Scheduled steps (probes, alarm, ingest, SSM completion, verification, approval expiry) run when the clock reaches them. The clock only advances while a scenario is active. It can be paused, sped up (1×–60×) or jumped to the next event.
- **Same guards the backend will have:** role checks with *denied attempts audited*, optimistic versioning (409), idempotency keys (a replay returns the stored result; reusing a key for a different request is refused), the server-owned runbook allowlist, and a one-active-scenario lock.
- **Deduplication.** Repeat signals on an open incident add evidence but never a second incident or notification, and they are capped.
- **History and persistence.** Deterministic incident history (6 incidents) seeds Analytics and the Recovery Center. The session is saved in `sessionStorage`, and Reset restores the baseline.

## Consequences

- Phases 3–6 must implement these routes and shapes in the Python API, or amend them through a new ADR.
- Availability is `undefined` in Demo (no continuous probing is simulated). The UI says "Unknown" rather than showing a misleading percentage.
- The demo engine runs in the browser only. It is a faithful *model* of the backend rules, not proof of them; the Live implementation needs its own tests (Phase 5–6, §10.2).
