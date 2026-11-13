import type {
  AnalyticsSummary,
  Incident,
  MeanDuration,
  RemediationRequest,
  Severity,
} from '@/types/domain';
import { ACTIVE_INCIDENT_STATES } from '@/types/domain';

/**
 * Metric definitions from blueprint §4.5, as pure functions so every number
 * can be reconciled with its source incidents.
 *
 * - MTTA = mean(acknowledgedAt − detectedAt) over acknowledged incidents only.
 * - MTTR = mean(verifiedHealthyAt − detectedAt) over verified incidents only.
 *   Uses verified health, never runbook completion.
 * - Excluded incidents are counted, never silently dropped.
 * - Median when n >= 3, p90 (nearest rank) when n >= 10 (v1.10.0).
 * The Live API computes the same definitions in Python
 * (services/api/src/opsentra_api/analytics.py); both round halves up.
 */

function mean(
  incidents: readonly Incident[],
  end: (i: Incident) => string | undefined,
): MeanDuration {
  const durations: number[] = [];
  for (const i of incidents) {
    const stop = end(i);
    if (!i.detectedAt || !stop) continue;
    durations.push((Date.parse(stop) - Date.parse(i.detectedAt)) / 1000);
  }
  const excluded = incidents.length - durations.length;
  if (durations.length === 0) return { count: 0, excluded };
  const total = durations.reduce((a, b) => a + b, 0);
  const out: MeanDuration = {
    meanSeconds: Math.round(total / durations.length),
    count: durations.length,
    excluded,
  };
  const sorted = [...durations].sort((a, b) => a - b);
  const n = sorted.length;
  const at = (i: number) => sorted[i] ?? 0; // indices below are always in range
  if (n >= 3) {
    const mid = Math.floor(n / 2);
    out.medianSeconds = Math.round(n % 2 ? at(mid) : (at(mid - 1) + at(mid)) / 2);
  }
  if (n >= 10) out.p90Seconds = Math.round(at(Math.max(0, Math.ceil(0.9 * n) - 1)));
  return out;
}

/** Plain-language caveats, worded like the Live API's. */
export function qualityNotes(summary: AnalyticsSummary, availabilityNote: string): string[] {
  const notes: string[] = [];
  if (!summary.availability) notes.push(availabilityNote);
  if (summary.mtta.excluded > 0)
    notes.push(
      `${summary.mtta.excluded} incident(s) were never acknowledged and are excluded from MTTA.`,
    );
  if (summary.mttr.excluded > 0)
    notes.push(
      `${summary.mttr.excluded} incident(s) have no verified recovery and are excluded from MTTR.`,
    );
  return notes;
}

export function computeAnalytics(
  incidents: readonly Incident[],
  remediations: readonly RemediationRequest[],
  fromIso: string,
  toIso: string,
): AnalyticsSummary {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const inRange = incidents.filter((i) => {
    const t = Date.parse(i.detectedAt ?? i.openedAt);
    return t >= from && t <= to;
  });

  const bySeverity: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const i of inRange) bySeverity[i.severity] += 1;

  const ids = new Set(inRange.map((i) => i.id));
  const runbooks = { succeeded: 0, failed: 0, rejected: 0, total: 0 };
  for (const r of remediations) {
    if (!ids.has(r.incidentId)) continue;
    if (r.status === 'SUCCEEDED') runbooks.succeeded += 1;
    else if (r.status === 'FAILED') runbooks.failed += 1;
    else if (r.status === 'REJECTED') runbooks.rejected += 1;
    else continue; // pending or running: no outcome yet
    runbooks.total += 1;
  }

  const summary: AnalyticsSummary = {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    incidentCount: inRange.length,
    bySeverity,
    active: inRange.filter((i) => ACTIVE_INCIDENT_STATES.includes(i.state)).length,
    escalated: inRange.filter((i) => i.state === 'ESCALATED').length,
    mtta: mean(inRange, (i) => i.acknowledgedAt),
    mttr: mean(inRange, (i) => i.verifiedHealthyAt),
    runbooks,
    // Demo Mode does not simulate continuous probing, so availability is
    // unknown rather than a misleading percentage.
  };
  summary.dataQuality = qualityNotes(
    summary,
    'Availability is unknown: Demo Mode does not simulate continuous probing.',
  );
  return summary;
}

/** "1h 02m", "4m 09s", "38s". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}
