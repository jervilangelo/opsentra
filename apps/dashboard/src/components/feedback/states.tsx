import { CircleAlert, Construction } from 'lucide-react';
import type * as React from 'react';

import { BrandSymbol } from '@/components/brand/BrandSymbol';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface StateProps {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** Empty or all-clear state with the quiet 7 % symbol watermark (BRAND_GUIDELINES §9). */
export function EmptyState({ title, description, action, className }: StateProps) {
  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-dashed px-6 py-12 text-center',
        className,
      )}
    >
      <BrandSymbol size={160} className="pointer-events-none absolute opacity-[0.07]" />
      <h2 className="relative text-base">{title}</h2>
      {description ? (
        <div className="relative max-w-prose text-sm text-muted-foreground">{description}</div>
      ) : null}
      {action ? <div className="relative mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title, description, action, className }: StateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-status-critical/50 p-5 sm:flex-row sm:items-start',
        className,
      )}
    >
      <CircleAlert className="mt-0.5 size-5 shrink-0 text-status-critical" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <h2 className="text-base">{title}</h2>
        {description ? (
          <div className="max-w-prose text-sm text-muted-foreground">{description}</div>
        ) : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}

/**
 * Loading state. Uses the brand shift motion (right half slides 12 units and
 * back), never a spinning logo. Static when the user prefers reduced motion.
 */
export function LoadingState({
  label = 'Loading…',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex flex-col items-center justify-center gap-3 py-10', className)}
    >
      <BrandSymbol size={40} shifting />
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex w-full max-w-md flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  );
}

/** Clearly labelled placeholder for work scheduled in a later phase. */
export function PlannedPanel({
  phase,
  title,
  children,
  className,
}: {
  phase: string;
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={`${title} (planned)`}
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-dashed bg-muted/40 p-5',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Construction className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm">{title}</h2>
        <Badge variant="outline" className="font-data text-muted-foreground">
          Planned · {phase}
        </Badge>
      </div>
      {children ? (
        <div className="max-w-prose text-sm text-muted-foreground">{children}</div>
      ) : null}
    </section>
  );
}
