import { cn } from '@/lib/utils';

const base = import.meta.env.BASE_URL;

/**
 * Horizontal lockup from the approved kit, used exactly as supplied. The dark
 * logo shows on the dark theme, the light logo on the light theme. Never retype
 * the wordmark.
 */
export function Logo({ className, height = 28 }: { className?: string; height?: number }) {
  // Lockup aspect ratio from the SVG viewBox (715.74 × 153.12).
  const width = Math.round((height * 715.74) / 153.12);
  return (
    <span className={cn('inline-flex', className)}>
      <img
        src={`${base}brand/opsentra-logo-dark.svg`}
        alt="Opsentra"
        width={width}
        height={height}
        className="hidden dark:block"
      />
      <img
        src={`${base}brand/opsentra-logo-light.svg`}
        alt="Opsentra"
        width={width}
        height={height}
        className="block dark:hidden"
      />
    </span>
  );
}
