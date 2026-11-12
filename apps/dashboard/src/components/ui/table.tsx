import type * as React from 'react';

import { cn } from '@/lib/utils';

export interface TableProps extends React.ComponentProps<'table'> {
  /** Accessible name for the scroll region (keyboard users can focus and scroll it). */
  label: string;
}

/** Wraps the table in its own horizontal scroll area so the page never scrolls sideways. */
export function Table({ className, label, ...props }: TableProps) {
  return (
    // A focusable, named region so keyboard users can scroll it (WCAG 2.1.1).
    <div
      role="region"
      aria-label={label}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className="relative w-full overflow-x-auto rounded-sm"
    >
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('[&_tr]:border-b', className)} {...props} />;
}

export function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr className={cn('border-b transition-colors hover:bg-muted/50', className)} {...props} />
  );
}

export function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'h-10 px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-3 py-2.5 align-middle whitespace-nowrap', className)} {...props} />;
}

export function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption className={cn('mt-3 text-left text-xs text-muted-foreground', className)} {...props} />
  );
}
