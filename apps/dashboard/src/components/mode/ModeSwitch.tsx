import { useQueryClient } from '@tanstack/react-query';

import { cn } from '@/lib/utils';
import { useModeStore } from '@/modes/mode-store';
import type { Mode } from '@/types/domain';

const OPTIONS: { value: Mode; label: string }[] = [
  { value: 'demo', label: 'Demo' },
  { value: 'live', label: 'Live AWS' },
];

/** Segmented control for the data mode. Switching drops all cached data. */
export function ModeSwitch({ className }: { className?: string }) {
  const mode = useModeStore((s) => s.mode);
  const setMode = useModeStore((s) => s.setMode);
  const queryClient = useQueryClient();

  function choose(next: Mode) {
    if (next === mode) return;
    // Never keep data from one mode around while the other is shown.
    queryClient.removeQueries();
    setMode(next);
  }

  return (
    <div
      role="group"
      aria-label="Data mode"
      className={cn('inline-flex rounded-md bg-muted p-0.5', className)}
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={mode === o.value}
          onClick={() => choose(o.value)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap',
            mode === o.value
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
