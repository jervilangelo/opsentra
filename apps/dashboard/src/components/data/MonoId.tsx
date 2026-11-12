import { cn } from '@/lib/utils';

/** Resource IDs, incident IDs and correlation keys: IBM Plex Mono, tabular numerals. */
export function MonoId({ children, className }: { children: string; className?: string }) {
  return <code className={cn('font-data text-xs break-all', className)}>{children}</code>;
}
