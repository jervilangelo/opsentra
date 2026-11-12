import type { IncidentState, Role } from '@/types/domain';

/**
 * Incident state model from blueprint §4.4.
 *
 *   OPEN → ACKNOWLEDGED → INVESTIGATING → AWAITING_APPROVAL
 *     → REMEDIATING → VERIFYING → RESOLVED → CLOSED
 *   ESCALATED on failure, timeout or denied approval.
 *
 * In Live mode the backend is the authority. The UI uses this only to decide
 * which controls to offer; Demo Mode's engine enforces it as the backend would.
 */

export type IncidentCommand =
  | 'acknowledge'
  | 'investigate'
  | 'request-remediation'
  | 'approve'
  | 'reject'
  | 'execution-started'
  | 'execution-succeeded'
  | 'execution-failed'
  | 'verification-passed'
  | 'verification-failed'
  | 'approval-expired'
  | 'close';

interface Transition {
  from: readonly IncidentState[];
  to: IncidentState;
  /** Minimum role for user commands; undefined for system transitions. */
  role?: Role;
}

export const TRANSITIONS: Record<IncidentCommand, Transition> = {
  acknowledge: { from: ['OPEN'], to: 'ACKNOWLEDGED', role: 'OPERATOR' },
  investigate: { from: ['ACKNOWLEDGED'], to: 'INVESTIGATING', role: 'OPERATOR' },
  'request-remediation': {
    from: ['ACKNOWLEDGED', 'INVESTIGATING', 'ESCALATED'],
    to: 'AWAITING_APPROVAL',
    role: 'OPERATOR',
  },
  approve: { from: ['AWAITING_APPROVAL'], to: 'REMEDIATING', role: 'ADMIN' },
  reject: { from: ['AWAITING_APPROVAL'], to: 'ESCALATED', role: 'ADMIN' },
  'execution-started': { from: ['REMEDIATING'], to: 'REMEDIATING' },
  // SSM "Success" only moves to VERIFYING: it is not recovery.
  'execution-succeeded': { from: ['REMEDIATING'], to: 'VERIFYING' },
  'execution-failed': { from: ['REMEDIATING'], to: 'ESCALATED' },
  'verification-passed': { from: ['VERIFYING'], to: 'RESOLVED' },
  'verification-failed': { from: ['VERIFYING'], to: 'ESCALATED' },
  'approval-expired': { from: ['AWAITING_APPROVAL'], to: 'ESCALATED' },
  close: { from: ['RESOLVED'], to: 'CLOSED', role: 'OPERATOR' },
};

const ROLE_RANK: Record<Role, number> = { VIEWER: 0, OPERATOR: 1, ADMIN: 2 };

export function hasRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function canTransition(state: IncidentState, command: IncidentCommand): boolean {
  return TRANSITIONS[command].from.includes(state);
}

export type TransitionCheck =
  { ok: true; to: IncidentState } | { ok: false; reason: 'INVALID_STATE' | 'FORBIDDEN' };

/** Validates a user command against state and role. */
export function checkCommand(
  state: IncidentState,
  command: IncidentCommand,
  role: Role,
): TransitionCheck {
  const t = TRANSITIONS[command];
  if (t.role && !hasRole(role, t.role)) return { ok: false, reason: 'FORBIDDEN' };
  if (!t.from.includes(state)) return { ok: false, reason: 'INVALID_STATE' };
  return { ok: true, to: t.to };
}

export const TERMINAL_STATES: readonly IncidentState[] = ['RESOLVED', 'CLOSED'];

/** Recovery progress stages shown to users (blueprint §2.3). */
export type RecoveryStage = 'requested' | 'authorized' | 'executing' | 'verifying' | 'outcome';

export const RECOVERY_STAGES: readonly { id: RecoveryStage; label: string }[] = [
  { id: 'requested', label: 'Requested' },
  { id: 'authorized', label: 'Authorized' },
  { id: 'executing', label: 'Executing' },
  { id: 'verifying', label: 'Verifying' },
  { id: 'outcome', label: 'Outcome' },
];
