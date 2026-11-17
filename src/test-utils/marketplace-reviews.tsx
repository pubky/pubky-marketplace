import type { ReactNode } from 'react';
import { useMarketplaceReviews } from '@/hooks/useMarketplaceReviews/useMarketplaceReviews';
import { MarketplaceReputationHeader } from '@/organisms/Marketplace/MarketplaceReputationHeader';
import {
  MarketplaceReviewsSection,
  type MarketplaceReviewsSectionProps,
} from '@/organisms/Marketplace/MarketplaceReviewsSection';

/** The review list as a page mounts it: the hook owns the list and the section renders it. */
export function ReviewsSection({
  sellerPubky,
  ...props
}: Omit<MarketplaceReviewsSectionProps, 'reviews'> & { sellerPubky: string }): ReactNode {
  const reviews = useMarketplaceReviews({ sellerPubky, listingId: props.listingId });
  return <MarketplaceReviewsSection {...props} reviews={reviews} />;
}

/** The storefront pairing: the full rating header and the list share one chip. */
export function ReviewsWithHeader({ sellerPubky }: { sellerPubky: string }): ReactNode {
  const reviews = useMarketplaceReviews({ sellerPubky });
  return (
    <>
      <MarketplaceReputationHeader sellerPubky={sellerPubky} variant="full" filterSummary={reviews.filterSummary} />
      <MarketplaceReviewsSection reviews={reviews} />
    </>
  );
}
