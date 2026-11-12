import { SkipForward } from 'lucide-react';

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { IncidentStateBadge } from '@/components/status/badges';
import {
  PHASE6_COMMANDS,
  useIncidentCommands,
  type CommandKind,
} from '@/features/incidents/useIncidentCommands';
import { usePreferences } from '@/stores/preferences';
import type {
  Incident,
  RemediationRequest,
  ResourceType,
  Runbook,
  TimelineEvent,
} from '@/types/domain';

import { ago, nextStep, plainHistory, plainResource, plainState, recoveryPath } from './plain';
import { RecoveryPath } from './RecoveryPath';
import { EasyPanel, EasyPrimary, EasyQuiet } from './ui';

const NEEDS_REASON: Record<CommandKind, boolean> = {
  acknowledge: true,
  investigate: false,
  request: true,
  approve: true,
  reject: true,
  close: false,
};

const MESSAGES = {
  acknowledge: 'You own this problem now.',
  investigate: 'Marked as being looked into.',
  request: 'Fix requested. It needs approval before it runs.',
  approve: 'Approved. The fix is running.',
  reject: 'Not approved. Nothing ran.',
  close: 'Closed.',
};

export interface EasyIncidentProps {
  incident: Incident;
  resourceType: ResourceType | undefined;
  environment: string;
  runbooks: Runbook[];
  latest: RemediationRequest | undefined;
  pending: RemediationRequest | undefined;
  events: TimelineEvent[];
  now: string | undefined;
  /** Demo only: jump the simulated clock to the next system event. */
  onSkip?: (() => void) | undefined;
}

/**
 * Easy view of one incident: where it stands in one sentence, the recovery
 * path, and the one thing to do next. Same commands, guards and audit as the
 * Advanced view (useIncidentCommands).
 */
export function EasyIncident({
  incident,
  resourceType,
  environment,
  runbooks,
  latest,
  pending,
  events,
  now,
  onSkip,
}: EasyIncidentProps) {
  const setView = usePreferences((s) => s.setView);
  const cmd = useIncidentCommands(incident, runbooks, pending, MESSAGES);
  const step = nextStep(incident, runbooks[0], pending, cmd.role);
  const history = plainHistory(events, 6);
  const res = plainResource(resourceType);

  const dialog =
    step.type === 'action' && cmd.open
      ? cmd.open === step.kind
        ? { kind: step.kind, label: step.label, reason: step.defaultReason }
        : step.secondary && cmd.open === step.secondary.kind
          ? {
              kind: step.secondary.kind,
              label: step.secondary.label,
              reason: step.secondary.defaultReason,
            }
          : undefined
      : undefined;

  return (
    <div className="flex flex-col gap-5">
      <EasyPanel className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl">{incident.title}</h2>
            <IncidentStateBadge state={incident.state} />
          </div>
          <p className="text-lg" role="status" aria-live="polite">
            {plainState(incident, resourceType, latest)}
          </p>
        </div>

        <RecoveryPath steps={recoveryPath(incident, latest)} now={now} />

        <div className="flex flex-col gap-3 border-t pt-5">
          {step.type === 'action' &&
          cmd.remediationPlannedInLive &&
          PHASE6_COMMANDS.includes(step.kind) ? (
            <p className="text-base">
              The next step is to ask for a fix and approve it. In Live AWS Mode that arrives in
              Phase 6; for now, the problem resolves on its own once Opsentra verifies the system is
              healthy again.
            </p>
          ) : step.type === 'action' ? (
            <>
              <p className="text-base text-muted-foreground">{step.explain}</p>
              <div className="flex flex-wrap items-center gap-2">
                <EasyPrimary onClick={() => cmd.begin(step.kind)} disabled={!step.allowed}>
                  {step.label}
                </EasyPrimary>
                {step.secondary ? (
                  <EasyQuiet
                    onClick={() => step.secondary && cmd.begin(step.secondary.kind)}
                    disabled={!step.allowed}
                  >
                    {step.secondary.label}
                  </EasyQuiet>
                ) : null}
              </div>
              {step.blockedBecause ? <p className="text-sm">{step.blockedBecause}</p> : null}
            </>
          ) : step.type === 'working' ? (
            <>
              <p className="text-base">{step.explain}</p>
              {onSkip ? (
                <div>
                  <EasyPrimary onClick={onSkip}>
                    <SkipForward aria-hidden="true" />
                    Skip ahead
                  </EasyPrimary>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-base">{step.explain}</p>
          )}
        </div>
      </EasyPanel>

      <EasyPanel>
        <h2 className="mb-3 text-base">What happened</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ol className="flex flex-col">
            {history.map((h) => (
              <li
                key={h.id}
                className="flex items-baseline justify-between gap-4 border-b py-2.5 text-base last:border-0"
              >
                <span>
                  {h.text}
                  {h.count > 1 ? (
                    <span className="text-muted-foreground"> · {h.count} times</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-sm text-muted-foreground">{ago(h.at, now)}</span>
              </li>
            ))}
          </ol>
        )}
      </EasyPanel>

      <p className="text-sm text-muted-foreground">
        Want the evidence, IDs and full timeline?{' '}
        <button
          type="button"
          onClick={() => setView('advanced')}
          className="text-link underline underline-offset-4"
        >
          Switch to Advanced view
        </button>
      </p>

      {dialog ? (
        <ConfirmDialog
          key={dialog.kind}
          open
          onOpenChange={(o) => !o && cmd.cancel()}
          action={dialog.label}
          resource={`${plainResource(resourceType, true)} · ${incident.resourceId}`}
          environment={environment}
          description={
            dialog.kind === 'approve'
              ? `This runs the approved fix on this ${res} only. It is marked fixed only after it passes three checks in a row.`
              : dialog.kind === 'reject'
                ? 'Nothing will run. The problem stays open for someone to decide.'
                : 'This is recorded in the activity log.'
          }
          {...(NEEDS_REASON[dialog.kind]
            ? { reasonLabel: 'Note for the log', defaultReason: dialog.reason }
            : {})}
          confirmLabel={dialog.label}
          destructive={dialog.kind === 'reject'}
          error={cmd.error}
          onConfirm={(reason) => cmd.submit(dialog.kind, reason)}
        />
      ) : null}
    </div>
  );
}
