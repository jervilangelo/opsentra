import { LIVE_REGION } from '@/config/env';
import { cn } from '@/lib/utils';
import type { Mode } from '@/types/domain';

/** Exact label text, standardised by ADR-011. */
export const DEMO_LABEL = 'DEMO — SYNTHETIC DATA';
export const LIVE_LABEL = `LIVE AWS — ${LIVE_REGION}`;

/**
 * Demo: dashed Signal outline. Live: solid badge with a dot (BRAND_GUIDELINES §9).
 * Never tint the logo to show the mode.
 */
export function ModeBadge({ mode, className }: { mode: Mode; className?: string }) {
  if (mode === 'demo') {
    return (
      <span
        data-mode="demo"
        className={cn(
          'inline-flex items-center rounded-md border border-dashed border-primary px-2 py-0.5 font-data text-xs font-medium tracking-wide whitespace-nowrap text-primary',
          className,
        )}
      >
        {DEMO_LABEL}
      </span>
    );
  }
  return (
    <span
      data-mode="live"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md bg-foreground px-2 py-0.5 font-data text-xs font-medium tracking-wide whitespace-nowrap text-background',
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-background" aria-hidden="true" />
      {LIVE_LABEL}
    </span>
  );
}
