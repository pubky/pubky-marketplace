import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogItemFromCatalogEntry } from '@/hooks/useMarketplaceCatalog/useMarketplaceCatalog.utils';
import type { CommerceIndexedReview } from '@/models/commerce/commerce.schema';
import { useAuthStore } from '@/stores/auth/auth.store';
import { createCommerceCatalogEntryFixture } from '@/test/fixtures/commerce/commerce';
import { setSocialHost } from '@/test-utils/social-host';
import { MarketplaceReviewsSection } from './MarketplaceReviewsSection';

const SELLER = 's'.repeat(52);
const REVIEWER = 'a'.repeat(52);

const REVIEW: CommerceIndexedReview = {
  reviewId: '8Z8CWH8NVYQY39ZEBFGKQWWEKG',
  reviewerId: REVIEWER,
  subjectId: SELLER,
  listingOwnerId: SELLER,
  listingId: 'rangefinder_camera',
  role: 'buyer_reviewing_seller',
  ratingOverall: 5,
  text: 'Exactly as described.',
  verified: false,
  attestorId: null,
  editedLate: false,
  createdAt: '2026-08-10T12:00:00.000Z',
  updatedAt: '2026-08-10T12:00:00.000Z',
  revision: 1,
  response: null,
};

vi.mock('@/hooks/useMarketplaceReviews/useMarketplaceReviews', () => ({
  useMarketplaceReviews: () => ({
    status: 'ok',
    reviews: [REVIEW],
    isFetching: false,
    hasMore: false,
    loadMore: vi.fn(),
  }),
}));

describe('MarketplaceReviewsSection reviewer link', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUserPubky: null });
  });

  afterEach(() => {
    setSocialHost(undefined);
  });

  it('links the reviewer to their Shop profile while social link-out is off', () => {
    render(<MarketplaceReviewsSection sellerPubky={SELLER} />);

    expect(screen.getByRole('link', { name: `${REVIEWER.slice(0, 8)}…` })).toHaveAttribute(
      'href',
      `/profile/${REVIEWER}`,
    );
    expect(screen.queryByRole('link', { name: 'Profile on Pubky' })).not.toBeInTheDocument();
  });

  it('links the reviewer to their shop, with their profile on the social host beside it, while on', () => {
    setSocialHost('https://pubky.app');
    render(<MarketplaceReviewsSection sellerPubky={SELLER} />);

    expect(screen.getByRole('link', { name: `${REVIEWER.slice(0, 8)}…` })).toHaveAttribute(
      'href',
      `/marketplace/shop/${REVIEWER}`,
    );
    expect(screen.getByRole('link', { name: 'Profile on Pubky' })).toHaveAttribute(
      'href',
      `https://pubky.app/profile/${REVIEWER}`,
    );
  });
});

describe('MarketplaceReviewsSection on a storefront', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUserPubky: null });
  });

  const listing = catalogItemFromCatalogEntry(
    createCommerceCatalogEntryFixture({
      id: `${SELLER}:rangefinder_camera`,
      seller_id: SELLER,
      listing_id: 'rangefinder_camera',
      title: 'Rangefinder camera',
      media_urls: [],
    }),
  );

  it('leads each review with the listing it reviews, linked', () => {
    render(<MarketplaceReviewsSection sellerPubky={SELLER} listings={[listing]} />);

    expect(screen.getByRole('link', { name: 'Rangefinder camera' })).toHaveAttribute(
      'href',
      `/marketplace/listing/${SELLER}/rangefinder_camera`,
    );
    expect(screen.getByText('Exactly as described.')).toBeInTheDocument();
  });

  it('shows no listing on a listing page, which passes no listings', () => {
    render(<MarketplaceReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />);

    expect(screen.queryByRole('link', { name: 'Rangefinder camera' })).not.toBeInTheDocument();
  });
});
