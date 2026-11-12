import { useState } from 'react';
import { toast } from 'sonner';

import { describeError } from '@/api/describe-error';
import { canTransition, hasRole, type IncidentCommand } from '@/domain/incident-machine';
import { useIdempotencyKey } from '@/lib/idempotency';
import {
  useAcknowledge,
  useCloseIncident,
  useDecideRemediation,
  useInvestigate,
  useRequestRemediation,
} from '@/modes/data-hooks';
import { useCurrentRole } from '@/modes/session';
import type { Incident, RemediationRequest, Role, Runbook } from '@/types/domain';

export type CommandKind =
  'acknowledge' | 'investigate' | 'request' | 'approve' | 'reject' | 'close';

export const REQUIRED_ROLE: Record<CommandKind, Role> = {
  acknowledge: 'OPERATOR',
  investigate: 'OPERATOR',
  request: 'OPERATOR',
  approve: 'ADMIN',
  reject: 'ADMIN',
  close: 'OPERATOR',
};

export const COMMAND: Record<CommandKind, IncidentCommand> = {
  acknowledge: 'acknowledge',
  investigate: 'investigate',
  request: 'request-remediation',
  approve: 'approve',
  reject: 'reject',
  close: 'close',
};

/** Commands valid in the incident's current state (§4.4), in workflow order. */
export function availableCommands(
  incident: Incident,
  pendingRequest: RemediationRequest | undefined,
): CommandKind[] {
  return (Object.keys(COMMAND) as CommandKind[]).filter(
    (k) =>
      canTransition(incident.state, COMMAND[k]) &&
      (k === 'approve' || k === 'reject' ? Boolean(pendingRequest) : true),
  );
}

export type SuccessMessages = Record<CommandKind, string>;

const DEFAULT_MESSAGES: SuccessMessages = {
  acknowledge: 'Incident acknowledged.',
  investigate: 'Investigation started.',
  request: 'Recovery requested. Waiting for approval.',
  approve: 'Approved. Runbook execution started.',
  reject: 'Request rejected.',
  close: 'Incident closed.',
};

/**
 * Shared command logic for the Advanced and Easy views: one Idempotency-Key per
 * intent, the expected version on every write, errors kept in the dialog, and a
 * success toast only after the data source confirms.
 */
export function useIncidentCommands(
  incident: Incident,
  runbooks: Runbook[],
  pendingRequest: RemediationRequest | undefined,
  messages: SuccessMessages = DEFAULT_MESSAGES,
) {
  const role = useCurrentRole();
  const [open, setOpen] = useState<CommandKind | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [runbookId, setRunbookId] = useState<string>(runbooks[0]?.id ?? '');
  const { key, renew } = useIdempotencyKey();

  const acknowledge = useAcknowledge();
  const investigate = useInvestigate();
  const request = useRequestRemediation();
  const decide = useDecideRemediation();
  const close = useCloseIncident();

  const guard = { expectedVersion: incident.version, idempotencyKey: key };

  function allowed(kind: CommandKind): boolean {
    return role ? hasRole(role, REQUIRED_ROLE[kind]) : false;
  }

  function begin(kind: CommandKind) {
    renew();
    setError(undefined);
    if (kind === 'request') setRunbookId(runbooks[0]?.id ?? '');
    setOpen(kind);
  }

  function cancel() {
    setOpen(undefined);
  }

  async function submit(kind: CommandKind, reason: string) {
    setError(undefined);
    try {
      switch (kind) {
        case 'acknowledge':
          await acknowledge.mutateAsync({ incidentId: incident.id, input: { ...guard, reason } });
          break;
        case 'investigate':
          await investigate.mutateAsync({ incidentId: incident.id, input: guard });
          break;
        case 'request':
          await request.mutateAsync({
            incidentId: incident.id,
            input: { ...guard, runbookId, reason },
          });
          break;
        case 'approve':
        case 'reject':
          if (!pendingRequest) return;
          await decide.mutateAsync({
            requestId: pendingRequest.requestId,
            input: { ...guard, decision: kind === 'approve' ? 'APPROVE' : 'REJECT', reason },
          });
          break;
        case 'close':
          await close.mutateAsync({ incidentId: incident.id, input: guard });
          break;
      }
      toast.success(messages[kind]);
      setOpen(undefined);
    } catch (e) {
      setError(describeError(e).detail);
    }
  }

  return {
    role,
    open,
    error,
    runbookId,
    setRunbookId,
    allowed,
    begin,
    cancel,
    submit,
    available: availableCommands(incident, pendingRequest),
  };
}
