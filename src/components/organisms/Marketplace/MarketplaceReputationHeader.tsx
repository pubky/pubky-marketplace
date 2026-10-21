'use client';

import { BadgeCheck, Sparkles } from 'lucide-react';
import { Badge } from '@/atoms/Badge/Badge';
import { Typography } from '@/atoms/Typography/Typography';
import { useSellerReputation } from '@/hooks/useMarketplaceReviews/useMarketplaceReviews';
import { trustedAttestedReviewCount } from '@/libs/commerce/attestor-trust';
import { cn } from '@/libs/utils/utils';
import { MarketplaceStarRating } from '@/molecules/MarketplaceStarRating/MarketplaceStarRating';

export interface MarketplaceReputationHeaderProps {
  sellerPubky: string;
  /** `compact` renders one star row (listing page); `full` adds the verified basis line (shop page). */
  variant?: 'compact' | 'full';
  className?: string;
}

/**
 * The seller rating header for listing and shop pages, driven by the Nexus
 * reputation aggregate with three honest states:
 *
 * - rated: stars, count, and a verified affix plus (in `full`) a basis line,
 *   both counting only verified reviews from attestors this client trusts
 *   (ADR 0024: the index verifies signatures; WHO is a trusted attestor is
 *   client policy).
 * - new seller: an explicit "New seller" badge — never a fabricated 0.0.
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
