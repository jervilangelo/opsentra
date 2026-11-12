import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { ROLE_LABEL } from '@/types/display';
import type { Incident, RemediationRequest, Runbook } from '@/types/domain';

import { REQUIRED_ROLE, useIncidentCommands, type CommandKind } from './useIncidentCommands';

export interface IncidentActionsProps {
  incident: Incident;
  environment: string;
  runbooks: Runbook[];
  pendingRequest: RemediationRequest | undefined;
}

/**
 * Offers only the transitions valid for the current state (§4.4). Buttons the
 * role cannot use are shown disabled with the required role; the data source
 * enforces both rules regardless. Success is shown only after it confirms.
 */
export function IncidentActions({
  incident,
  environment,
  runbooks,
  pendingRequest,
}: IncidentActionsProps) {
  const { role, open, error, runbookId, setRunbookId, allowed, begin, cancel, submit, available } =
    useIncidentCommands(incident, runbooks, pendingRequest);
  const setOpen = (o: CommandKind | undefined) => (o ? begin(o) : cancel());
  const runbook = runbooks.find((r) => r.id === runbookId);
  const pendingRunbook = pendingRequest
    ? runbooks.find((r) => r.actionKey === pendingRequest.actionKey)
    : undefined;

  const LABEL: Record<CommandKind, string> = {
    acknowledge: 'Acknowledge',
    investigate: 'Start investigation',
    request: incident.state === 'ESCALATED' ? 'Request recovery again' : 'Request recovery',
    approve: 'Approve & execute',
    reject: 'Reject',
    close: 'Close incident',
  };

  if (available.length === 0) {
    const waiting =
      incident.state === 'REMEDIATING' || incident.state === 'VERIFYING'
        ? 'The system is working. No action is needed until it reports back.'
        : 'No further actions for this incident.';
    return <p className="text-sm text-muted-foreground">{waiting}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {available.map((k) => {
          const can = allowed(k);
          return (
            <Button
              key={k}
              variant={
                k === 'reject'
                  ? 'outline'
                  : k === 'approve' || available.length === 1
                    ? 'default'
                    : 'secondary'
              }
              onClick={() => begin(k)}
              disabled={!can}
              aria-describedby={can ? undefined : `role-note-${k}`}
            >
              {LABEL[k]}
            </Button>
          );
        })}
      </div>
      {available
        .filter((k) => !allowed(k))
        .map((k) => (
          <p key={k} id={`role-note-${k}`} className="text-xs text-muted-foreground">
            {LABEL[k]} requires the {ROLE_LABEL[REQUIRED_ROLE[k]]} role
            {role ? ` (you are ${ROLE_LABEL[role]})` : ''}.
          </p>
        ))}

      <ConfirmDialog
        open={open === 'acknowledge'}
        onOpenChange={(o) => !o && setOpen(undefined)}
        action="Acknowledge incident"
        resource={incident.resourceId}
        environment={environment}
        description="You take ownership of this incident. The reason is recorded in the audit trail."
        reasonLabel="Reason"
        error={error}
        onConfirm={(r) => submit('acknowledge', r)}
      />
      <ConfirmDialog
        open={open === 'investigate'}
        onOpenChange={(o) => !o && setOpen(undefined)}
        action="Start investigation"
        resource={incident.resourceId}
        environment={environment}
        description="Marks the incident as under investigation."
        error={error}
        onConfirm={() => submit('investigate', '')}
      />
      <ConfirmDialog
        open={open === 'request'}
        onOpenChange={(o) => !o && setOpen(undefined)}
        action={`Request: ${runbook?.title ?? 'runbook'}`}
        resource={incident.resourceId}
        environment={environment}
        description="Only runbooks allowlisted for this resource are offered. An Administrator must approve before anything runs."
        reasonLabel="Why this runbook"
        error={error}
        onConfirm={(r) => submit('request', r)}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Allowlisted runbook</legend>
          {runbooks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No runbook is allowlisted for this resource.
            </p>
          ) : (
            runbooks.map((rb) => (
              <label key={rb.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                <input
                  type="radio"
                  name="runbook"
                  value={rb.id}
                  checked={runbookId === rb.id}
                  onChange={() => setRunbookId(rb.id)}
                  className="mt-1"
                />
                <span className="flex flex-col">
                  <span className="font-medium">
                    {rb.title}{' '}
                    <span className="font-data text-xs text-muted-foreground">v{rb.version}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{rb.description}</span>
                  <code className="font-data text-xs">{rb.actionKey}</code>
                </span>
              </label>
            ))
          )}
        </fieldset>
      </ConfirmDialog>
      <ConfirmDialog
        open={open === 'approve'}
        onOpenChange={(o) => !o && setOpen(undefined)}
        action={`Approve & execute: ${pendingRunbook?.title ?? pendingRequest?.actionKey ?? 'runbook'}`}
        confirmLabel="Approve & execute"
        resource={incident.resourceId}
        environment={environment}
        description={`Runs ${pendingRequest?.actionKey ?? 'the runbook'} on this resource only. The incident resolves only after independent health checks pass.`}
        reasonLabel="Approval reason"
        error={error}
        onConfirm={(r) => submit('approve', r)}
      />
      <ConfirmDialog
        open={open === 'reject'}
        onOpenChange={(o) => !o && setOpen(undefined)}
        action="Reject recovery request"
        confirmLabel="Reject"
        destructive
        resource={incident.resourceId}
        environment={environment}
        description="Nothing will run. The incident is escalated."
        reasonLabel="Rejection reason"
        error={error}
        onConfirm={(r) => submit('reject', r)}
      />
      <ConfirmDialog
        open={open === 'close'}
        onOpenChange={(o) => !o && setOpen(undefined)}
        action="Close incident"
        resource={incident.resourceId}
        environment={environment}
        description="Closes a verified, resolved incident."
        error={error}
        onConfirm={() => submit('close', '')}
      />
    </div>
  );
}
