import { Check, Star } from 'lucide-react';
import { Typography } from '@/atoms/Typography/Typography';
import { formatCountedBasis } from '@/libs/commerce/review-counting';
import { cn } from '@/libs/utils/utils';

export interface MarketplaceStarRatingProps {
  /** Star average on the 1–5 scale (callers never pass a fabricated 0). */
  rating: number;
  /** Total review count behind the average; rendered when provided. */
  count?: number;
  /**
   * Verified-purchase count: reviews whose attestation verified AND whose
   * attestor this client trusts (`trustedAttestedReviewCount`). Never the
   * index's raw `verifiedCount`, which counts any key. Rendered as the
   * "✓ n" affix when provided and positive.
   */
  verifiedCount?: number;
  /**
   * Counted basis (counting rules v2): the rating is a per-buyer mean over N
   * buyers and M orders. Rendered as "N buyers · M orders" in place of the
   * review count.
   */
  basis?: { buyers: number; orders: number };
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * The shared star row for cards, rating headers, and review items: five
 * stars with fractional fill, the numeric average, and the optional
 * count / verified affixes. Purely presentational — the truthfulness rules
 * (absence over zeros, "New seller" instead of 0.0) live with the callers,
 * which must simply not render this component without real data.
 */
export function MarketplaceStarRating({
  rating,
  count,
  verifiedCount,
  basis,
  size = 'sm',
  className,
}: MarketplaceStarRatingProps) {
  const starSize = size === 'sm' ? 'size-3.5' : 'size-4.5';
  const textSize = size === 'sm' ? 'text-[11px]' : 'text-sm';
  const clamped = Math.min(5, Math.max(0, rating));
  const basisText = basis ? formatCountedBasis(basis) : null;

  return (
    <div
      className={cn('flex items-center gap-1.5', className)}
      role="img"
      aria-label={`Rated ${clamped.toFixed(1)} out of 5${basis ? ` from ${formatCountedBasis(basis, ', ')}` : ''}${count !== undefined ? ` from ${count} ${count === 1 ? 'review' : 'reviews'}` : ''}${verifiedCount !== undefined && verifiedCount > 0 ? `, ${verifiedCount} verified ${verifiedCount === 1 ? 'purchase' : 'purchases'}` : ''}`}
    >
      <div className="relative inline-flex" aria-hidden="true">
        <div className="flex gap-0.5">
          {[0, 1, 2, 3, 4].map((index) => (
            <Star key={index} className={cn(starSize, 'text-muted-foreground/40')} />
          ))}
        </div>
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${(clamped / 5) * 100}%` }}>
          <div className="flex gap-0.5">
            {[0, 1, 2, 3, 4].map((index) => (
              <Star key={index} className={cn(starSize, 'shrink-0 fill-chart-6 text-chart-6')} />
            ))}
          </div>
        </div>
      </div>
      <Typography as="span" className={cn(textSize, 'font-semibold text-foreground')}>
        {clamped.toFixed(1)}
      </Typography>
      {basisText !== null && (
        <Typography as="span" className={cn(textSize, 'ml-1 text-muted-foreground')}>
          {basisText}
        </Typography>
      )}
      {count !== undefined && (
        <Typography
          as="span"
          className={cn(textSize, 'ml-2 inline-flex items-center gap-1 text-muted-foreground')}
          title={`${count} ${count === 1 ? 'review' : 'reviews'}`}
        >
          <Star className={starSize} aria-hidden="true" />
          {count}
        </Typography>
      )}
      {verifiedCount !== undefined && verifiedCount > 0 && (
        <Typography
          as="span"
          className={cn(textSize, 'inline-flex items-center gap-1 text-muted-foreground')}
          title={`${verifiedCount} verified ${verifiedCount === 1 ? 'purchase' : 'purchases'}`}
        >
          <Check className={starSize} aria-hidden="true" />
          {verifiedCount}
        </Typography>
      )}
    </div>
  );
}
