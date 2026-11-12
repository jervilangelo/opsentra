import type { Incident, Role } from '@/types/domain';

import { DEMO_EPOCH, RES } from './catalog';
import {
  advanceTo,
  advanceToNextStep,
  clockRunning,
  createInitialState,
  execute,
  labLock,
  MAX_DEDUPED_SIGNALS,
  type Command,
  type EngineState,
} from './engine';

let keyN = 0;
const key = () => `k-${++keyN}`;
const admin = { id: 'demo-admin', role: 'ADMIN' as Role };
const operator = { id: 'demo-operator', role: 'OPERATOR' as Role };
const viewer = { id: 'demo-viewer', role: 'VIEWER' as Role };

function run(s: EngineState, cmd: Command, actor = admin) {
  const out = execute(s, cmd, actor);
  return out;
}

function ok(s: EngineState, cmd: Command, actor = admin): EngineState {
  const out = execute(s, cmd, actor);
  if (!out.result.ok)
    throw new Error(`${cmd.type} failed: ${out.result.code} ${out.result.message}`);
  return out.state;
}

/** Runs steps until predicate holds (bounded). */
function until(s: EngineState, pred: (s: EngineState) => boolean, max = 50): EngineState {
  let cur = s;
  for (let i = 0; i < max && !pred(cur); i++) cur = advanceToNextStep(cur);
  if (!pred(cur)) throw new Error('condition not reached');
  return cur;
}

const scenarioIncident = (s: EngineState): Incident =>
  s.incidents.find((i) => i.id === s.run?.incidentId)!;

function startAndDetect(scenarioId = 'nginx-outage'): EngineState {
  let s = ok(createInitialState(), {
    type: 'start-lab',
    scenarioId,
    input: { idempotencyKey: key() },
  });
  s = until(s, (x) => Boolean(x.run?.incidentId));
  return s;
}

function toAwaitingApproval(s: EngineState): EngineState {
  let inc = scenarioIncident(s);
  s = ok(
    s,
    {
      type: 'acknowledge',
      incidentId: inc.id,
      input: { reason: 'on it', expectedVersion: inc.version, idempotencyKey: key() },
    },
    operator,
  );
  inc = scenarioIncident(s);
  s = ok(
    s,
    {
      type: 'investigate',
      incidentId: inc.id,
      input: { expectedVersion: inc.version, idempotencyKey: key() },
    },
    operator,
  );
  inc = scenarioIncident(s);
  const runbookId = s.run!.scenarioId.startsWith('nginx')
    ? 'rb-restart-nginx'
    : s.run!.scenarioId === 'lambda-regression'
      ? 'rb-lambda-alias-rollback'
      : 'rb-revoke-injected-rule';
  return ok(
    s,
    {
      type: 'request-remediation',
      incidentId: inc.id,
      input: { runbookId, reason: 'restart', expectedVersion: inc.version, idempotencyKey: key() },
    },
    operator,
  );
}

function approve(s: EngineState): EngineState {
  const inc = scenarioIncident(s);
  return ok(s, {
    type: 'decide-remediation',
    requestId: s.run!.activeRequestId!,
    input: {
      decision: 'APPROVE',
      reason: 'safe runbook',
      expectedVersion: inc.version,
      idempotencyKey: key(),
    },
  });
}

describe('baseline', () => {
  it('is deterministic and starts at the demo epoch', () => {
    const a = createInitialState();
    const b = createInitialState();
    expect(a).toEqual(b);
    expect(new Date(a.clockMs).toISOString()).toBe(new Date(DEMO_EPOCH).toISOString());
    expect(clockRunning(a)).toBe(false);
  });

  it('has only synthetic IDs and no ARNs', () => {
    const s = createInitialState();
    for (const r of s.resources) {
      expect(r.id).toMatch(/demo/);
      expect(r.arn).toBeUndefined();
    }
    for (const i of s.incidents) expect(i.id).toMatch(/^INC-DEMO-/);
  });

  it('every resolved history incident was verified before it resolved', () => {
    for (const i of createInitialState().incidents.filter((x) => x.resolvedAt)) {
      expect(i.verifiedHealthyAt).toBeDefined();
      expect(i.resolvedAt! >= i.verifiedHealthyAt!).toBe(true);
    }
  });
});

describe('Scenario A: detect → investigate → approve → recover', () => {
  it('detects after three failed probes and opens exactly one incident', () => {
    const before = createInitialState().incidents.length;
    const s = startAndDetect();
    const inc = scenarioIncident(s);
    expect(s.incidents).toHaveLength(before + 1);
    expect(inc.state).toBe('OPEN');
    expect(inc.detectedAt! < inc.openedAt).toBe(true);
    expect(s.resources.find((r) => r.id === RES.web)!.health).toBe('UNHEALTHY');
    const types = s.timeline.filter((t) => t.incidentId === inc.id).map((t) => t.eventType);
    expect(types.filter((t) => t === 'HEALTH_PROBE_FAILED')).toHaveLength(3);
    expect(types).toContain('ALARM_STATE_CHANGED');
    expect(types.filter((t) => t === 'NOTIFICATION_SENT')).toHaveLength(1);
  });

  it('repeated signals are deduplicated: no new incident or notification, bounded log', () => {
    let s = startAndDetect();
    const count = s.incidents.length;
    s = advanceTo(s, s.clockMs + 60 * 60 * 1000);
    const inc = scenarioIncident(s);
    expect(s.incidents).toHaveLength(count);
    const events = s.timeline.filter((t) => t.incidentId === inc.id);
    expect(events.filter((t) => t.eventType === 'NOTIFICATION_SENT')).toHaveLength(1);
    expect(events.filter((t) => t.detail.deduplicated === true)).toHaveLength(MAX_DEDUPED_SIGNALS);
  });

  it('resolves only after verification, with verifiedHealthyAt set', () => {
    let s = approve(toAwaitingApproval(startAndDetect()));
    expect(scenarioIncident(s).state).toBe('REMEDIATING');
    s = until(s, (x) => scenarioIncident(x).state === 'VERIFYING');
    const req = s.remediations.find((r) => r.requestId === s.run!.activeRequestId)!;
    expect(req.status).toBe('SUCCEEDED');
    expect(scenarioIncident(s).resolvedAt).toBeUndefined();
    s = until(s, (x) => scenarioIncident(x).state === 'RESOLVED');
    const inc = scenarioIncident(s);
    expect(inc.verifiedHealthyAt).toBeDefined();
    expect(s.resources.find((r) => r.id === RES.web)!.health).toBe('HEALTHY');
    expect(
      s.timeline.filter((t) => t.incidentId === inc.id && t.eventType === 'HEALTH_PROBE_PASSED'),
    ).toHaveLength(3);
    expect(clockRunning(s)).toBe(false);
    expect(labLock(s)).toBeUndefined();
  });

  it('can then be closed by an operator', () => {
    let s = until(
      approve(toAwaitingApproval(startAndDetect())),
      (x) => scenarioIncident(x).state === 'RESOLVED',
    );
    const inc = scenarioIncident(s);
    s = ok(
      s,
      {
        type: 'close',
        incidentId: inc.id,
        input: { expectedVersion: inc.version, idempotencyKey: key() },
      },
      operator,
    );
    expect(scenarioIncident(s).state).toBe('CLOSED');
  });

  it('records every transition in the audit log with the run correlation ID', () => {
    const s = until(
      approve(toAwaitingApproval(startAndDetect())),
      (x) => scenarioIncident(x).state === 'RESOLVED',
    );
    const corr = s.run!.correlationId;
    const actions = s.audit.filter((a) => a.correlationId === corr).map((a) => a.action);
    expect(actions).toEqual([
      'LAB_FAULT_INJECTED',
      'INCIDENT_OPENED',
      'INCIDENT_ACKNOWLEDGED',
      'INVESTIGATION_STARTED',
      'REMEDIATION_REQUESTED',
      'REMEDIATION_APPROVED',
      'REMEDIATION_STARTED',
      'REMEDIATION_SUCCEEDED',
      'VERIFICATION_STARTED',
      'INCIDENT_RESOLVED',
    ]);
  });
});

describe('failure paths (blueprint §6.1 negative tests)', () => {
  it('restart fails → runbook FAILED and incident ESCALATED', () => {
    let s = approve(toAwaitingApproval(startAndDetect('nginx-restart-fails')));
    s = until(s, (x) => x.run!.phase === 'done');
    expect(scenarioIncident(s).state).toBe('ESCALATED');
    expect(s.remediations.find((r) => r.requestId === s.run!.activeRequestId)!.status).toBe(
      'FAILED',
    );
    expect(scenarioIncident(s).resolvedAt).toBeUndefined();
  });

  // Blueprint §10.2 test 7: SSM Success with Nginx still unavailable leaves the incident unresolved.
  it('SSM Success but service still down → ESCALATED, never RESOLVED', () => {
    let s = approve(toAwaitingApproval(startAndDetect('nginx-stays-down')));
    s = until(s, (x) => x.run!.phase === 'done');
    const inc = scenarioIncident(s);
    expect(s.remediations.find((r) => r.requestId === s.run!.activeRequestId)!.status).toBe(
      'SUCCEEDED',
    );
    expect(inc.state).toBe('ESCALATED');
    expect(inc.verifiedHealthyAt).toBeUndefined();
    expect(inc.resolvedAt).toBeUndefined();
    expect(labLock(s)).toMatch(/Reset the demo/);
  });

  it('rejected approval → ESCALATED and nothing executes', () => {
    let s = toAwaitingApproval(startAndDetect());
    const inc = scenarioIncident(s);
    s = ok(s, {
      type: 'decide-remediation',
      requestId: s.run!.activeRequestId!,
      input: {
        decision: 'REJECT',
        reason: 'not safe now',
        expectedVersion: inc.version,
        idempotencyKey: key(),
      },
    });
    expect(scenarioIncident(s).state).toBe('ESCALATED');
    expect(s.queue.some((q) => q.kind === 'ssm-complete')).toBe(false);
  });

  it('an approval left too long expires and cannot execute', () => {
    let s = toAwaitingApproval(startAndDetect());
    s = advanceTo(s, s.clockMs + 2 * 60 * 60 * 1000);
    const inc = scenarioIncident(s);
    expect(inc.state).toBe('ESCALATED');
    const res = run(s, {
      type: 'decide-remediation',
      requestId: s.run!.activeRequestId!,
      input: {
        decision: 'APPROVE',
        reason: 'late',
        expectedVersion: inc.version,
        idempotencyKey: key(),
      },
    });
    expect(res.result).toMatchObject({ ok: false });
  });

  it('Scenarios B and C run end to end', () => {
    for (const id of ['lambda-regression', 'sg-exposure']) {
      const s = until(
        approve(toAwaitingApproval(startAndDetect(id))),
        (x) => x.run!.phase === 'done',
      );
      expect(scenarioIncident(s).state).toBe('RESOLVED');
    }
  });
});

describe('guards', () => {
  // Blueprint §10.2 tests 1 and 2.
  it('a viewer cannot acknowledge and the denial is audited', () => {
    const s = startAndDetect();
    const inc = scenarioIncident(s);
    const res = run(
      s,
      {
        type: 'acknowledge',
        incidentId: inc.id,
        input: { reason: 'x', expectedVersion: inc.version, idempotencyKey: key() },
      },
      viewer,
    );
    expect(res.result).toMatchObject({ ok: false, status: 403 });
    expect(res.state.audit.at(-1)).toMatchObject({ outcome: 'DENIED', actorId: 'demo-viewer' });
    expect(scenarioIncident(res.state).state).toBe('OPEN');
  });

  it('an operator cannot approve remediation or start a lab', () => {
    const s = toAwaitingApproval(startAndDetect());
    const inc = scenarioIncident(s);
    const res = run(
      s,
      {
        type: 'decide-remediation',
        requestId: s.run!.activeRequestId!,
        input: {
          decision: 'APPROVE',
          reason: 'x',
          expectedVersion: inc.version,
          idempotencyKey: key(),
        },
      },
      operator,
    );
    expect(res.result).toMatchObject({ ok: false, status: 403 });
    const lab = run(
      createInitialState(),
      { type: 'start-lab', scenarioId: 'nginx-outage', input: { idempotencyKey: key() } },
      operator,
    );
    expect(lab.result).toMatchObject({ ok: false, status: 403 });
  });

  // Blueprint §10.2 test 6.
  it('a stale expectedVersion returns 409 and changes nothing', () => {
    const s = startAndDetect();
    const inc = scenarioIncident(s);
    const res = run(s, {
      type: 'acknowledge',
      incidentId: inc.id,
      input: { reason: 'x', expectedVersion: inc.version - 1, idempotencyKey: key() },
    });
    expect(res.result).toMatchObject({ ok: false, status: 409, code: 'VERSION_CONFLICT' });
    expect(res.state).toBe(s);
  });

  // Blueprint §10.2 test 5.
  it('a replayed approval returns the original result and never starts a second execution', () => {
    const s0 = toAwaitingApproval(startAndDetect());
    const inc = scenarioIncident(s0);
    const cmd: Command = {
      type: 'decide-remediation',
      requestId: s0.run!.activeRequestId!,
      input: {
        decision: 'APPROVE',
        reason: 'go',
        expectedVersion: inc.version,
        idempotencyKey: 'approve-once',
      },
    };
    const first = execute(s0, cmd, admin);
    const second = execute(first.state, cmd, admin);
    expect(second.result).toEqual(first.result);
    expect(second.state).toBe(first.state);
    expect(first.state.queue.filter((q) => q.kind === 'ssm-complete')).toHaveLength(1);
  });

  it('reusing an idempotency key for a different request is refused', () => {
    const s = startAndDetect();
    const inc = scenarioIncident(s);
    const s1 = ok(s, {
      type: 'acknowledge',
      incidentId: inc.id,
      input: { reason: 'x', expectedVersion: inc.version, idempotencyKey: 'dup' },
    });
    const res = run(s1, {
      type: 'investigate',
      incidentId: inc.id,
      input: { expectedVersion: inc.version + 1, idempotencyKey: 'dup' },
    });
    expect(res.result).toMatchObject({ ok: false, code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  // Blueprint §10.2 test 8 / §5.3 IDOR: only allowlisted runbooks for that resource.
  it('refuses a runbook that is not allowlisted for the resource', () => {
    let s = startAndDetect();
    let inc = scenarioIncident(s);
    s = ok(s, {
      type: 'acknowledge',
      incidentId: inc.id,
      input: { reason: 'x', expectedVersion: inc.version, idempotencyKey: key() },
    });
    inc = scenarioIncident(s);
    const res = run(s, {
      type: 'request-remediation',
      incidentId: inc.id,
      input: {
        runbookId: 'rb-lambda-alias-rollback',
        reason: 'x',
        expectedVersion: inc.version,
        idempotencyKey: key(),
      },
    });
    expect(res.result).toMatchObject({ ok: false, code: 'RUNBOOK_NOT_ALLOWED' });
    const unknown = run(s, {
      type: 'request-remediation',
      incidentId: inc.id,
      input: {
        runbookId: 'rm -rf /',
        reason: 'x',
        expectedVersion: inc.version,
        idempotencyKey: key(),
      },
    });
    expect(unknown.result).toMatchObject({ ok: false, code: 'RUNBOOK_NOT_ALLOWED' });
  });

  it('requires a reason to acknowledge', () => {
    const s = startAndDetect();
    const inc = scenarioIncident(s);
    const res = run(s, {
      type: 'acknowledge',
      incidentId: inc.id,
      input: { reason: '  ', expectedVersion: inc.version, idempotencyKey: key() },
    });
    expect(res.result).toMatchObject({ ok: false, status: 400 });
  });

  it('allows only one active scenario at a time', () => {
    const s = ok(createInitialState(), {
      type: 'start-lab',
      scenarioId: 'nginx-outage',
      input: { idempotencyKey: key() },
    });
    const res = run(s, {
      type: 'start-lab',
      scenarioId: 'lambda-regression',
      input: { idempotencyKey: key() },
    });
    expect(res.result).toMatchObject({ ok: false, status: 409, code: 'SCENARIO_ACTIVE' });
  });
});

describe('determinism', () => {
  it('the same commands at the same simulated times give identical state', () => {
    const play = () =>
      until(approve(toAwaitingApproval(startAndDetect())), (x) => x.run!.phase === 'done');
    keyN = 1000;
    const a = play();
    keyN = 1000;
    const b = play();
    expect(a).toEqual(b);
  });

  it('state survives a JSON round trip (session storage)', () => {
    const s = toAwaitingApproval(startAndDetect());
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
