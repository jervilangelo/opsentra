import type * as React from 'react';

import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('rounded-md bg-muted motion-safe:animate-pulse', className)} {...props} />
  );
}
