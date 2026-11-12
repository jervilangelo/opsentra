import { Slot } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/lib/utils';

/*
 * Easy view primitives (ADR-013, taste skill style "true-black-flat" with the
 * brand's palette kept):
 * - panels are separated from the ground by one lightness step, no border on dark;
 * - the one primary action per screen is made primary by inversion (Cloud pill,
 *   Navy text on dark; the reverse on light), 44px tall for touch;
 * - colour stays on data. Buttons never take Signal.
 */

export function EasyPanel({ className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      className={cn(
        'min-w-0 rounded-xl border bg-card p-5 text-card-foreground sm:p-6 dark:border-transparent',
        className,
      )}
      {...props}
    />
  );
}

interface EasyButtonProps extends React.ComponentProps<'button'> {
  asChild?: boolean;
}

export function EasyPrimary({ className, asChild = false, ...props }: EasyButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      className={cn(
        'inline-flex h-11 items-center justify-center gap-2 rounded-full bg-foreground px-6 text-base font-medium text-background no-underline transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}

export function EasyQuiet({ className, asChild = false, ...props }: EasyButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      className={cn(
        'inline-flex h-11 items-center gap-2 rounded-full px-4 text-base font-medium text-foreground underline decoration-1 underline-offset-4 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40 [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}
