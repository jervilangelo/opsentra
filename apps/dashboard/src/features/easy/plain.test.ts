import type { Incident, RemediationRequest, Runbook, TimelineEvent } from '@/types/domain';

import { ago, nextStep, plainEvent, plainHistory, plainState, recoveryPath } from './plain';

const base: Incident = {
  id: 'INC-1',
  correlationKey: 'k',
  resourceId: 'i-0demo1',
  title: 'Nginx health check failing',
  severity: 'HIGH',
  state: 'OPEN',
  openedAt: '2026-11-10T03:00:10Z',
  detectedAt: '2026-11-10T03:00:00Z',
  version: 1,
};

const runbook: Runbook = {
  id: 'rb-restart-nginx',
  version: 3,
  title: 'Restart Nginx',
  description: '',
  actionKey: 'Opsentra-Lab-RestartNginx',
  applicableResourceIds: ['i-0demo1'],
  requiresApproval: true,
};

const req = (
  status: RemediationRequest['status'],
  extra: Partial<RemediationRequest> = {},
): RemediationRequest => ({
  requestId: 'REQ-1',
  actionKey: runbook.actionKey,
  incidentId: 'INC-1',
  resourceId: 'i-0demo1',
  requestedBy: 'demo-operator',
  status,
  expectedVersion: 4,
  requestedAt: '2026-11-10T03:05:00Z',
  expiresAt: '2026-11-10T04:05:00Z',
  ...extra,
});

describe('nextStep', () => {
  it.each([
    ['OPEN', 'acknowledge', 'Take ownership'],
    ['ACKNOWLEDGED', 'investigate', 'Look into it'],
    ['INVESTIGATING', 'request', 'Ask to restart Nginx'],
    ['ESCALATED', 'request', 'Try the fix again'],
    ['RESOLVED', 'close', 'Close it'],
  ] as const)('%s → %s (“%s”)', (state, kind, label) => {
    const step = nextStep({ ...base, state }, runbook, undefined, 'ADMIN');
    expect(step).toMatchObject({ type: 'action', kind, label, allowed: true });
  });

  it('offers approve with a quiet reject, only to an administrator', () => {
    const incident = { ...base, state: 'AWAITING_APPROVAL' as const };
    const admin = nextStep(incident, runbook, req('PENDING'), 'ADMIN');
    expect(admin).toMatchObject({ kind: 'approve', allowed: true, secondary: { kind: 'reject' } });
    const op = nextStep(incident, runbook, req('PENDING'), 'OPERATOR');
    expect(op).toMatchObject({ kind: 'approve', allowed: false });
    expect(op.type === 'action' && op.blockedBecause).toMatch(/Only an administrator.*Operator/);
  });

  it('a viewer is told why they cannot act', () => {
    const step = nextStep(base, runbook, undefined, 'VIEWER');
    expect(step).toMatchObject({ allowed: false });
    expect(step.type === 'action' && step.blockedBecause).toMatch(/operator/);
  });

  it('says the system is working while it remediates or verifies', () => {
    expect(nextStep({ ...base, state: 'REMEDIATING' }, runbook, undefined, 'ADMIN').type).toBe(
      'working',
    );
    expect(nextStep({ ...base, state: 'VERIFYING' }, runbook, undefined, 'ADMIN').type).toBe(
      'working',
    );
    expect(nextStep({ ...base, state: 'CLOSED' }, runbook, undefined, 'ADMIN').type).toBe('done');
  });
});

describe('plainState', () => {
  it('names the system in plain words', () => {
    expect(plainState(base, 'EC2')).toBe('The web server has a problem. Nobody owns it yet.');
  });

  it('explains why an incident escalated, without claiming it is fixed', () => {
    const esc = { ...base, state: 'ESCALATED' as const };
    expect(plainState(esc, 'EC2', req('SUCCEEDED'))).toMatch(
      /still is not working, so it is not marked fixed/,
    );
    expect(plainState(esc, 'EC2', req('FAILED'))).toMatch(/failed to run/);
    expect(plainState(esc, 'EC2', req('REJECTED'))).toMatch(/not approved/);
    expect(plainState(esc, 'EC2', req('REJECTED', { errorSummary: 'Approval expired' }))).toMatch(
      /in time/,
    );
  });
});

describe('recoveryPath', () => {
  it('marks the next step on an open incident', () => {
    const path = recoveryPath(base, undefined);
    expect(path.map((p) => p.status)).toEqual(['done', 'current', 'todo', 'todo', 'todo', 'todo']);
  });

  it('is complete for a verified, resolved incident', () => {
    const resolved = {
      ...base,
      state: 'RESOLVED' as const,
      acknowledgedAt: '2026-11-10T03:02:00Z',
      verifiedHealthyAt: '2026-11-10T03:10:00Z',
      resolvedAt: '2026-11-10T03:10:00Z',
    };
    const path = recoveryPath(
      resolved,
      req('SUCCEEDED', { decidedAt: '2026-11-10T03:06:00Z', completedAt: '2026-11-10T03:07:00Z' }),
    );
    expect(path.every((p) => p.status === 'done')).toBe(true);
  });

  it('marks the check as failed when SSM succeeded but the service stayed down', () => {
    const esc = { ...base, state: 'ESCALATED' as const, acknowledgedAt: '2026-11-10T03:02:00Z' };
    const path = recoveryPath(esc, req('SUCCEEDED', { decidedAt: '2026-11-10T03:06:00Z' }));
    expect(path.find((p) => p.id === 'checked')?.status).toBe('failed');
    expect(path.find((p) => p.id === 'resolved')?.status).toBe('todo');
  });

  it('marks the fix as failed when the runbook failed', () => {
    const esc = { ...base, state: 'ESCALATED' as const };
    expect(recoveryPath(esc, req('FAILED')).find((p) => p.id === 'ran')?.status).toBe('failed');
  });
});

describe('words', () => {
  it('formats relative time against the data clock', () => {
    const now = '2026-11-10T03:00:00Z';
    expect(ago('2026-11-10T02:59:50Z', now)).toBe('just now');
    expect(ago('2026-11-10T02:56:00Z', now)).toBe('4 min ago');
    expect(ago('2026-11-10T01:00:00Z', now)).toBe('2 h ago');
    expect(ago('2026-11-09T03:00:00Z', now)).toBe('yesterday');
    expect(ago('2026-11-01T03:00:00Z', now)).toBe('9 days ago');
  });

  it('turns events into sentences with a plain actor', () => {
    expect(plainEvent('REMEDIATION_APPROVED', 'demo-admin')).toBe(
      'Administrator (demo) approved the fix',
    );
    expect(plainEvent('ACKNOWLEDGE_DENIED', 'demo-viewer')).toMatch(/not allow/);
  });

  it('folds repeated system signals into one line', () => {
    const ev = (id: string, eventType: string): TimelineEvent => ({
      id,
      incidentId: 'INC-1',
      occurredAt: `2026-11-10T03:00:0${id}Z`,
      eventType,
      actorType: 'SYSTEM',
      detail: {},
    });
    const lines = plainHistory(
      [
        ev('1', 'HEALTH_PROBE_FAILED'),
        ev('2', 'HEALTH_PROBE_FAILED'),
        ev('3', 'HEALTH_PROBE_FAILED'),
        ev('4', 'INCIDENT_OPENED'),
      ],
      5,
    );
    expect(lines.map((l) => [l.text, l.count])).toEqual([
      ['Problem spotted and opened', 1],
      ['Health check failed', 3],
    ]);
  });
});
