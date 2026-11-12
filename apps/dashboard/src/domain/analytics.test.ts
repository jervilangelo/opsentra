import type { Incident, RemediationRequest } from '@/types/domain';

import { computeAnalytics, formatDuration } from './analytics';

const base: Omit<Incident, 'id' | 'detectedAt' | 'openedAt' | 'state'> = {
  correlationKey: 'k',
  resourceId: 'r',
  title: 't',
  severity: 'HIGH',
  version: 1,
};

const incidents: Incident[] = [
  {
    ...base,
    id: 'a',
    state: 'CLOSED',
    detectedAt: '2026-11-01T00:00:00Z',
    openedAt: '2026-11-01T00:00:05Z',
    acknowledgedAt: '2026-11-01T00:01:00Z',
    verifiedHealthyAt: '2026-11-01T00:10:00Z',
  },
  {
    ...base,
    id: 'b',
    state: 'RESOLVED',
    severity: 'LOW',
    detectedAt: '2026-11-02T00:00:00Z',
    openedAt: '2026-11-02T00:00:05Z',
    verifiedHealthyAt: '2026-11-02T00:05:00Z',
  },
  {
    ...base,
    id: 'c',
    state: 'OPEN',
    severity: 'CRITICAL',
    detectedAt: '2026-11-03T00:00:00Z',
    openedAt: '2026-11-03T00:00:05Z',
    acknowledgedAt: '2026-11-03T00:03:00Z',
  },
  {
    ...base,
    id: 'old',
    state: 'CLOSED',
    detectedAt: '2026-09-01T00:00:00Z',
    openedAt: '2026-09-01T00:00:05Z',
    acknowledgedAt: '2026-09-01T00:00:10Z',
    verifiedHealthyAt: '2026-09-01T00:00:20Z',
  },
];

const req = (incidentId: string, status: RemediationRequest['status']): RemediationRequest => ({
  requestId: `${incidentId}-${status}`,
  actionKey: 'x',
  incidentId,
  resourceId: 'r',
  requestedBy: 'u',
  status,
  expectedVersion: 1,
  requestedAt: '2026-11-01T00:00:00Z',
  expiresAt: '2026-11-01T01:00:00Z',
});

describe('computeAnalytics (§4.5)', () => {
  const a = computeAnalytics(
    incidents,
    [req('a', 'SUCCEEDED'), req('a', 'FAILED'), req('c', 'PENDING'), req('old', 'SUCCEEDED')],
    '2026-10-15T00:00:00Z',
    '2026-11-10T00:00:00Z',
  );

  it('only counts incidents detected in range', () => {
    expect(a.incidentCount).toBe(3);
    expect(a.bySeverity).toEqual({ CRITICAL: 1, HIGH: 1, MEDIUM: 0, LOW: 1 });
  });

  it('MTTA uses acknowledged incidents only and reports the excluded count', () => {
    // a: 60 s, c: 180 s → 120 s; b excluded (never acknowledged)
    expect(a.mtta).toEqual({ meanSeconds: 120, count: 2, excluded: 1 });
  });

  // Blueprint §10.2 test 14: omit unresolved incidents from recovered-only MTTR.
  it('MTTR uses verified recovery only and excludes unresolved incidents', () => {
    // a: 600 s, b: 300 s → 450 s; c excluded (not verified)
    expect(a.mttr).toEqual({ meanSeconds: 450, count: 2, excluded: 1 });
  });

  it('runbook outcomes ignore pending requests and out-of-range incidents', () => {
    expect(a.runbooks).toEqual({ succeeded: 1, failed: 1, rejected: 0, total: 2 });
  });

  it('never reports a mean when there is no data', () => {
    const empty = computeAnalytics([], [], '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
    expect(empty.mtta.meanSeconds).toBeUndefined();
    expect(empty.mttr.meanSeconds).toBeUndefined();
    expect(empty.availability).toBeUndefined();
  });

  it('formats durations', () => {
    expect(formatDuration(38)).toBe('38s');
    expect(formatDuration(249)).toBe('4m 09s');
    expect(formatDuration(3720)).toBe('1h 02m');
  });
});
