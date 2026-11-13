import { dashboardUrl, incidentLinks, logSearchUrl } from '@/features/observability/links';
import type { AnalyticsSummary, Incident, TimelineEvent } from '@/types/domain';

import {
  analyticsCsv,
  analyticsReport,
  incidentCsv,
  incidentReport,
  reportFileName,
  scrub,
} from './report';

const incident = {
  id: 'INC-1',
  correlationKey: 'ap-southeast-1:i-0lab:opsentra-lab-nginx-availability',
  resourceId: 'i-0lab',
  title: 'Nginx down',
  severity: 'HIGH',
  state: 'RESOLVED',
  openedAt: '2026-11-13T00:00:00Z',
  detectedAt: '2026-11-13T00:00:00Z',
  acknowledgedAt: '2026-11-13T00:01:00Z',
  verifiedHealthyAt: '2026-11-13T00:10:00Z',
  version: 6,
  // Not part of the DTO: must never be copied into a report.
  secretNote: 'token abc',
} as Incident & { secretNote: string };

const events: TimelineEvent[] = [
  {
    id: '2',
    incidentId: 'INC-1',
    occurredAt: '2026-11-13T00:10:00Z',
    eventType: 'HEALTH_VERIFIED',
    actorType: 'SYSTEM',
    detail: { note: 'arn:aws:sns:ap-southeast-1:111122223333:topic and 111122223333' },
  },
  {
    id: '1',
    incidentId: 'INC-1',
    occurredAt: '2026-11-13T00:01:00Z',
    eventType: 'INCIDENT_ACKNOWLEDGED',
    actorType: 'USER',
    actorId: '=HYPERLINK("http://evil")',
    detail: {},
  },
];

const GEN = '2026-11-13T01:00:00Z';

describe('sanitized reports (Phase 8)', () => {
  it('masks account IDs and ARNs everywhere', () => {
    expect(scrub('arn:aws:iam::111122223333:role/x in 111122223333')).toBe('<arn> in <account>');
    const text = JSON.stringify(incidentReport('live', incident, events, [], GEN));
    expect(text).not.toMatch(/\d{12}/);
    expect(text).not.toContain('arn:aws');
  });

  it('copies only allowlisted fields and measures from verified health', () => {
    const r = incidentReport('live', incident, events, [], GEN);
    expect(JSON.stringify(r)).not.toContain('secretNote');
    expect(r.measurements).toEqual({
      timeToAcknowledgeSeconds: 60,
      timeToVerifiedRecoverySeconds: 600,
    });
    expect(r.timeline.map((e) => e.eventType)).toEqual([
      'INCIDENT_ACKNOWLEDGED',
      'HEALTH_VERIFIED',
    ]);
  });

  it('labels demo exports as synthetic in the content and the file name', () => {
    const r = incidentReport('demo', incident, events, [], GEN);
    expect([r.dataset, r.label]).toEqual(['synthetic', 'DEMO — SYNTHETIC DATA']);
    expect(incidentCsv(r).split('\r\n')[0]).toContain('DEMO — SYNTHETIC DATA');
    expect(reportFileName('demo', 'INC-1', 'csv')).toBe('opsentra-DEMO-synthetic-INC-1.csv');
    expect(reportFileName('live', 'a/b c', 'json')).toBe('opsentra-live-a-b-c.json');
  });

  it('neutralises spreadsheet formulas in CSV cells', () => {
    const csv = incidentCsv(incidentReport('live', incident, events, [], GEN));
    expect(csv).toContain('"\'=HYPERLINK(""http://evil"")"');
  });

  it('analytics CSV writes unknown values as unknown, never 0 or 100 %', () => {
    const summary: AnalyticsSummary = {
      from: '2026-11-12T00:00:00Z',
      to: '2026-11-13T00:00:00Z',
      incidentCount: 0,
      bySeverity: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
      active: 0,
      escalated: 0,
      mtta: { count: 0, excluded: 0 },
      mttr: { count: 0, excluded: 0 },
      runbooks: { succeeded: 0, failed: 0, rejected: 0, total: 0 },
      dataQuality: ['Availability is unknown: no health probes ran in this range.'],
    };
    const csv = analyticsCsv(analyticsReport('live', summary, GEN));
    expect(csv).toContain('"availability","unknown"');
    expect(csv).toContain('"mtta.mean","unknown"');
    expect(csv).toContain('no health probes ran');
  });
});

describe('CloudWatch investigation links', () => {
  it('use the console encoding and never include an account ID', () => {
    expect(logSearchUrl('/aws/lambda/opsentra-dev-api', 'INC-1')).toBe(
      'https://ap-southeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-southeast-1#logsV2:log-groups/log-group/$252Faws$252Flambda$252Fopsentra-dev-api/log-events$253FfilterPattern$253D$2522INC-1$2522',
    );
    expect(dashboardUrl('dev')).toMatch(/#dashboards\/dashboard\/opsentra-dev-operations$/);
    const links = incidentLinks('dev', 'INC-1', 'opsentra-lab-nginx-availability');
    expect(links[0]?.label).toBe('Alarm opsentra-lab-nginx-availability');
    expect(links.every((l) => !/\d{12}/.test(l.href))).toBe(true);
  });
});
