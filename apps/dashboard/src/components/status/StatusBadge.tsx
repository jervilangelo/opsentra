import { CircleAlert, CircleCheck, CircleDot, CircleHelp, Info, TriangleAlert } from 'lucide-react';
import type * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { StatusTone } from '@/types/display';

/*
 * Status colour sits on the border, icon and a 12 % tint. Label text uses the
 * status colour on dark (all pairs ≥ 7:1) but the foreground ink on light: the
 * light-UI status colours are AA on white, yet amber #B45309 falls to 4.25:1
 * on its own tint (design review, docs/phases/phase-1-design-review.md).
 */
const TONE_CLASS: Record<StatusTone, { badge: string; icon: string }> = {
  healthy: {
    badge:
      'dark:text-status-healthy border-status-healthy/60 bg-[color-mix(in_srgb,var(--status-healthy)_12%,transparent)]',
    icon: 'text-status-healthy',
  },
  warning: {
    badge:
      'dark:text-status-warning border-status-warning/60 bg-[color-mix(in_srgb,var(--status-warning)_12%,transparent)]',
    icon: 'text-status-warning',
  },
  critical: {
    badge:
      'dark:text-status-critical border-status-critical/60 bg-[color-mix(in_srgb,var(--status-critical)_12%,transparent)]',
    icon: 'text-status-critical',
  },
  info: {
    badge:
      'dark:text-status-info border-status-info/60 bg-[color-mix(in_srgb,var(--status-info)_12%,transparent)]',
    icon: 'text-status-info',
  },
  unknown: {
    badge:
      'dark:text-status-unknown border-status-unknown/60 bg-[color-mix(in_srgb,var(--status-unknown)_12%,transparent)]',
    icon: 'text-status-unknown',
  },
};

/** A distinct shape per tone, so status never relies on colour alone. */
const TONE_ICON: Record<StatusTone, React.ComponentType<{ className?: string }>> = {
  healthy: CircleCheck,
  warning: TriangleAlert,
  critical: CircleAlert,
  info: Info,
  unknown: CircleHelp,
};

export interface StatusBadgeProps {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
  /** Use a dot instead of the tone icon (for in-progress states). */
  dot?: boolean;
}

/** Base for all status badges: tinted background, coloured border, icon and text label. */
export function StatusBadge({ tone, children, className, dot = false }: StatusBadgeProps) {
  const Icon = dot ? CircleDot : TONE_ICON[tone];
  const { badge, icon } = TONE_CLASS[tone];
  return (
    <Badge className={cn('font-medium text-foreground', badge, className)} data-tone={tone}>
      <Icon className={icon} aria-hidden="true" />
      <span>{children}</span>
    </Badge>
  );
}
