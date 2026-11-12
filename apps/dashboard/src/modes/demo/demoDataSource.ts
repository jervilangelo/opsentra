import type { DataSource } from '@/api/data-source';
import { ApiRequestError } from '@/api/errors';
import { computeAnalytics } from '@/domain/analytics';
import type { ApiSuccess } from '@/types/api';
import {
  ACTIVE_INCIDENT_STATES,
  type Health,
  type LabScenario,
  type OverviewSummary,
  type Severity,
} from '@/types/domain';

import { getEngine, useDemoSession } from './demo-store';
import { RUNBOOKS, SCENARIOS } from './engine/catalog';
import { labLock, type Command, type EngineState } from './engine/engine';

/**
 * Demo Mode data source. Reads and writes only the in-browser demo engine and
 * never calls the network or any AWS endpoint (blueprint §6.4, test case 10).
 * Every payload is tagged `dataset: 'synthetic'`.
 */

function ok<T>(data: T, engine: EngineState, suffix: string): Promise<ApiSuccess<T>> {
  return Promise.resolve({
    // Copies, so a consumer can never mutate engine state.
    data: structuredClone(data),
    meta: {
      dataset: 'synthetic',
      generatedAt: new Date(engine.clockMs).toISOString(),
      requestId: `demo-${suffix}-${engine.revision}`,
    },
  });
}

function fail(status: number, code: string, message: string): Promise<never> {
  return Promise.reject(new ApiRequestError(status, code, message, `demo-${code.toLowerCase()}`));
}

function overview(engine: EngineState): OverviewSummary {
  const healthCounts: Record<Health, number> = {
    HEALTHY: 0,
    DEGRADED: 0,
    UNHEALTHY: 0,
    UNKNOWN: 0,
  };
  for (const r of engine.resources) healthCounts[r.health] += 1;
  const activeBySeverity: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  const active = engine.incidents.filter((i) => ACTIVE_INCIDENT_STATES.includes(i.state));
  for (const i of active) activeBySeverity[i.severity] += 1;
  return {
    monitoredResources: engine.resources.length,
    healthCounts,
    activeIncidents: active.length,
    activeBySeverity,
    lastSyncAt: new Date(engine.clockMs).toISOString(),
  };
}

function labs(engine: EngineState): LabScenario[] {
  const lock = labLock(engine);
  return SCENARIOS.map((s) => ({
    id: s.id,
    group: s.group,
    title: s.title,
    summary: s.summary,
    expectedOutcome: s.expectedOutcome,
    resourceId: s.resourceId,
    runbookId: s.runbookId,
    available: !lock,
    ...(lock ? { unavailableReason: lock } : {}),
  }));
}

/** Runs a command through the engine and maps failures to API errors. */
function command<T>(cmd: Command, read: (engine: EngineState, targetId: string) => T | undefined) {
  const result = useDemoSession.getState().run(cmd);
  if (!result.ok) return fail(result.status, result.code, result.message);
  const engine = getEngine();
  const data = read(engine, result.targetId);
  return data === undefined
    ? fail(500, 'INTERNAL', 'Result not found.')
    : ok(data, engine, cmd.type);
}

const incidentById = (e: EngineState, id: string) => e.incidents.find((i) => i.id === id);
const requestById = (e: EngineState, id: string) => e.remediations.find((r) => r.requestId === id);

export const demoDataSource: DataSource = {
  mode: 'demo',
  getOverview: () => {
    const e = getEngine();
    return ok(overview(e), e, 'overview');
  },
  listResources: () => {
    const e = getEngine();
    return ok(e.resources, e, 'resources');
  },
  listIncidents: () => {
    const e = getEngine();
    const sorted = [...e.incidents].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    return ok(sorted, e, 'incidents');
  },
  getIncident: (incidentId) => {
    const e = getEngine();
    const incident = incidentById(e, incidentId);
    return incident
      ? ok(incident, e, 'incident')
      : fail(404, 'NOT_FOUND', `Incident ${incidentId} was not found.`);
  },
  getTimeline: (incidentId) => {
    const e = getEngine();
    if (!incidentById(e, incidentId)) {
      return fail(404, 'NOT_FOUND', `Incident ${incidentId} was not found.`);
    }
    const events = e.timeline
      .filter((t) => t.incidentId === incidentId)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
    return ok(events, e, 'timeline');
  },
  listRunbooks: () => ok([...RUNBOOKS], getEngine(), 'runbooks'),
  listRemediations: (incidentId) => {
    const e = getEngine();
    const list = e.remediations
      .filter((r) => !incidentId || r.incidentId === incidentId)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    return ok(list, e, 'remediations');
  },
  getAnalytics: ({ from, to }) => {
    const e = getEngine();
    return ok(computeAnalytics(e.incidents, e.remediations, from, to), e, 'analytics');
  },
  listAudit: () => {
    const e = getEngine();
    const list = [...e.audit].sort(
      (a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id),
    );
    return ok(list, e, 'audit');
  },
  listLabs: () => {
    const e = getEngine();
    return ok(labs(e), e, 'labs');
  },

  acknowledgeIncident: (incidentId, input) =>
    command({ type: 'acknowledge', incidentId, input }, incidentById),
  investigateIncident: (incidentId, input) =>
    command({ type: 'investigate', incidentId, input }, incidentById),
  requestRemediation: (incidentId, input) =>
    command({ type: 'request-remediation', incidentId, input }, requestById),
  decideRemediation: (requestId, input) =>
    command({ type: 'decide-remediation', requestId, input }, requestById),
  closeIncident: (incidentId, input) => command({ type: 'close', incidentId, input }, incidentById),
  startLab: (scenarioId, input) =>
    command({ type: 'start-lab', scenarioId, input }, (e, id) => labs(e).find((l) => l.id === id)),
};
