import { cn } from '@/lib/utils';
import { usePreferences, type View } from '@/stores/preferences';

const OPTIONS: { value: View; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'advanced', label: 'Advanced' },
];

/**
 * Easy or Advanced view (ADR-013). Changes how much is shown, never which data
 * or which rules apply. Labelled "View" so it is not confused with the data mode.
 */
export function ViewSwitch({
  className,
  showLabel = true,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const view = usePreferences((s) => s.view);
  const setView = usePreferences((s) => s.setView);
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {showLabel ? (
        <span className="hidden text-xs text-muted-foreground sm:inline" aria-hidden="true">
          View
        </span>
      ) : null}
      <div role="group" aria-label="View" className="inline-flex rounded-md bg-muted p-0.5">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={view === o.value}
            onClick={() => setView(o.value)}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap',
              view === o.value
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
