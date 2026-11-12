import { hasRole } from '@/domain/incident-machine';
import { REQUIRED_ROLE, type CommandKind } from '@/features/incidents/useIncidentCommands';
import { eventLabel } from '@/features/incidents/event-format';
import { ROLE_LABEL } from '@/types/display';
import type {
  Incident,
  RemediationRequest,
  ResourceType,
  Role,
  Runbook,
  TimelineEvent,
} from '@/types/domain';

/**
 * Plain-language helpers for the Easy view (ADR-013). Pure functions, so every
 * sentence the Easy view shows can be tested. They describe the same data the
 * Advanced view shows; they never invent facts.
 */

const RESOURCE_PLAIN: Record<ResourceType, string> = {
  EC2: 'web server',
  LAMBDA: 'app function',
  APIGW: 'API',
  DYNAMODB: 'database',
  S3: 'file storage',
  SECURITY_GROUP: 'firewall rules',
};

export function plainResource(type: ResourceType | undefined, capital = false): string {
  const name = type ? RESOURCE_PLAIN[type] : 'system';
  return capital ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

/** Why an escalated incident escalated, from the latest recovery request. */
function escalationReason(req: RemediationRequest | undefined): string {
  if (!req) return 'It needs a person to decide what to do next.';
  if (req.status === 'REJECTED') {
    return req.errorSummary === 'Approval expired'
      ? 'Nobody approved the fix in time, so it never ran.'
      : 'The fix was not approved, so it never ran.';
  }
  if (req.status === 'FAILED') return 'The fix failed to run.';
  if (req.status === 'SUCCEEDED') {
    return 'The fix ran, but the checks show it still is not working, so it is not marked fixed.';
  }
  return 'It needs a person to decide what to do next.';
}

/** One sentence: where this incident stands. */
export function plainState(
  incident: Incident,
  type: ResourceType | undefined,
  req?: RemediationRequest,
): string {
  const res = plainResource(type);
  switch (incident.state) {
    case 'OPEN':
      return `The ${res} has a problem. Nobody owns it yet.`;
    case 'ACKNOWLEDGED':
      return 'Someone owns this. Next, look at what the monitors saw.';
    case 'INVESTIGATING':
      return 'Being looked into. Next, ask for a fix.';
    case 'AWAITING_APPROVAL':
      return 'A fix is waiting for an administrator to approve it.';
    case 'REMEDIATING':
      return 'The approved fix is running now.';
    case 'VERIFYING':
      return `The fix ran. Opsentra is checking the ${res} is really back.`;
    case 'RESOLVED':
      return `Fixed and checked. The ${res} is working again.`;
    case 'ESCALATED':
      return `The fix did not work. ${escalationReason(req)}`;
    case 'CLOSED':
      return 'Closed. Nothing left to do.';
  }
}

export type NextStep =
  | {
      type: 'action';
      kind: CommandKind;
      label: string;
      explain: string;
      defaultReason: string;
      allowed: boolean;
      blockedBecause?: string;
      /** A second, quieter choice (only for approvals). */
      secondary?: { kind: CommandKind; label: string; defaultReason: string };
    }
  | { type: 'working'; explain: string }
  | { type: 'done'; explain: string };

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function action(
  kind: CommandKind,
  label: string,
  explain: string,
  defaultReason: string,
  role: Role | undefined,
): Extract<NextStep, { type: 'action' }> {
  const required = REQUIRED_ROLE[kind];
  const allowed = role ? hasRole(role, required) : false;
  return {
    type: 'action',
    kind,
    label,
    explain,
    defaultReason,
    allowed,
    ...(allowed
      ? {}
      : {
          blockedBecause: role
            ? `Only an ${ROLE_LABEL[required].toLowerCase()} can do this. You are viewing as ${ROLE_LABEL[role]}.`
            : 'Sign in to act on incidents.',
        }),
  };
}

/** The single next thing to do, in plain words. */
export function nextStep(
  incident: Incident,
  runbook: Runbook | undefined,
  pending: RemediationRequest | undefined,
  role: Role | undefined,
): NextStep {
  const fix = runbook ? lowerFirst(runbook.title) : 'run the fix';
  switch (incident.state) {
    case 'OPEN':
      return action(
        'acknowledge',
        'Take ownership',
        'Say this problem is yours, so two people do not work on it at once.',
        'I am taking this one.',
        role,
      );
    case 'ACKNOWLEDGED':
      return action(
        'investigate',
        'Look into it',
        'Check what the monitors saw before changing anything.',
        '',
        role,
      );
    case 'INVESTIGATING':
      return action(
        'request',
        `Ask to ${fix}`,
        'A fix only runs after an administrator approves it.',
        `The checks show it is down. Asking to ${fix}.`,
        role,
      );
    case 'ESCALATED':
      return action(
        'request',
        'Try the fix again',
        'You can ask again. It still needs approval before it runs.',
        'Trying the fix again.',
        role,
      );
    case 'AWAITING_APPROVAL': {
      if (!pending) return { type: 'working', explain: 'Waiting for the fix request to arrive.' };
      const step = action(
        'approve',
        'Approve the fix',
        'Approving runs the fix on this one system only. Nothing else is touched.',
        'The fix is safe to run here.',
        role,
      );
      return {
        ...step,
        secondary: { kind: 'reject', label: 'Do not approve', defaultReason: 'Not now.' },
      };
    }
    case 'REMEDIATING':
      return { type: 'working', explain: 'Opsentra is running the fix. This takes a few seconds.' };
    case 'VERIFYING':
      return {
        type: 'working',
        explain: 'Opsentra is checking it really works: it must pass three checks in a row.',
      };
    case 'RESOLVED':
      return action('close', 'Close it', 'Fixed and checked. Close it to finish.', '', role);
    case 'CLOSED':
      return { type: 'done', explain: 'This one is finished.' };
  }
}

export type PathStatus = 'done' | 'current' | 'failed' | 'todo';

export interface PathStep {
  id: 'spotted' | 'owned' | 'approved' | 'ran' | 'checked' | 'resolved';
  label: string;
  status: PathStatus;
  at?: string;
}

/**
 * The recovery path: the incident's journey in six plain steps, built from its
 * own timestamps and its latest recovery request.
 */
export function recoveryPath(incident: Incident, req: RemediationRequest | undefined): PathStep[] {
  const approved = req && req.status !== 'PENDING' && req.status !== 'REJECTED';
  const ran = req?.status === 'SUCCEEDED';
  const escalated = incident.state === 'ESCALATED';
  const steps: PathStep[] = [
    {
      id: 'spotted',
      label: 'Spotted',
      status: 'done',
      ...(incident.detectedAt ? { at: incident.detectedAt } : {}),
    },
    {
      id: 'owned',
      label: 'Owned',
      status: incident.acknowledgedAt ? 'done' : 'todo',
      ...(incident.acknowledgedAt ? { at: incident.acknowledgedAt } : {}),
    },
    {
      id: 'approved',
      label: 'Fix approved',
      status: approved ? 'done' : 'todo',
      ...(req?.decidedAt && approved ? { at: req.decidedAt } : {}),
    },
    {
      id: 'ran',
      label: 'Fix ran',
      status: ran ? 'done' : 'todo',
      ...(ran && req?.completedAt ? { at: req.completedAt } : {}),
    },
    {
      id: 'checked',
      label: 'Checked',
      status: incident.verifiedHealthyAt ? 'done' : 'todo',
      ...(incident.verifiedHealthyAt ? { at: incident.verifiedHealthyAt } : {}),
    },
    {
      id: 'resolved',
      label: 'Resolved',
      status: incident.resolvedAt ? 'done' : 'todo',
      ...(incident.resolvedAt ? { at: incident.resolvedAt } : {}),
    },
  ];
  // A self-healed incident can be checked without a fix: those steps are skipped, not missing.
  if (incident.verifiedHealthyAt && !req) {
    for (const s of steps) if (s.id === 'approved' || s.id === 'ran') s.status = 'done';
  }
  if (escalated) {
    const failedId =
      req?.status === 'REJECTED'
        ? 'approved'
        : req?.status === 'FAILED'
          ? 'ran'
          : req?.status === 'SUCCEEDED'
            ? 'checked'
            : undefined;
    const failed = steps.find((s) => s.id === failedId);
    if (failed) failed.status = 'failed';
    return steps;
  }
  const current = steps.find((s) => s.status === 'todo');
  if (current) current.status = 'current';
  return steps;
}

/** "just now", "4 min ago", "2 h ago", "3 days ago", measured against the data source clock. */
export function ago(iso: string | undefined, nowIso: string | undefined): string {
  if (!iso || !nowIso) return '';
  const sec = Math.round((Date.parse(nowIso) - Date.parse(iso)) / 1000);
  if (sec < 45) return 'just now';
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} min ago`;
  if (sec < 86_400) return `${Math.round(sec / 3600)} h ago`;
  const days = Math.round(sec / 86_400);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** "demo-admin" → "Administrator (demo)". */
export function plainActor(actorId: string | undefined): string {
  if (!actorId) return 'Opsentra';
  const demo: Record<string, string> = {
    'demo-admin': 'Administrator (demo)',
    'demo-operator': 'Operator (demo)',
    'demo-viewer': 'Viewer (demo)',
  };
  return demo[actorId] ?? actorId;
}

const EVENT_PLAIN: Record<string, (who: string) => string> = {
  ALARM_STATE_CHANGED: () => 'The alarm went off',
  INCIDENT_OPENED: () => 'Problem spotted and opened',
  NOTIFICATION_SENT: () => 'The team was emailed',
  HEALTH_PROBE_FAILED: () => 'Health check failed',
  HEALTH_PROBE_PASSED: () => 'Health check passed',
  METRIC_BREACHING: () => 'Errors above the limit',
  METRIC_OK: () => 'Errors back to normal',
  CONFIG_CHANGE_DETECTED: () => 'A risky rule was spotted',
  RECONCILIATION_PASSED: () => 'Rule confirmed removed',
  RECONCILIATION_FAILED: () => 'Rule still there',
  INCIDENT_ACKNOWLEDGED: (w) => `${w} took ownership`,
  INVESTIGATION_STARTED: (w) => `${w} started looking into it`,
  REMEDIATION_REQUESTED: (w) => `${w} asked for a fix`,
  REMEDIATION_APPROVED: (w) => `${w} approved the fix`,
  REMEDIATION_REJECTED: (w) => `${w} did not approve the fix`,
  REMEDIATION_STARTED: () => 'The fix started',
  REMEDIATION_SUCCEEDED: () => 'The fix finished running',
  REMEDIATION_FAILED: () => 'The fix failed',
  VERIFICATION_STARTED: () => 'Checking the fix',
  HEALTH_VERIFIED: () => 'Confirmed working, three checks in a row',
  INCIDENT_RESOLVED: () => 'Marked fixed',
  INCIDENT_ESCALATED: () => 'Escalated: the fix did not work',
  INCIDENT_CLOSED: (w) => `${w} closed it`,
  APPROVAL_EXPIRED: () => 'The approval request expired',
  LAB_FAULT_INJECTED: (w) => `${w} started a practice failure`,
};

/** A plain sentence for a timeline event type or audit action. */
export function plainEvent(type: string, actorId?: string): string {
  const who = plainActor(actorId);
  const f = EVENT_PLAIN[type];
  if (f) return f(who);
  if (type.endsWith('_DENIED')) return `${who} tried something their role does not allow`;
  return eventLabel(type);
}

export interface PlainLine {
  id: string;
  text: string;
  at: string;
  count: number;
}

/** Newest-first plain lines, with repeated signals folded into one line ("×3"). */
export function plainHistory(events: readonly TimelineEvent[], limit: number): PlainLine[] {
  const lines: PlainLine[] = [];
  for (const e of [...events].reverse()) {
    const text = plainEvent(e.eventType, e.actorId);
    const last = lines.at(-1);
    if (last && last.text === text && e.actorType === 'SYSTEM') {
      last.count += 1;
      continue;
    }
    lines.push({ id: e.id, text, at: e.occurredAt, count: 1 });
  }
  return lines.slice(0, limit);
}
