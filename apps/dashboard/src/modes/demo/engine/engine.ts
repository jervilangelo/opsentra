import { checkCommand, type IncidentCommand } from '@/domain/incident-machine';
import type {
  AcknowledgeInput,
  AuditEvent,
  Health,
  Incident,
  IncidentState,
  MutationGuard,
  RemediationDecisionInput,
  RemediationRequest,
  RemediationRequestInput,
  ResourceSummary,
  Role,
  StartLabInput,
  TimelineEvent,
} from '@/types/domain';

import {
  BASELINE_RESOURCES,
  DEMO_EPOCH,
  DEMO_REGION,
  runbookById,
  scenarioById,
  type ScenarioDef,
} from './catalog';
import { buildHistory } from './history';

/**
 * Demo Mode engine: a pure, deterministic simulation of Opsentra's backend.
 *
 * - All state lives in one serialisable object. Functions return a new state.
 * - Time is a simulated clock. Scheduled steps (probes, SSM completion,
 *   verification) fire when the clock reaches them, so the same commands at
 *   the same simulated times always give the same result.
 * - Commands enforce what the real backend will: role checks, the §4.4 state
 *   machine, optimistic versioning (409) and idempotency keys (replays return
 *   the original result and never act twice).
 * - Nothing here touches the network.
 */

export const ENGINE_SCHEMA = 2;
export const APPROVAL_TTL_SEC = 3600;
/** Repeated signals logged on an open incident before the log stops growing. */
export const MAX_DEDUPED_SIGNALS = 8;

export type RunPhase = 'detecting' | 'open' | 'remediating' | 'verifying' | 'done';

interface PendingEvent {
  atMs: number;
  eventType: string;
  detail: Record<string, unknown>;
}

export interface ActiveRun {
  scenarioId: string;
  correlationId: string;
  startedAtMs: number;
  phase: RunPhase;
  incidentId?: string;
  signals: number;
  dedupedSignals: number;
  verifyPasses: number;
  verifyFails: number;
  activeRequestId?: string;
  pending: PendingEvent[];
}

export type Step =
  | { atMs: number; kind: 'signal' }
  | { atMs: number; kind: 'ingest' }
  | { atMs: number; kind: 'ssm-complete'; requestId: string }
  | { atMs: number; kind: 'verify'; requestId: string }
  | { atMs: number; kind: 'expire'; requestId: string };

interface IdempotencyRecord {
  fingerprint: string;
  result: CommandResult;
}

export interface EngineState {
  schema: number;
  clockMs: number;
  seq: number;
  /** Increments on every data change (not on clock-only ticks). */
  revision: number;
  resources: ResourceSummary[];
  incidents: Incident[];
  timeline: TimelineEvent[];
  audit: AuditEvent[];
  remediations: RemediationRequest[];
  run?: ActiveRun;
  queue: Step[];
  idempotency: Record<string, IdempotencyRecord>;
}

export type CommandResult =
  { ok: true; targetId: string } | { ok: false; status: number; code: string; message: string };

export type Command =
  | { type: 'acknowledge'; incidentId: string; input: AcknowledgeInput }
  | { type: 'investigate'; incidentId: string; input: MutationGuard }
  | { type: 'request-remediation'; incidentId: string; input: RemediationRequestInput }
  | { type: 'decide-remediation'; requestId: string; input: RemediationDecisionInput }
  | { type: 'close'; incidentId: string; input: MutationGuard }
  | { type: 'start-lab'; scenarioId: string; input: StartLabInput };

export interface Actor {
  id: string;
  role: Role;
}

// ---------------------------------------------------------------------------
// Helpers

const iso = (ms: number) => new Date(ms).toISOString();
const pad = (n: number, w = 4) => String(n).padStart(w, '0');

function nextId(s: EngineState, prefix: string): string {
  s.seq += 1;
  return `${prefix}-${pad(s.seq)}`;
}

function err(status: number, code: string, message: string): CommandResult {
  return { ok: false, status, code, message };
}

function findIncident(s: EngineState, id: string): Incident | undefined {
  return s.incidents.find((i) => i.id === id);
}

function setHealth(s: EngineState, resourceId: string, health: Health): void {
  const r = s.resources.find((x) => x.id === resourceId);
  if (r) {
    r.health = health;
    r.lastCheckedAt = iso(s.clockMs);
  }
}

function pushTimeline(
  s: EngineState,
  incidentId: string,
  eventType: string,
  detail: Record<string, unknown>,
  actor?: Actor,
  atMs = s.clockMs,
): void {
  s.timeline.push({
    id: nextId(s, 'EVT-DEMO'),
    incidentId,
    occurredAt: iso(atMs),
    eventType,
    actorType: actor ? 'USER' : 'SYSTEM',
    ...(actor ? { actorId: actor.id } : {}),
    detail,
  });
}

function pushAudit(
  s: EngineState,
  e: Omit<AuditEvent, 'id' | 'occurredAt' | 'actorType' | 'actorId'>,
  actor?: Actor,
): void {
  s.audit.push({
    id: nextId(s, 'AUD-DEMO'),
    occurredAt: iso(s.clockMs),
    actorType: actor ? 'USER' : 'SYSTEM',
    ...(actor ? { actorId: actor.id } : {}),
    ...e,
  });
}

function transition(
  s: EngineState,
  incident: Incident,
  to: IncidentState,
  action: string,
  actor?: Actor,
  detail: Record<string, unknown> = {},
): void {
  const from = incident.state;
  incident.state = to;
  incident.version += 1;
  pushAudit(
    s,
    {
      action,
      targetType: 'INCIDENT',
      targetId: incident.id,
      correlationId: s.run?.correlationId ?? incident.correlationKey,
      previousState: from,
      newState: to,
      outcome: 'SUCCESS',
      detail,
    },
    actor,
  );
}

function schedule(s: EngineState, step: Step): void {
  s.queue.push(step);
  s.queue.sort((a, b) => a.atMs - b.atMs);
}

function currentScenario(s: EngineState): ScenarioDef | undefined {
  return s.run ? scenarioById(s.run.scenarioId) : undefined;
}

// ---------------------------------------------------------------------------
// Initial state

export function createInitialState(): EngineState {
  const h = buildHistory();
  return {
    schema: ENGINE_SCHEMA,
    clockMs: Date.parse(DEMO_EPOCH),
    seq: 100,
    revision: 1,
    resources: BASELINE_RESOURCES.map((r) => ({ ...r })),
    incidents: h.incidents,
    timeline: h.timeline,
    audit: h.audit,
    remediations: h.remediations,
    queue: [],
    idempotency: {},
  };
}

// ---------------------------------------------------------------------------
// Lab availability (one-active-scenario lock)

export function labLock(s: EngineState): string | undefined {
  const run = s.run;
  if (!run) return undefined;
  if (run.phase !== 'done') return 'Another scenario is in progress.';
  const inc = run.incidentId ? findIncident(s, run.incidentId) : undefined;
  if (inc && (inc.state === 'RESOLVED' || inc.state === 'CLOSED')) return undefined;
  return 'The last scenario ended escalated. Reset the demo to run another.';
}

/** True while simulated time should advance. */
export function clockRunning(s: EngineState): boolean {
  return Boolean(s.run && s.run.phase !== 'done');
}

// ---------------------------------------------------------------------------
// Commands

function guardIncident(
  s: EngineState,
  incidentId: string,
  command: IncidentCommand,
  guard: MutationGuard,
  actor: Actor,
): { incident: Incident; to: IncidentState } | CommandResult {
  const incident = findIncident(s, incidentId);
  if (!incident) return err(404, 'NOT_FOUND', `Incident ${incidentId} was not found.`);
  const check = checkCommand(incident.state, command, actor.role);
  if (!check.ok && check.reason === 'FORBIDDEN') {
    pushAudit(
      s,
      {
        action: `${command.toUpperCase().replace(/-/g, '_')}_DENIED`,
        targetType: 'INCIDENT',
        targetId: incident.id,
        correlationId: s.run?.correlationId ?? incident.correlationKey,
        outcome: 'DENIED',
        detail: { role: actor.role },
      },
      actor,
    );
    s.revision += 1;
    return err(403, 'FORBIDDEN', `Your role (${actor.role}) cannot do this.`);
  }
  if (guard.expectedVersion !== incident.version) {
    return err(
      409,
      'VERSION_CONFLICT',
      'The incident changed since you loaded it. Refresh and try again.',
    );
  }
  if (!check.ok) {
    return err(409, 'INVALID_STATE', `Not allowed while the incident is ${incident.state}.`);
  }
  return { incident, to: check.to };
}

const isResult = (x: unknown): x is CommandResult =>
  typeof x === 'object' && x !== null && 'ok' in x;

function apply(s: EngineState, cmd: Command, actor: Actor): CommandResult {
  switch (cmd.type) {
    case 'acknowledge': {
      if (!cmd.input.reason.trim()) return err(400, 'VALIDATION', 'A reason is required.');
      const g = guardIncident(s, cmd.incidentId, 'acknowledge', cmd.input, actor);
      if (isResult(g)) return g;
      g.incident.acknowledgedAt = iso(s.clockMs);
      transition(s, g.incident, g.to, 'INCIDENT_ACKNOWLEDGED', actor, { reason: cmd.input.reason });
      pushTimeline(s, g.incident.id, 'INCIDENT_ACKNOWLEDGED', { reason: cmd.input.reason }, actor);
      return { ok: true, targetId: g.incident.id };
    }
    case 'investigate': {
      const g = guardIncident(s, cmd.incidentId, 'investigate', cmd.input, actor);
      if (isResult(g)) return g;
      transition(s, g.incident, g.to, 'INVESTIGATION_STARTED', actor);
      pushTimeline(s, g.incident.id, 'INVESTIGATION_STARTED', {}, actor);
      return { ok: true, targetId: g.incident.id };
    }
    case 'request-remediation': {
      if (!cmd.input.reason.trim()) return err(400, 'VALIDATION', 'A reason is required.');
      const g = guardIncident(s, cmd.incidentId, 'request-remediation', cmd.input, actor);
      if (isResult(g)) return g;
      const runbook = runbookById(cmd.input.runbookId);
      // Server-owned allowlist: unknown runbooks or other resources are refused.
      if (!runbook || !runbook.applicableResourceIds.includes(g.incident.resourceId)) {
        return err(
          400,
          'RUNBOOK_NOT_ALLOWED',
          'That runbook is not allowlisted for this resource.',
        );
      }
      const requestId = nextId(s, 'REQ-DEMO');
      const expiresAtMs = s.clockMs + APPROVAL_TTL_SEC * 1000;
      s.remediations.push({
        requestId,
        actionKey: runbook.actionKey,
        incidentId: g.incident.id,
        resourceId: g.incident.resourceId,
        requestedBy: actor.id,
        status: 'PENDING',
        expectedVersion: g.incident.version + 1,
        requestedAt: iso(s.clockMs),
        expiresAt: iso(expiresAtMs),
      });
      g.incident.runbookId = runbook.id;
      transition(s, g.incident, g.to, 'REMEDIATION_REQUESTED', actor, {
        requestId,
        runbookId: runbook.id,
      });
      pushTimeline(
        s,
        g.incident.id,
        'REMEDIATION_REQUESTED',
        { requestId, runbookId: runbook.id, reason: cmd.input.reason },
        actor,
      );
      if (s.run?.incidentId === g.incident.id) s.run.activeRequestId = requestId;
      schedule(s, { atMs: expiresAtMs, kind: 'expire', requestId });
      return { ok: true, targetId: requestId };
    }
    case 'decide-remediation': {
      if (!cmd.input.reason.trim()) return err(400, 'VALIDATION', 'A reason is required.');
      const req = s.remediations.find((r) => r.requestId === cmd.requestId);
      if (!req) return err(404, 'NOT_FOUND', `Request ${cmd.requestId} was not found.`);
      const command = cmd.input.decision === 'APPROVE' ? 'approve' : 'reject';
      const g = guardIncident(s, req.incidentId, command, cmd.input, actor);
      if (isResult(g)) return g;
      if (req.status !== 'PENDING') {
        return err(409, 'INVALID_STATE', `The request is already ${req.status}.`);
      }
      if (s.clockMs > Date.parse(req.expiresAt)) {
        return err(409, 'APPROVAL_EXPIRED', 'This approval request has expired.');
      }
      req.approvedBy = actor.id;
      req.decidedAt = iso(s.clockMs);
      s.queue = s.queue.filter((q) => !(q.kind === 'expire' && q.requestId === req.requestId));
      if (cmd.input.decision === 'REJECT') {
        req.status = 'REJECTED';
        pushAudit(
          s,
          {
            action: 'REMEDIATION_REJECTED',
            targetType: 'REMEDIATION',
            targetId: req.requestId,
            correlationId: s.run?.correlationId ?? g.incident.correlationKey,
            previousState: 'PENDING',
            newState: 'REJECTED',
            outcome: 'SUCCESS',
            detail: { reason: cmd.input.reason },
          },
          actor,
        );
        pushTimeline(
          s,
          g.incident.id,
          'REMEDIATION_REJECTED',
          { requestId: req.requestId, reason: cmd.input.reason },
          actor,
        );
        transition(s, g.incident, 'ESCALATED', 'INCIDENT_ESCALATED', undefined, {
          reason: 'Remediation rejected',
        });
        pushTimeline(s, g.incident.id, 'INCIDENT_ESCALATED', { reason: 'Remediation rejected' });
        if (s.run?.incidentId === g.incident.id) s.run.phase = 'open';
        return { ok: true, targetId: req.requestId };
      }
      // Approve and dispatch: the fixed SSM document runs on the allowlisted resource.
      req.status = 'RUNNING';
      req.executionId = nextId(s, 'ssm-demo');
      pushAudit(
        s,
        {
          action: 'REMEDIATION_APPROVED',
          targetType: 'REMEDIATION',
          targetId: req.requestId,
          correlationId: s.run?.correlationId ?? g.incident.correlationKey,
          previousState: 'PENDING',
          newState: 'RUNNING',
          outcome: 'SUCCESS',
          detail: { reason: cmd.input.reason, executionId: req.executionId },
        },
        actor,
      );
      pushTimeline(
        s,
        g.incident.id,
        'REMEDIATION_APPROVED',
        { requestId: req.requestId, reason: cmd.input.reason },
        actor,
      );
      transition(s, g.incident, 'REMEDIATING', 'REMEDIATION_STARTED');
      pushTimeline(s, g.incident.id, 'REMEDIATION_STARTED', {
        requestId: req.requestId,
        executionId: req.executionId,
        actionKey: req.actionKey,
      });
      const scenario = currentScenario(s);
      if (s.run && scenario && s.run.incidentId === g.incident.id) {
        s.run.phase = 'remediating';
        s.run.activeRequestId = req.requestId;
        s.run.verifyPasses = 0;
        s.run.verifyFails = 0;
        s.queue = s.queue.filter((q) => q.kind !== 'signal');
        schedule(s, {
          atMs: s.clockMs + scenario.execution.durationSec * 1000,
          kind: 'ssm-complete',
          requestId: req.requestId,
        });
      } else {
        // Not part of a running scenario (should not happen in the demo): fail safe.
        schedule(s, { atMs: s.clockMs + 15_000, kind: 'ssm-complete', requestId: req.requestId });
      }
      return { ok: true, targetId: req.requestId };
    }
    case 'close': {
      const g = guardIncident(s, cmd.incidentId, 'close', cmd.input, actor);
      if (isResult(g)) return g;
      transition(s, g.incident, g.to, 'INCIDENT_CLOSED', actor);
      pushTimeline(s, g.incident.id, 'INCIDENT_CLOSED', {}, actor);
      return { ok: true, targetId: g.incident.id };
    }
    case 'start-lab': {
      const scenario = scenarioById(cmd.scenarioId);
      if (!scenario) return err(404, 'NOT_FOUND', `Scenario ${cmd.scenarioId} was not found.`);
      if (actor.role !== 'ADMIN') {
        pushAudit(
          s,
          {
            action: 'LAB_START_DENIED',
            targetType: 'LAB',
            targetId: scenario.id,
            correlationId: 'none',
            outcome: 'DENIED',
            detail: { role: actor.role },
          },
          actor,
        );
        s.revision += 1;
        return err(403, 'FORBIDDEN', 'Only an Administrator can start a lab scenario.');
      }
      const lock = labLock(s);
      if (lock) return err(409, 'SCENARIO_ACTIVE', lock);
      const correlationId = nextId(s, 'corr-demo');
      s.run = {
        scenarioId: scenario.id,
        correlationId,
        startedAtMs: s.clockMs,
        phase: 'detecting',
        signals: 0,
        dedupedSignals: 0,
        verifyPasses: 0,
        verifyFails: 0,
        pending: [],
      };
      s.queue = [];
      pushAudit(
        s,
        {
          action: 'LAB_FAULT_INJECTED',
          targetType: 'LAB',
          targetId: scenario.id,
          correlationId,
          outcome: 'SUCCESS',
          detail: { resourceId: scenario.resourceId, action: scenario.faultAction },
        },
        actor,
      );
      schedule(s, { atMs: s.clockMs + scenario.detection.firstDelaySec * 1000, kind: 'signal' });
      return { ok: true, targetId: scenario.id };
    }
  }
}

function fingerprint(cmd: Command): string {
  const target =
    'incidentId' in cmd ? cmd.incidentId : 'requestId' in cmd ? cmd.requestId : cmd.scenarioId;
  return `${cmd.type}:${target}`;
}

/**
 * Runs a user command. Returns the next state and the result. A replay with the
 * same idempotency key returns the stored result and changes nothing.
 */
export function execute(
  prev: EngineState,
  cmd: Command,
  actor: Actor,
): { state: EngineState; result: CommandResult } {
  const key = cmd.input.idempotencyKey;
  if (!key) {
    return {
      state: prev,
      result: err(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required.'),
    };
  }
  const seen = prev.idempotency[key];
  if (seen) {
    if (seen.fingerprint !== fingerprint(cmd)) {
      return {
        state: prev,
        result: err(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was used for a different request.',
        ),
      };
    }
    return { state: prev, result: seen.result };
  }
  const s = structuredClone(prev);
  const result = apply(s, cmd, actor);
  if (result.ok) {
    s.idempotency[key] = { fingerprint: fingerprint(cmd), result };
    s.revision += 1;
    return { state: s, result };
  }
  // Failed commands change nothing except a recorded denial.
  return { state: s.revision !== prev.revision ? s : prev, result };
}

// ---------------------------------------------------------------------------
// Simulated time

function openIncident(s: EngineState, run: ActiveRun, scenario: ScenarioDef): void {
  const id = nextId(s, 'INC-DEMO');
  const detectedAtMs =
    run.pending.find((p) => p.eventType === 'ALARM_STATE_CHANGED')?.atMs ?? s.clockMs;
  const incident: Incident = {
    id,
    correlationKey: `demo:${DEMO_REGION}:${scenario.resourceId}:${scenario.correlationSuffix}`,
    resourceId: scenario.resourceId,
    title: scenario.incidentTitle,
    severity: scenario.severity,
    state: 'OPEN',
    openedAt: iso(s.clockMs),
    detectedAt: iso(detectedAtMs),
    version: 1,
  };
  s.incidents.push(incident);
  run.incidentId = id;
  run.phase = 'open';
  for (const p of run.pending) pushTimeline(s, id, p.eventType, p.detail, undefined, p.atMs);
  run.pending = [];
  pushTimeline(s, id, 'INCIDENT_OPENED', {
    severity: scenario.severity,
    correlationId: run.correlationId,
  });
  pushAudit(s, {
    action: 'INCIDENT_OPENED',
    targetType: 'INCIDENT',
    targetId: id,
    correlationId: run.correlationId,
    newState: 'OPEN',
    outcome: 'SUCCESS',
    detail: { alarm: scenario.alarmName },
  });
  pushTimeline(s, id, 'NOTIFICATION_SENT', { channel: 'SNS email (simulated)' });
}

function runStep(s: EngineState, step: Step): void {
  const run = s.run;
  const scenario = currentScenario(s);
  if (!run || !scenario) return;
  const incident = run.incidentId ? findIncident(s, run.incidentId) : undefined;

  switch (step.kind) {
    case 'signal': {
      if (run.phase !== 'detecting' && run.phase !== 'open') return;
      run.signals += 1;
      const { signal, failuresToAlarm, intervalSec, ingestDelaySec } = scenario.detection;
      const detail = signal.detail(run.signals);
      if (!incident) {
        run.pending.push({ atMs: s.clockMs, eventType: signal.eventType, detail });
        setHealth(
          s,
          scenario.resourceId,
          run.signals >= failuresToAlarm ? 'UNHEALTHY' : 'DEGRADED',
        );
        if (run.signals === failuresToAlarm) {
          run.pending.push({
            atMs: s.clockMs,
            eventType: 'ALARM_STATE_CHANGED',
            detail: { alarm: scenario.alarmName, from: 'OK', to: 'ALARM' },
          });
          schedule(s, { atMs: s.clockMs + ingestDelaySec * 1000, kind: 'ingest' });
        }
      } else {
        // Duplicate signal for an existing incident: evidence only, no new
        // incident and no new notification.
        run.dedupedSignals += 1;
        setHealth(s, scenario.resourceId, 'UNHEALTHY');
        pushTimeline(s, incident.id, signal.eventType, { ...detail, deduplicated: true });
      }
      if (run.dedupedSignals < MAX_DEDUPED_SIGNALS) {
        schedule(s, { atMs: s.clockMs + intervalSec * 1000, kind: 'signal' });
      }
      return;
    }
    case 'ingest': {
      if (!incident) openIncident(s, run, scenario);
      return;
    }
    case 'ssm-complete': {
      const req = s.remediations.find((r) => r.requestId === step.requestId);
      if (!req || !incident || req.status !== 'RUNNING') return;
      req.completedAt = iso(s.clockMs);
      if (scenario.execution.succeeds) {
        req.status = 'SUCCEEDED';
        pushAudit(s, {
          action: 'REMEDIATION_SUCCEEDED',
          targetType: 'REMEDIATION',
          targetId: req.requestId,
          correlationId: run.correlationId,
          previousState: 'RUNNING',
          newState: 'SUCCEEDED',
          outcome: 'SUCCESS',
          detail: { executionId: req.executionId },
        });
        pushTimeline(s, incident.id, 'REMEDIATION_SUCCEEDED', {
          requestId: req.requestId,
          executionId: req.executionId,
          note: 'SSM reported Success. This is not recovery until health checks pass.',
        });
        transition(s, incident, 'VERIFYING', 'VERIFICATION_STARTED');
        run.phase = 'verifying';
        schedule(s, {
          atMs: s.clockMs + scenario.verification.intervalSec * 1000,
          kind: 'verify',
          requestId: req.requestId,
        });
      } else {
        req.status = 'FAILED';
        req.errorSummary = 'Command failed on the instance (exit code 1)';
        pushAudit(s, {
          action: 'REMEDIATION_FAILED',
          targetType: 'REMEDIATION',
          targetId: req.requestId,
          correlationId: run.correlationId,
          previousState: 'RUNNING',
          newState: 'FAILED',
          outcome: 'FAILED',
          detail: { executionId: req.executionId },
        });
        pushTimeline(s, incident.id, 'REMEDIATION_FAILED', {
          requestId: req.requestId,
          executionId: req.executionId,
          error: req.errorSummary,
        });
        transition(s, incident, 'ESCALATED', 'INCIDENT_ESCALATED', undefined, {
          reason: 'Runbook execution failed',
        });
        pushTimeline(s, incident.id, 'INCIDENT_ESCALATED', { reason: 'Runbook execution failed' });
        run.phase = 'done';
      }
      return;
    }
    case 'verify': {
      if (!incident || incident.state !== 'VERIFYING') return;
      const v = scenario.verification;
      if (v.recovers) {
        run.verifyPasses += 1;
        pushTimeline(s, incident.id, v.pass.eventType, v.pass.detail(run.verifyPasses));
        setHealth(s, scenario.resourceId, run.verifyPasses >= v.required ? 'HEALTHY' : 'DEGRADED');
        if (run.verifyPasses >= v.required) {
          incident.verifiedHealthyAt = iso(s.clockMs);
          pushTimeline(s, incident.id, 'HEALTH_VERIFIED', {
            consecutiveHealthyChecks: run.verifyPasses,
          });
          incident.resolvedAt = iso(s.clockMs);
          transition(s, incident, 'RESOLVED', 'INCIDENT_RESOLVED');
          pushTimeline(s, incident.id, 'INCIDENT_RESOLVED', {});
          run.phase = 'done';
          return;
        }
      } else {
        run.verifyFails += 1;
        pushTimeline(s, incident.id, v.fail.eventType, v.fail.detail(run.verifyFails));
        setHealth(s, scenario.resourceId, 'UNHEALTHY');
        if (run.verifyFails >= v.required) {
          const reason = `SSM reported Success, but ${run.verifyFails} consecutive health checks failed`;
          transition(s, incident, 'ESCALATED', 'INCIDENT_ESCALATED', undefined, { reason });
          pushTimeline(s, incident.id, 'INCIDENT_ESCALATED', { reason });
          run.phase = 'done';
          return;
        }
      }
      schedule(s, {
        atMs: s.clockMs + v.intervalSec * 1000,
        kind: 'verify',
        requestId: step.requestId,
      });
      return;
    }
    case 'expire': {
      const req = s.remediations.find((r) => r.requestId === step.requestId);
      if (!req || req.status !== 'PENDING' || !incident) return;
      req.status = 'REJECTED';
      req.errorSummary = 'Approval expired';
      pushAudit(s, {
        action: 'APPROVAL_EXPIRED',
        targetType: 'REMEDIATION',
        targetId: req.requestId,
        correlationId: run.correlationId,
        previousState: 'PENDING',
        newState: 'REJECTED',
        outcome: 'FAILED',
        detail: {},
      });
      pushTimeline(s, incident.id, 'APPROVAL_EXPIRED', { requestId: req.requestId });
      transition(s, incident, 'ESCALATED', 'INCIDENT_ESCALATED', undefined, {
        reason: 'Approval expired',
      });
      pushTimeline(s, incident.id, 'INCIDENT_ESCALATED', { reason: 'Approval expired' });
      run.phase = 'open';
      return;
    }
  }
}

/** Advances simulated time to `targetMs`, running every step that falls due. */
export function advanceTo(prev: EngineState, targetMs: number): EngineState {
  if (targetMs <= prev.clockMs) return prev;
  const s = structuredClone(prev);
  let changed = false;
  for (let step = s.queue[0]; step && step.atMs <= targetMs; step = s.queue[0]) {
    s.queue.shift();
    s.clockMs = Math.max(s.clockMs, step.atMs);
    runStep(s, step);
    changed = true;
  }
  s.clockMs = targetMs;
  if (changed) s.revision += 1;
  return s;
}

/** Jumps to the next scheduled step, if any. */
export function advanceToNextStep(prev: EngineState): EngineState {
  const next = prev.queue[0];
  return next ? advanceTo(prev, next.atMs) : prev;
}
