import { formatDuration } from '@/domain/analytics';
import type {
  AnalyticsSummary,
  Incident,
  Mode,
  RemediationRequest,
  TimelineEvent,
} from '@/types/domain';

/**
 * Sanitized report exports (blueprint §7 Phase 8; ADR-019).
 *
 * Built only from fields the API already returns to the browser, picked by
 * name (an allowlist), never by spreading whole objects. As a second guard,
 * every string is passed through `scrub`, which masks anything that looks
 * like an AWS account ID or an ARN. Each file names its dataset; a Demo file
 * says DEMO — SYNTHETIC DATA in its first line and in its name.
 */

export const REPORT_SCHEMA = 'opsentra.report/v1';
const DEMO_LABEL = 'DEMO — SYNTHETIC DATA';

const ACCOUNT_ID = /\b\d{12}\b/g;
const ARN = /\barn:aws[a-z-]*:[^\s"',]+/g;

export function scrub(text: string): string {
  return text.replace(ARN, '<arn>').replace(ACCOUNT_ID, '<account>');
}

function scrubDeep(value: unknown): unknown {
  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v)]));
  }
  return value;
}

function datasetOf(mode: Mode) {
  return mode === 'demo'
    ? { dataset: 'synthetic' as const, label: DEMO_LABEL }
    : { dataset: 'live' as const, label: 'LIVE AWS — ap-southeast-1' };
}

/** Durations from the incident's own timestamps (blueprint §4.5 definitions). */
function durations(i: Incident) {
  const span = (end?: string) =>
    i.detectedAt && end ? (Date.parse(end) - Date.parse(i.detectedAt)) / 1000 : undefined;
  return {
    timeToAcknowledgeSeconds: span(i.acknowledgedAt),
    timeToVerifiedRecoverySeconds: span(i.verifiedHealthyAt),
  };
}

export interface IncidentReport {
  schema: string;
  dataset: 'synthetic' | 'live';
  label: string;
  generatedAt: string;
  incident: Record<string, unknown>;
  measurements: ReturnType<typeof durations>;
  remediations: Record<string, unknown>[];
  timeline: Record<string, unknown>[];
  notes: string[];
}

export function incidentReport(
  mode: Mode,
  incident: Incident,
  events: readonly TimelineEvent[],
  requests: readonly RemediationRequest[],
  generatedAt: string,
): IncidentReport {
  const notes = [
    'MTTR-style durations use verified health (verifiedHealthyAt), never runbook completion.',
  ];
  if (!incident.verifiedHealthyAt) notes.push('Recovery has not been verified for this incident.');
  const report: IncidentReport = {
    schema: REPORT_SCHEMA,
    ...datasetOf(mode),
    generatedAt,
    incident: {
      id: incident.id,
      title: incident.title,
      severity: incident.severity,
      state: incident.state,
      resourceId: incident.resourceId,
      correlationKey: incident.correlationKey,
      openedAt: incident.openedAt,
      detectedAt: incident.detectedAt,
      acknowledgedAt: incident.acknowledgedAt,
      verifiedHealthyAt: incident.verifiedHealthyAt,
      resolvedAt: incident.resolvedAt,
      runbookId: incident.runbookId,
    },
    measurements: durations(incident),
    remediations: requests.map((r) => ({
      requestId: r.requestId,
      actionKey: r.actionKey,
      status: r.status,
      requestedBy: r.requestedBy,
      approvedBy: r.approvedBy,
      selfApproved: r.selfApproved ?? false,
      requestedAt: r.requestedAt,
      decidedAt: r.decidedAt,
      completedAt: r.completedAt,
      executionId: r.executionId,
      errorSummary: r.errorSummary,
    })),
    timeline: [...events]
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .map((e) => ({
        occurredAt: e.occurredAt,
        eventType: e.eventType,
        actorType: e.actorType,
        actorId: e.actorId,
        detail: e.detail,
      })),
    notes,
  };
  return scrubDeep(report) as IncidentReport;
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = scrub(typeof value === 'string' ? value : JSON.stringify(value));
  // Quote everything; neutralise spreadsheet formulas (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function csv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function incidentCsv(report: IncidentReport): string {
  return csv([
    [`# ${report.label}`, report.schema, report.incident.id, report.generatedAt],
    ['occurredAt', 'eventType', 'actorType', 'actorId', 'detail'],
    ...report.timeline.map((e) => [e.occurredAt, e.eventType, e.actorType, e.actorId, e.detail]),
  ]);
}

export interface AnalyticsReport {
  schema: string;
  dataset: 'synthetic' | 'live';
  label: string;
  generatedAt: string;
  definitions: Record<string, string>;
  summary: AnalyticsSummary;
}

export const DEFINITIONS: Record<string, string> = {
  MTTA: 'Mean of acknowledgedAt − detectedAt over acknowledged incidents; unacknowledged ones are excluded and counted.',
  MTTR: 'Mean of verifiedHealthyAt − detectedAt over incidents whose recovery was verified by health checks; runbook completion is not used.',
  Availability:
    'Healthy probes ÷ probes received in the range (Nginx over HTTP, not EC2 running). Minutes without a probe are unknown.',
  Percentiles: 'Median when n ≥ 3; p90 (nearest rank) when n ≥ 10.',
};

export function analyticsReport(
  mode: Mode,
  summary: AnalyticsSummary,
  generatedAt: string,
): AnalyticsReport {
  return scrubDeep({
    schema: REPORT_SCHEMA,
    ...datasetOf(mode),
    generatedAt,
    definitions: DEFINITIONS,
    summary,
  }) as AnalyticsReport;
}

export function analyticsCsv(report: AnalyticsReport): string {
  const s = report.summary;
  const dur = (v?: number) => (v === undefined ? 'unknown' : formatDuration(v));
  const rows: unknown[][] = [
    [`# ${report.label}`, report.schema, `${s.from} to ${s.to}`, report.generatedAt],
    ['metric', 'value', 'denominator', 'note'],
    ['incidents', s.incidentCount, '', `${s.active} active, ${s.escalated} escalated`],
    ...Object.entries(s.bySeverity).map(([k, v]) => [`incidents.${k}`, v, s.incidentCount, '']),
    ['mtta.mean', dur(s.mtta.meanSeconds), s.mtta.count, `${s.mtta.excluded} excluded`],
    ['mtta.median', dur(s.mtta.medianSeconds), s.mtta.count, 'shown when n ≥ 3'],
    ['mttr.mean', dur(s.mttr.meanSeconds), s.mttr.count, `${s.mttr.excluded} excluded`],
    ['mttr.median', dur(s.mttr.medianSeconds), s.mttr.count, 'shown when n ≥ 3'],
    ['runbooks.succeeded', s.runbooks.succeeded, s.runbooks.total, ''],
    ['runbooks.failed', s.runbooks.failed, s.runbooks.total, ''],
    ['runbooks.rejected', s.runbooks.rejected, s.runbooks.total, 'rejected or expired'],
    [
      'availability',
      s.availability
        ? `${((s.availability.healthyProbes / s.availability.totalProbes) * 100).toFixed(2)} %`
        : 'unknown',
      s.availability?.totalProbes ?? 0,
      s.availability?.expectedProbes ? `${s.availability.expectedProbes} minutes in range` : '',
    ],
  ];
  if (s.recoveries) {
    rows.push(['recoveries.afterRunbook', s.recoveries.afterRunbook, s.mttr.count, '']);
    rows.push(['recoveries.selfHealed', s.recoveries.selfHealed, s.mttr.count, '']);
  }
  for (const n of s.dataQuality ?? []) rows.push(['dataQuality', '', '', n]);
  return csv(rows);
}

/** File name: dataset first, so a Demo export can never pass for a Live one. */
export function reportFileName(mode: Mode, subject: string, ext: 'json' | 'csv'): string {
  const safe = subject.replace(/[^A-Za-z0-9._-]+/g, '-');
  return `opsentra-${mode === 'demo' ? 'DEMO-synthetic' : 'live'}-${safe}.${ext}`;
}

export function download(fileName: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
