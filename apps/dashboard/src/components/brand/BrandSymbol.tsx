import { cn } from '@/lib/utils';

/*
 * Path data is copied verbatim from the approved kit (brand/opsentra-icon.svg and
 * brand/variants/opsentra-icon-small.svg). The kit draws both halves as one
 * <path>; here each sub-path is its own element so the right half can carry the
 * brand "shift" motion. Nothing is redrawn. Colour comes from --brand-symbol
 * (Signal on dark, Signal Deep on light) and is never a status colour.
 */
const PATHS = {
  master: {
    left: 'M128 36A104 104 0 0 0 128 244V204A64 64 0 0 1 128 76Z',
    right: 'M128 12A104 104 0 0 1 128 220V180A64 64 0 0 0 128 52Z',
  },
  small: {
    left: 'M128 28A112 112 0 0 0 128 252V210A70 70 0 0 1 128 70Z',
    right: 'M128 4A112 112 0 0 1 128 228V186A70 70 0 0 0 128 46Z',
  },
} as const;

export interface BrandSymbolProps {
  /** Rendered size in px. Below 32 px the small-size cut is used automatically. */
  size?: number;
  /** Animate the brand shift (loading/recovering). Static under reduced motion. */
  shifting?: boolean;
  className?: string;
  /** Accessible name. Omit for decorative use. */
  title?: string;
}

export function BrandSymbol({ size = 32, shifting = false, className, title }: BrandSymbolProps) {
  const cut = size < 32 ? PATHS.small : PATHS.master;
  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      className={cn('shrink-0 text-brand-symbol', className)}
      fill="currentColor"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      data-cut={size < 32 ? 'small' : 'master'}
    >
      <path d={cut.left} />
      <path
        d={cut.right}
        className={shifting ? 'motion-safe:animate-ops-shift' : undefined}
        data-testid={shifting ? 'brand-shift' : undefined}
      />
    </svg>
  );
}
