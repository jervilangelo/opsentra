import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 animate-in rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md fade-in-0',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
