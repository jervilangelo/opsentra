import type {
  AuditEvent,
  Incident,
  IncidentState,
  RemediationRequest,
  RunbookState,
  Severity,
  TimelineEvent,
} from '@/types/domain';

import { DEMO_REGION, RES, runbookById } from './catalog';

/**
 * Deterministic synthetic incident history before the demo epoch, so Analytics
 * and Recovery Center have something to show. Built from a compact spec; every
 * timestamp is derived from fixed offsets.
 */

interface RemediationSpec {
  runbookId: string;
  requestedAfterSec: number;
  decidedAfterSec: number;
  outcome: Extract<RunbookState, 'SUCCEEDED' | 'FAILED' | 'REJECTED'>;
  completedAfterSec?: number;
}

interface HistorySpec {
  id: string;
  title: string;
  resourceId: string;
  severity: Severity;
  alarmName: string;
  detectedAt: string;
  ackAfterSec?: number;
  remediations: RemediationSpec[];
  verifiedAfterSec?: number;
  closed: boolean;
}

const SPECS: HistorySpec[] = [
  {
    id: 'INC-DEMO-0001',
    title: 'Ticketing API Lambda errors after release',
    resourceId: RES.fn,
    severity: 'MEDIUM',
    alarmName: 'demo-ticketing-lambda-errors',
    detectedAt: '2026-11-08T07:02:11Z',
    ackAfterSec: 149,
    remediations: [
      {
        runbookId: 'rb-lambda-alias-rollback',
        requestedAfterSec: 411,
        decidedAfterSec: 576,
        outcome: 'SUCCEEDED',
        completedAfterSec: 619,
      },
    ],
    verifiedAfterSec: 1042,
    closed: true,
  },
  {
    id: 'INC-DEMO-0002',
    title: 'Nginx health check failing on corporate web server',
    resourceId: RES.web,
    severity: 'HIGH',
    alarmName: 'demo-nginx-availability',
    detectedAt: '2026-11-03T22:41:05Z',
    ackAfterSec: 312,
    remediations: [
      {
        runbookId: 'rb-restart-nginx',
        requestedAfterSec: 540,
        decidedAfterSec: 702,
        outcome: 'SUCCEEDED',
        completedAfterSec: 731,
      },
    ],
    verifiedAfterSec: 1260,
    closed: true,
  },
  {
    id: 'INC-DEMO-0003',
    title: 'Nginx health check failing on corporate web server',
    resourceId: RES.web,
    severity: 'HIGH',
    alarmName: 'demo-nginx-availability',
    detectedAt: '2026-10-29T13:15:40Z',
    ackAfterSec: 95,
    remediations: [
      {
        runbookId: 'rb-restart-nginx',
        requestedAfterSec: 380,
        decidedAfterSec: 465,
        outcome: 'FAILED',
        completedAfterSec: 498,
      },
      {
        runbookId: 'rb-restart-nginx',
        requestedAfterSec: 2210,
        decidedAfterSec: 2330,
        outcome: 'SUCCEEDED',
        completedAfterSec: 2362,
      },
    ],
    verifiedAfterSec: 2890,
    closed: true,
  },
  {
    id: 'INC-DEMO-0004',
    title: 'Ticketing table write throttling',
    resourceId: RES.table,
    severity: 'LOW',
    alarmName: 'demo-ticketing-table-throttles',
    detectedAt: '2026-10-24T09:00:00Z',
    remediations: [],
    verifiedAfterSec: 420,
    closed: false,
  },
  {
    id: 'INC-DEMO-0005',
    title: 'SSH open to the internet on lab security group',
    resourceId: RES.sg,
    severity: 'CRITICAL',
    alarmName: 'demo-sg-exposure',
    detectedAt: '2026-10-19T02:12:30Z',
    ackAfterSec: 61,
    remediations: [
      {
        runbookId: 'rb-revoke-injected-rule',
        requestedAfterSec: 190,
        decidedAfterSec: 256,
        outcome: 'SUCCEEDED',
        completedAfterSec: 268,
      },
    ],
    verifiedAfterSec: 540,
    closed: true,
  },
  {
    id: 'INC-DEMO-0006',
    title: 'Ticketing API 5xx responses',
    resourceId: RES.api,
    severity: 'MEDIUM',
    alarmName: 'demo-ticketing-api-5xx',
    detectedAt: '2026-10-12T16:47:00Z',
    ackAfterSec: 205,
    remediations: [
      {
        runbookId: 'rb-lambda-alias-rollback',
        requestedAfterSec: 600,
        decidedAfterSec: 720,
        outcome: 'REJECTED',
      },
    ],
    verifiedAfterSec: 1800,
    closed: true,
  },
];

const addSec = (iso: string, sec: number) => new Date(Date.parse(iso) + sec * 1000).toISOString();

export interface History {
  incidents: Incident[];
  timeline: TimelineEvent[];
  remediations: RemediationRequest[];
  audit: AuditEvent[];
}

export function buildHistory(): History {
  const out: History = { incidents: [], timeline: [], remediations: [], audit: [] };

  SPECS.forEach((spec, idx) => {
    const n = idx + 1;
    const corr = `corr-demo-h${String(n).padStart(3, '0')}`;
    let ev = 0;
    let version = 1;
    const event = (
      sec: number,
      eventType: string,
      actor: string | undefined,
      detail: Record<string, unknown>,
    ) => {
      ev += 1;
      out.timeline.push({
        id: `EVT-DEMO-H${n}${String(ev).padStart(2, '0')}`,
        incidentId: spec.id,
        occurredAt: addSec(spec.detectedAt, sec),
        eventType,
        actorType: actor ? 'USER' : 'SYSTEM',
        ...(actor ? { actorId: actor } : {}),
        detail,
      });
    };
    const audit = (
      sec: number,
      action: string,
      actor: string | undefined,
      targetType: AuditEvent['targetType'],
      targetId: string,
      prev: string | undefined,
      next: string | undefined,
      outcome: AuditEvent['outcome'] = 'SUCCESS',
    ) => {
      out.audit.push({
        id: `AUD-DEMO-H${n}${String(out.audit.length + 1).padStart(3, '0')}`,
        occurredAt: addSec(spec.detectedAt, sec),
        actorType: actor ? 'USER' : 'SYSTEM',
        ...(actor ? { actorId: actor } : {}),
        action,
        targetType,
        targetId,
        correlationId: corr,
        ...(prev ? { previousState: prev } : {}),
        ...(next ? { newState: next } : {}),
        outcome,
        detail: {},
      });
    };

    event(0, 'ALARM_STATE_CHANGED', undefined, { alarm: spec.alarmName, from: 'OK', to: 'ALARM' });
    event(8, 'INCIDENT_OPENED', undefined, { severity: spec.severity });
    audit(8, 'INCIDENT_OPENED', undefined, 'INCIDENT', spec.id, undefined, 'OPEN');
    event(9, 'NOTIFICATION_SENT', undefined, { channel: 'SNS email (simulated)' });

    let state: IncidentState = 'OPEN';
    if (spec.ackAfterSec !== undefined) {
      event(spec.ackAfterSec, 'INCIDENT_ACKNOWLEDGED', 'demo-operator', {
        reason: 'Looking into it',
      });
      audit(
        spec.ackAfterSec,
        'INCIDENT_ACKNOWLEDGED',
        'demo-operator',
        'INCIDENT',
        spec.id,
        state,
        'ACKNOWLEDGED',
      );
      state = 'ACKNOWLEDGED';
      version += 1;
    }

    spec.remediations.forEach((r, ri) => {
      const requestId = `REQ-DEMO-H${n}${ri + 1}`;
      const rb = runbookById(r.runbookId);
      event(r.requestedAfterSec, 'REMEDIATION_REQUESTED', 'demo-operator', {
        requestId,
        runbookId: r.runbookId,
      });
      audit(
        r.requestedAfterSec,
        'REMEDIATION_REQUESTED',
        'demo-operator',
        'REMEDIATION',
        requestId,
        undefined,
        'PENDING',
      );
      const approved = r.outcome !== 'REJECTED';
      event(
        r.decidedAfterSec,
        approved ? 'REMEDIATION_APPROVED' : 'REMEDIATION_REJECTED',
        'demo-admin',
        {
          requestId,
          reason: approved
            ? 'Runbook applies to this resource'
            : 'Root cause is upstream; rollback would not help',
        },
      );
      audit(
        r.decidedAfterSec,
        approved ? 'REMEDIATION_APPROVED' : 'REMEDIATION_REJECTED',
        'demo-admin',
        'REMEDIATION',
        requestId,
        'PENDING',
        approved ? 'APPROVED' : 'REJECTED',
      );
      if (approved && r.completedAfterSec !== undefined) {
        const executionId = `ssm-demo-h${n}${ri + 1}`;
        event(r.decidedAfterSec + 2, 'REMEDIATION_STARTED', undefined, {
          requestId,
          executionId,
          actionKey: rb?.actionKey,
        });
        const ok = r.outcome === 'SUCCEEDED';
        event(r.completedAfterSec, ok ? 'REMEDIATION_SUCCEEDED' : 'REMEDIATION_FAILED', undefined, {
          requestId,
          executionId,
        });
        audit(
          r.completedAfterSec,
          ok ? 'REMEDIATION_SUCCEEDED' : 'REMEDIATION_FAILED',
          undefined,
          'REMEDIATION',
          requestId,
          'RUNNING',
          r.outcome,
          ok ? 'SUCCESS' : 'FAILED',
        );
        if (!ok)
          event(r.completedAfterSec + 1, 'INCIDENT_ESCALATED', undefined, {
            reason: 'Runbook execution failed',
          });
      }
      if (!approved)
        event(r.decidedAfterSec + 1, 'INCIDENT_ESCALATED', undefined, {
          reason: 'Remediation rejected',
        });
      version += 3;
      out.remediations.push({
        requestId,
        actionKey: rb?.actionKey ?? r.runbookId,
        incidentId: spec.id,
        resourceId: spec.resourceId,
        requestedBy: 'demo-operator',
        approvedBy: 'demo-admin',
        status: r.outcome,
        ...(approved ? { executionId: `ssm-demo-h${n}${ri + 1}` } : {}),
        expectedVersion: version,
        ...(r.outcome === 'FAILED'
          ? { errorSummary: 'Command failed on the instance (exit code 1)' }
          : {}),
        requestedAt: addSec(spec.detectedAt, r.requestedAfterSec),
        decidedAt: addSec(spec.detectedAt, r.decidedAfterSec),
        ...(r.completedAfterSec !== undefined
          ? { completedAt: addSec(spec.detectedAt, r.completedAfterSec) }
          : {}),
        expiresAt: addSec(spec.detectedAt, r.requestedAfterSec + 3600),
      });
    });

    if (spec.verifiedAfterSec !== undefined) {
      event(spec.verifiedAfterSec, 'HEALTH_VERIFIED', undefined, { consecutiveHealthyChecks: 3 });
      event(spec.verifiedAfterSec + 1, 'INCIDENT_RESOLVED', undefined, {});
      audit(
        spec.verifiedAfterSec + 1,
        'INCIDENT_RESOLVED',
        undefined,
        'INCIDENT',
        spec.id,
        undefined,
        'RESOLVED',
      );
      state = 'RESOLVED';
      version += 2;
    }
    if (spec.closed) {
      event((spec.verifiedAfterSec ?? 0) + 600, 'INCIDENT_CLOSED', 'demo-operator', {});
      audit(
        (spec.verifiedAfterSec ?? 0) + 600,
        'INCIDENT_CLOSED',
        'demo-operator',
        'INCIDENT',
        spec.id,
        'RESOLVED',
        'CLOSED',
      );
      state = 'CLOSED';
      version += 1;
    }

    const lastRb = spec.remediations.at(-1);
    out.incidents.push({
      id: spec.id,
      correlationKey: `demo:${DEMO_REGION}:${spec.resourceId}:${spec.alarmName}`,
      resourceId: spec.resourceId,
      title: spec.title,
      severity: spec.severity,
      state,
      openedAt: addSec(spec.detectedAt, 8),
      detectedAt: spec.detectedAt,
      ...(spec.ackAfterSec !== undefined
        ? { acknowledgedAt: addSec(spec.detectedAt, spec.ackAfterSec) }
        : {}),
      ...(spec.verifiedAfterSec !== undefined
        ? {
            verifiedHealthyAt: addSec(spec.detectedAt, spec.verifiedAfterSec),
            resolvedAt: addSec(spec.detectedAt, spec.verifiedAfterSec + 1),
          }
        : {}),
      version,
      ...(lastRb ? { runbookId: lastRb.runbookId } : {}),
    });
  });

  return out;
}
