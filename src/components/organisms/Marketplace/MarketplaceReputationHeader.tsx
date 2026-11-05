'use client';

import { BadgeCheck, Sparkles, Star } from 'lucide-react';
import { Badge } from '@/atoms/Badge/Badge';
import { Typography } from '@/atoms/Typography/Typography';
import { REPUTATION_WEIGHTED_COPY, REVIEW_FILTER_COPY } from '@/config/commerce-copy';
import { useSellerRatedListingCount, useSellerReputation } from '@/hooks/useMarketplaceReviews/useMarketplaceReviews';
import { trustedAttestedReviewCount } from '@/libs/commerce/attestor-trust';
import { type CountedReputation, countedSummaryReputation, formatCountedBasis } from '@/libs/commerce/review-counting';
import type { MarketplaceReviewFilterSummary } from '@/libs/commerce/review-filter';
import { cn } from '@/libs/utils/utils';
import type { CommerceReputationSummary } from '@/models/commerce/commerce.schema';
import { MarketplaceReviewFilterRating } from '@/molecules/MarketplaceReviewFilterRating/MarketplaceReviewFilterRating';
import { MarketplaceStarRating } from '@/molecules/MarketplaceStarRating/MarketplaceStarRating';

export interface MarketplaceReputationHeaderProps {
  sellerPubky: string;
  /** `compact` renders the rating rows only; `full` (shop page) adds the counted basis line. */
  variant?: 'compact' | 'full';
  /**
   * A reviewer filter's figures (from `useMarketplaceReviews`). While one is
   * active the header shows them, with their basis, instead of the counted
   * figures of everyone; null shows the counted figures.
   */
  filterSummary?: MarketplaceReviewFilterSummary | null;
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
 *   When the buckets carry purchase-value weights (some buyer above weight
 *   1), a secondary "Weighted by purchase value: 4.6" line follows the
 *   products line; without weights (an older index, or reviews without a
 *   `price_decade` claim) there is no such line.
 * - legacy (an index without buckets): today's trusted-only display: the
 *   index's stars over all reviews with a verified affix counting trusted
 *   attestors only (ADR 0024). No counted figure is claimed.
 * - filtered (a reviewer chip on the review list is active): the index's
 *   figures over the counted matches in place of the above, "4.8 from 3
 *   people you follow", with the seller rating of those people first; "No
 *   reviews from people you follow" when none counts, never 0.0 and never the
 *   figure of everyone.
 * - new seller: an explicit "New seller" badge, never a fabricated 0.0.
 * - unavailable: renders nothing at all (no reputation-aware index answered).
 *
 * Reputation is a display facet only — it never enters catalog ranking
 * (ratified D4).
 */
export function MarketplaceReputationHeader({
  sellerPubky,
  variant = 'compact',
  filterSummary = null,
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

  if (filterSummary !== null) {
    return <FilteredReputationHeader summary={filterSummary} variant={variant} className={className} />;
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
      {counted.weightedItemRating !== null && (
        <Typography
          as="p"
          className="text-xs text-muted-foreground"
          data-testid="marketplace-reputation-weighted"
          title={REPUTATION_WEIGHTED_COPY.hint}
        >
          {REPUTATION_WEIGHTED_COPY.line(counted.weightedItemRating)}
        </Typography>
      )}
      {variant === 'full' && (
        <Typography as="p" className="flex items-center gap-1 text-xs text-muted-foreground">
          <BadgeCheck className="size-3.5 text-emerald-400 [.light_&]:text-emerald-700" />
          {countedBasisLine(counted, summary.count)}
        </Typography>
      )}
    </div>
  );
}

function FilteredReputationHeader({
  summary,
  variant,
  className,
}: {
  summary: MarketplaceReviewFilterSummary;
  variant: 'compact' | 'full';
  className?: string;
}) {
  const size = variant === 'full' ? 'md' : 'sm';
  const sellerMatched =
    summary.state === 'ready' &&
    summary.matched.sellerBuyers !== undefined &&
    summary.matched.sellerBuyers > 0 &&
    summary.matched.sellerAvg !== undefined &&
    summary.matched.sellerAvg !== null
      ? { rating: summary.matched.sellerAvg, buyers: summary.matched.sellerBuyers }
      : null;
  const itemsCounted = summary.state === 'ready' && summary.matched.buyers > 0 && summary.matched.avg !== null;

  return (
    <div
      className={cn('flex flex-col gap-1', className)}
      data-testid="marketplace-reputation-header"
      data-filtered="true"
    >
      {summary.state === 'ready' && sellerMatched !== null && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="marketplace-reputation-seller-rating">
          <MarketplaceStarRating rating={sellerMatched.rating} size={size} />
          <Typography as="span" className="text-sm text-muted-foreground">
            {`${REVIEW_FILTER_COPY.sellerRating} ${REVIEW_FILTER_COPY.from(summary.filter.kind, sellerMatched.buyers)}`}
          </Typography>
        </div>
      )}
      <MarketplaceReviewFilterRating
        summary={summary}
        label={sellerMatched !== null && itemsCounted ? REVIEW_FILTER_COPY.productsRated : undefined}
        size={sellerMatched === null ? size : 'sm'}
      />
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
          <BadgeCheck className="size-3.5 text-emerald-400 [.light_&]:text-emerald-700" />
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
