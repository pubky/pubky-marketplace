import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommerceSellerReputationOverview } from '@/application/commerce/commerce';
import type { CommerceReputationBucket, CommerceReputationSummary } from '@/models/commerce/commerce.schema';
import { TEST_TRUSTED_ATTESTOR } from '@/test/fixtures/commerce/trusted-attestors';
import { MarketplaceReputationHeader } from './MarketplaceReputationHeader';

const reputation = vi.hoisted(
  (): { value: CommerceSellerReputationOverview | { status: 'loading' }; ratedListings: number } => ({
    value: { status: 'loading' },
    ratedListings: 0,
  }),
);

vi.mock('@/hooks/useMarketplaceReviews/useMarketplaceReviews', () => ({
  useSellerReputation: () => reputation.value,
  useSellerRatedListingCount: () => reputation.ratedListings,
}));

const SELLER = 's'.repeat(52);
const UNKNOWN_ATTESTOR = 'x'.repeat(52);

function rated(overrides: Partial<CommerceReputationSummary>): CommerceSellerReputationOverview {
  return {
    status: 'rated',
    summary: {
      count: 6,
      verifiedCount: 5,
      avg: 4.5,
      histogram: [0, 0, 1, 1, 4],
      responseCount: 0,
      editedLateCount: 0,
      attestors: {},
      lastReviewedAt: '2026-10-20T12:00:00.000Z',
      ...overrides,
    },
  };
}

describe('MarketplaceReputationHeader', () => {
  beforeEach(() => {
    reputation.value = { status: 'loading' };
    reputation.ratedListings = 0;
  });

  it('counts only trusted-attestor reviews in the star row and the basis line', () => {
    reputation.value = rated({ attestors: { [TEST_TRUSTED_ATTESTOR.pubky]: 2, [UNKNOWN_ATTESTOR]: 3 } });

    render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);

    expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5 from 6 reviews, 2 verified purchases' })).toBeVisible();
    expect(screen.getByTitle('2 verified purchases')).toBeInTheDocument();
    expect(screen.getByText('2 of 6 reviews verified by the marketplace attestor')).toBeInTheDocument();
  });

  it('claims no verified purchases when every attestation comes from an unrecognized key', () => {
    reputation.value = rated({ attestors: { [UNKNOWN_ATTESTOR]: 5 } });

    render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);

    expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5 from 6 reviews' })).toBeVisible();
    expect(screen.queryByTitle(/verified purchase/)).not.toBeInTheDocument();
    expect(screen.getByText('5 attested reviews, none from an attestor this app recognizes')).toBeInTheDocument();
  });

  it('applies the same trusted-only count to the compact listing-page variant', () => {
    reputation.value = rated({ attestors: { [TEST_TRUSTED_ATTESTOR.pubky]: 1, [UNKNOWN_ATTESTOR]: 4 } });

    render(<MarketplaceReputationHeader sellerPubky={SELLER} />);

    expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5 from 6 reviews, 1 verified purchase' })).toBeVisible();
  });
});

const seconds = (iso: string) => Date.parse(iso) / 1000;

function bucket(overrides: Partial<CommerceReputationBucket> = {}): CommerceReputationBucket {
  return {
    orders: 4,
    buyers: 3,
    sumBuyerMeans: 13.8,
    weightedSum: 13.8,
    weightTotal: 3,
    histogram: [0, 0, 0, 2, 3],
    firstIat: seconds('2026-03-01T00:00:00Z'),
    lastIat: seconds('2026-09-01T00:00:00Z'),
    sellerBuyers: 2,
    sumSellerBuyerMeans: 9.4,
    ...overrides,
  };
}

describe('MarketplaceReputationHeader counted figures', () => {
  beforeEach(() => {
    reputation.value = { status: 'loading' };
    reputation.ratedListings = 0;
  });

  it('heads the storefront with the RV2 seller rating and puts item stars on the products line', () => {
    reputation.value = rated({ buckets: { [TEST_TRUSTED_ATTESTOR.pubky]: bucket() }, scoped: bucket() });
    reputation.ratedListings = 2;

    render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);

    const headline = screen.getByTestId('marketplace-reputation-seller-rating');
    expect(headline).toHaveTextContent('4.7seller rating · 2 buyers');
    expect(screen.getByRole('img', { name: 'Rated 4.7 out of 5' })).toBeVisible();
    expect(screen.getByTestId('marketplace-reputation-products')).toHaveTextContent(
      'Products rated 4.6 across 2 listings · 3 buyers · 4 orders',
    );
    expect(screen.getByText('5 of 6 reviews counted: verified purchases from attestors this app trusts')).toBeVisible();
  });

  it('shows "No seller rating yet" with the products line when only reviews without seller ratings count', () => {
    const legacyOnly = bucket({ sellerBuyers: 0, sumSellerBuyerMeans: 0 });
    reputation.value = rated({ buckets: { [TEST_TRUSTED_ATTESTOR.pubky]: legacyOnly }, scoped: legacyOnly });
    reputation.ratedListings = 1;

    render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);

    expect(screen.getByTestId('marketplace-reputation-seller-rating')).toHaveTextContent('No seller rating yet');
    expect(screen.getByTestId('marketplace-reputation-products')).toHaveTextContent(
      'Products rated 4.6 across 1 listing · 3 buyers · 4 orders',
    );
  });

  it('shows "No rating yet" when no attestor of the reviews is trusted', () => {
    reputation.value = rated({ buckets: { [UNKNOWN_ATTESTOR]: bucket() } });

    render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);

    expect(screen.getByTestId('marketplace-reputation-seller-rating')).toHaveTextContent('No rating yet');
    expect(screen.queryByTestId('marketplace-reputation-products')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('6 reviews, none a verified purchase from an attestor this app trusts')).toBeVisible();
  });

  it('drops a trusted bucket its window cuts when the index served no scoped figure', () => {
    reputation.value = rated({
      buckets: { [TEST_TRUSTED_ATTESTOR.pubky]: bucket({ firstIat: seconds('2025-12-01T00:00:00Z') }) },
    });

    render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);

    expect(screen.getByTestId('marketplace-reputation-seller-rating')).toHaveTextContent('No rating yet');
  });

  it('omits the listing count when no cached listing has counted reviews', () => {
    reputation.value = rated({ buckets: {}, scoped: bucket() });

    render(<MarketplaceReputationHeader sellerPubky={SELLER} />);

    expect(screen.getByTestId('marketplace-reputation-products')).toHaveTextContent(
      'Products rated 4.6 · 3 buyers · 4 orders',
    );
    expect(screen.queryByText(/counted: verified purchases/)).not.toBeInTheDocument();
  });

  it('keeps the legacy display, with no counted claim, for an index without buckets', () => {
    reputation.value = rated({ attestors: { [TEST_TRUSTED_ATTESTOR.pubky]: 5 } });

    render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);

    expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5 from 6 reviews, 5 verified purchases' })).toBeVisible();
    expect(screen.queryByTestId('marketplace-reputation-seller-rating')).not.toBeInTheDocument();
    expect(screen.queryByText(/buyers/)).not.toBeInTheDocument();
  });
});
