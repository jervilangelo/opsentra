import { CircleAlert, CircleCheck, Circle, CircleDot } from 'lucide-react';

import { RECOVERY_STAGES } from '@/domain/incident-machine';
import { cn } from '@/lib/utils';

import { recoveryStatus } from './recovery-status';
import type { Incident, RemediationRequest } from '@/types/domain';

const ICON = { done: CircleCheck, current: CircleDot, failed: CircleAlert, todo: Circle };
const COLOR = {
  done: 'text-status-healthy',
  current: 'text-primary',
  failed: 'text-status-critical',
  todo: 'text-muted-foreground',
};
const SR = { done: 'completed', current: 'in progress', failed: 'failed', todo: 'not started' };

/** Accessible stepper: an ordered list with text status, plus a polite live summary. */
export function RecoveryProgress({
  request,
  incident,
}: {
  request: RemediationRequest;
  incident: Incident;
}) {
  const { stages, summary } = recoveryStatus(request, incident);
  return (
    <div className="flex flex-col gap-3">
      <ol className="grid grid-cols-5 gap-1" aria-label="Recovery progress">
        {RECOVERY_STAGES.map(({ id, label }) => {
          const st = stages[id];
          const Icon = ICON[st];
          return (
            <li
              key={id}
              aria-current={st === 'current' ? 'step' : undefined}
              className="flex flex-col items-center gap-1 text-center"
            >
              <Icon className={cn('size-5', COLOR[st])} aria-hidden="true" />
              <span
                className={cn('text-xs', st === 'todo' ? 'text-muted-foreground' : 'font-medium')}
              >
                {label}
                <span className="sr-only">: {SR[st]}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p role="status" aria-live="polite" className="text-sm">
        {summary}
      </p>
    </div>
  );
}
