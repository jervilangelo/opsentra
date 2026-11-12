import { cn } from '@/lib/utils';

const localFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'medium',
});

export interface TimestampProps {
  /** ISO-8601 UTC timestamp from the source. */
  value: string | undefined;
  className?: string;
  /** Text shown when the value is missing. Missing data is never shown as zero. */
  fallback?: string;
}

/**
 * Shows the time in the viewer's locale, keeps the source UTC value in
 * `dateTime` and the tooltip (blueprint §2.3).
 */
export function Timestamp({ value, className, fallback = 'Not recorded' }: TimestampProps) {
  if (!value) return <span className={cn('text-muted-foreground', className)}>{fallback}</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return <span className={cn('text-muted-foreground', className)}>Invalid time</span>;
  }
  return (
    <time
      dateTime={value}
      title={`${value} (UTC source)`}
      className={cn('font-data text-xs', className)}
    >
      {localFormat.format(date)}
    </time>
  );
}
