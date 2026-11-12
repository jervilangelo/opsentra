import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

import { ago, type PathStep } from './plain';

const SR: Record<PathStep['status'], string> = {
  done: 'done',
  current: 'next',
  failed: 'did not work',
  todo: 'not yet',
};

/**
 * The recovery path, Easy view's signature element: the incident's own journey
 * from spotted to resolved. Shape carries the state (solid = done, ring = next,
 * hollow = later, cross = failed) and Signal, the one data hue, marks what has
 * happened. A failed step is critical red with a cross, never colour alone.
 */
export function RecoveryPath({ steps, now }: { steps: PathStep[]; now: string | undefined }) {
  return (
    <ol aria-label="Recovery path" className="grid grid-cols-1 gap-3 sm:grid-cols-6 sm:gap-0">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const next = steps[i + 1];
        return (
          <li
            key={s.id}
            aria-current={s.status === 'current' ? 'step' : undefined}
            className="relative flex items-center gap-3 sm:flex-col sm:items-start sm:gap-2"
          >
            <div className="flex h-5 items-center sm:w-full">
              {s.status === 'failed' ? (
                <X
                  className="size-5 shrink-0 text-status-critical"
                  strokeWidth={3}
                  aria-hidden="true"
                />
              ) : (
                <span
                  className={cn(
                    'size-3.5 shrink-0 rounded-full',
                    s.status === 'done' &&
                      'bg-[var(--ops-signal-deep)] dark:bg-[var(--ops-signal)]',
                    s.status === 'current' && 'ring-2 ring-primary ring-offset-2 ring-offset-card',
                    s.status === 'todo' && 'border-2 border-muted-foreground',
                  )}
                  aria-hidden="true"
                />
              )}
              {!last ? (
                <span
                  className={cn(
                    'mx-2 hidden h-0.5 flex-1 sm:block',
                    s.status === 'done' && next?.status !== 'todo'
                      ? 'bg-[var(--ops-signal-deep)] dark:bg-[var(--ops-signal)]'
                      : 'bg-border',
                  )}
                  aria-hidden="true"
                />
              ) : null}
            </div>
            <div className="flex min-w-0 flex-col sm:pr-3">
              <span
                className={cn(
                  'text-sm',
                  s.status === 'todo' ? 'text-muted-foreground' : 'font-medium',
                  s.status === 'failed' && 'text-status-critical',
                )}
              >
                {s.label}
                <span className="sr-only">: {SR[s.status]}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {s.at ? ago(s.at, now) : s.status === 'current' ? 'Next' : ' '}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
