# ADR-011: Phase 1 contract, label and colour-mapping fixes

- **Status:** Agreed (2026-11-12)
- **Phase:** 1
- **Blueprint:** v1.2.0

## Context

While preparing the dashboard foundation, the blueprint review found gaps and inconsistencies that Phase 2 would otherwise have to resolve ad hoc:

1. The Demo label was written three ways: `DEMO — simulated data` (§2.2), `DEMO — SYNTHETIC DATA` (§6.4, CLAUDE.md) and `DEMO · synthetic data` (BRAND_GUIDELINES §9).
2. §4.5 defines MTTR with `verifiedHealthyAt`, but the §2.4 `Incident` DTO had no such field.
3. §2.4 had `RunbookState` but no DTO for a remediation request, although §4.3 defines the `opsentra-remediations` table and §4.2 the routes.
4. §4.2 `GET /v1/overview` had no payload shape.
5. The DTO uses `CRITICAL/HIGH/MEDIUM/LOW`, but the brand guidelines show `SEV-1` badges.
6. The status palette covers healthy/warning/critical but not `DEGRADED` or `UNKNOWN`.
7. On light backgrounds, BRAND_GUIDELINES §9 sets `--primary` to Signal Deep `#0284C7`. White button text on it is 4.1:1, below WCAG 2.2 AA (4.5:1) for normal-size text.

## Decision

1. The mode label is **`DEMO — SYNTHETIC DATA`** everywhere. Live is **`LIVE AWS — ap-southeast-1`**. Visual treatment is unchanged: dashed Signal outline for Demo, a solid badge with a dot for Live.
2. Add `Incident.verifiedHealthyAt?: string`, set only after independent post-remediation health checks pass.
3. Add `RemediationRequest`, mirroring §4.3: `requestId, actionKey, incidentId, resourceId, requestedBy, approvedBy?, status: RunbookState, executionId?, expectedVersion, errorSummary?, requestedAt, decidedAt?, completedAt?, expiresAt`.
4. Add `OverviewSummary`: `monitoredResources, healthCounts: Record<Health, number>, activeIncidents, activeBySeverity: Record<Severity, number>, lastSyncAt?`.
5. Severity display is `SEV-1 · Critical`, `SEV-2 · High`, `SEV-3 · Medium`, `SEV-4 · Low`. This is display-only; the DTO is unchanged.
6. Health colours: `HEALTHY` → healthy, `DEGRADED` → warning, `UNHEALTHY` → critical, `UNKNOWN` → Slate `#94A3B8` (dark) / Slate Ink `#475569` (light). Always paired with a text label and an icon.
7. On light backgrounds, `--primary` (button fill) is **Signal Ink `#0369A1`** (5.9:1 with white text). Signal Deep stays the focus ring and symbol colour, where the 3:1 non-text threshold applies. Dark-theme tokens are unchanged.

Related implementation rule from the Phase 1 design review: on the light theme, status badge text uses the foreground ink while the status colour stays on the icon, border and tint. Amber `#B45309` text on its own 12 % tint measured 4.25:1.

## Consequences

- Blueprint §2.1, §2.2, §2.4 and BRAND_GUIDELINES §9 are updated. The blueprint moves to v1.2.0.
- The logo, palette values and typography are unchanged, so this does not alter ADR-010's identity.
- Phase 2 can build the recovery flow and MTTR analytics on typed fields instead of inventing shapes.
