'use client';

import { BadgeCheck, Sparkles, Star } from 'lucide-react';
import { Badge } from '@/atoms/Badge/Badge';
import { Typography } from '@/atoms/Typography/Typography';
import { useSellerRatedListingCount, useSellerReputation } from '@/hooks/useMarketplaceReviews/useMarketplaceReviews';
import { trustedAttestedReviewCount } from '@/libs/commerce/attestor-trust';
import { type CountedReputation, countedSummaryReputation, formatCountedBasis } from '@/libs/commerce/review-counting';
import { cn } from '@/libs/utils/utils';
import type { CommerceReputationSummary } from '@/models/commerce/commerce.schema';
import { MarketplaceStarRating } from '@/molecules/MarketplaceStarRating/MarketplaceStarRating';

export interface MarketplaceReputationHeaderProps {
  sellerPubky: string;
  /** `compact` renders the rating rows only; `full` (shop page) adds the counted basis line. */
  variant?: 'compact' | 'full';
  className?: string;
}

/**
 * The seller rating header for the storefront, driven by the Nexus
 * reputation aggregate:
 *
 * - counted (an index with trust buckets): the headline is the seller
 *   rating from shipping and communication (RV2), "4.7 seller rating ·
 *   N buyers"; item stars follow as "Products rated 4.6 across L listings ·
 *   N buyers · M orders". Only counted reviews enter either figure: verified
 *   by an attestor this client trusts, inside its window. A seller whose
 *   counted reviews predate the seller questions reads "No seller rating
 *   yet" above the products line; with nothing counted, "No rating yet".
 * - legacy (an index without buckets): today's trusted-only display: the
 *   index's stars over all reviews with a verified affix counting trusted
 *   attestors only (ADR 0024). No counted figure is claimed.
 * - new seller: an explicit "New seller" badge, never a fabricated 0.0.
 * - unavailable: renders nothing at all (no reputation-aware index answered).
 *
 * Reputation is a display facet only — it never enters catalog ranking
 * (ratified D4).
 */
export function MarketplaceReputationHeader({
  sellerPubky,
  variant = 'compact',
  className,
}: MarketplaceReputationHeaderProps) {
  const overview = useSellerReputation(sellerPubky);
  const ratedListings = useSellerRatedListingCount(sellerPubky);

  if (overview.status === 'loading' || overview.status === 'unavailable') return null;

  if (overview.status === 'new_seller') {
    return (
      <div className={cn('flex items-center gap-2', className)} data-testid="marketplace-reputation-header">
        <Badge variant="secondary" className="gap-1">
          <Sparkles className="size-3" />
          New seller
        </Badge>
        <Typography as="span" className="text-xs text-muted-foreground">
          No reviews yet
        </Typography>
      </div>
    );
  }

  const { summary } = overview;
  const counted = countedSummaryReputation(summary);
  if (counted === null) return <LegacyReputationHeader summary={summary} variant={variant} className={className} />;

  return (
    <div className={cn('flex flex-col gap-1', className)} data-testid="marketplace-reputation-header">
      {counted.sellerRating !== null ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="marketplace-reputation-seller-rating">
          <MarketplaceStarRating rating={counted.sellerRating} size={variant === 'full' ? 'md' : 'sm'} />
          <Typography as="span" className="text-sm text-muted-foreground">
            {`seller rating · ${counted.sellerBuyers} ${counted.sellerBuyers === 1 ? 'buyer' : 'buyers'}`}
          </Typography>
        </div>
      ) : (
        <Typography as="p" className="text-sm text-muted-foreground" data-testid="marketplace-reputation-seller-rating">
          {counted.itemRating !== null ? 'No seller rating yet' : 'No rating yet'}
        </Typography>
      )}
      {counted.itemRating !== null && (
        <Typography
          as="p"
          className="flex items-center gap-1 text-xs text-muted-foreground"
          data-testid="marketplace-reputation-products"
        >
          <Star className="size-3.5 fill-chart-6 text-chart-6" aria-hidden="true" />
          {productsLine(counted, ratedListings)}
        </Typography>
      )}
      {variant === 'full' && (
        <Typography as="p" className="flex items-center gap-1 text-xs text-muted-foreground">
          <BadgeCheck className="size-3.5 text-emerald-400" />
          {countedBasisLine(counted, summary.count)}
        </Typography>
      )}
    </div>
  );
}

function productsLine(counted: CountedReputation, ratedListings: number): string {
  const across = ratedListings > 0 ? ` across ${ratedListings} ${ratedListings === 1 ? 'listing' : 'listings'}` : '';
  return `Products rated ${(counted.itemRating ?? 0).toFixed(1)}${across} · ${formatCountedBasis(counted)}`;
}

function countedBasisLine(counted: CountedReputation, total: number): string {
  if (counted.reviews === 0) {
    return `${total} ${total === 1 ? 'review' : 'reviews'}, none a verified purchase from an attestor this app trusts`;
  }
  return `${counted.reviews} of ${total} ${total === 1 ? 'review' : 'reviews'} counted: verified purchases from attestors this app trusts`;
}

function LegacyReputationHeader({
  summary,
  variant,
  className,
}: {
  summary: CommerceReputationSummary;
  variant: 'compact' | 'full';
  className?: string;
}) {
  const trustedVerifiedCount = trustedAttestedReviewCount(summary.attestors);

  return (
    <div className={cn('flex flex-col gap-1', className)} data-testid="marketplace-reputation-header">
      <MarketplaceStarRating
        rating={summary.avg}
        count={summary.count}
        verifiedCount={trustedVerifiedCount}
        size={variant === 'full' ? 'md' : 'sm'}
      />
      {variant === 'full' && (
        <Typography as="p" className="flex items-center gap-1 text-xs text-muted-foreground">
          <BadgeCheck className="size-3.5 text-emerald-400" />
          {trustedVerifiedCount > 0
            ? `${trustedVerifiedCount} of ${summary.count} ${summary.count === 1 ? 'review' : 'reviews'} verified by the marketplace attestor`
            : summary.verifiedCount > 0
              ? `${summary.verifiedCount} attested ${summary.verifiedCount === 1 ? 'review' : 'reviews'}, none from an attestor this app recognizes`
              : 'No verified purchases among these reviews'}
        </Typography>
      )}
    </div>
  );
}
