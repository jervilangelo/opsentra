import { incidentPath } from '@/features/navigation/nav';
import type { EngineState } from '@/modes/demo/engine/engine';

export interface GuideStep {
  title: string;
  hint: string;
  done: boolean;
  to?: string;
}

/** Derives walkthrough progress from engine state. Pure, so it is easy to test. */
export function guideSteps(e: EngineState): GuideStep[] {
  const run = e.run;
  const incident = run?.incidentId ? e.incidents.find((i) => i.id === run.incidentId) : undefined;
  const events = incident ? e.timeline.filter((t) => t.incidentId === incident.id) : [];
  const has = (type: string) => events.some((t) => t.eventType === type);
  const req = run?.activeRequestId
    ? e.remediations.find((r) => r.requestId === run.activeRequestId)
    : undefined;
  const at = incident ? incidentPath(incident.id) : undefined;
  const finished =
    incident?.state === 'RESOLVED' || incident?.state === 'CLOSED' || run?.phase === 'done';

  return [
    {
      title: 'Start a failure scenario',
      hint: 'Simulation Lab → Nginx outage. Requires the Administrator role.',
      done: Boolean(run),
      to: '/simulation-lab',
    },
    {
      title: 'Watch detection',
      hint: 'Health probes fail, the alarm fires and one incident opens. Use “Next event” to skip ahead.',
      done: Boolean(incident),
      ...(at ? { to: at } : {}),
    },
    {
      title: 'Acknowledge the incident',
      hint: 'Give a short reason. Operator or Administrator.',
      done: Boolean(incident?.acknowledgedAt),
      ...(at ? { to: at } : {}),
    },
    {
      title: 'Investigate the evidence',
      hint: 'Review the probe results and alarm in the incident evidence.',
      done: has('INVESTIGATION_STARTED'),
      ...(at ? { to: at } : {}),
    },
    {
      title: 'Request recovery',
      hint: 'Choose the allowlisted runbook for this resource.',
      done: Boolean(req),
      ...(at ? { to: at } : {}),
    },
    {
      title: 'Approve as Administrator',
      hint: 'The approval names the resource, environment and action, and needs a reason.',
      done: Boolean(req && req.status !== 'PENDING'),
      ...(at ? { to: at } : {}),
    },
    {
      title: 'Verify recovery',
      hint: 'Resolved only after consecutive health checks pass. Runbook success alone is not enough.',
      done: finished,
      ...(at ? { to: at } : {}),
    },
    {
      title: 'Review the audit trail and analytics',
      hint: 'Every action, approval and system change is recorded.',
      done: false,
      to: '/audit',
    },
  ];
}
