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

  it('shows no stars on a legacy index and counts only trusted-attestor reviews in its line', () => {
    reputation.value = rated({ attestors: { [TEST_TRUSTED_ATTESTOR.pubky]: 2, [UNKNOWN_ATTESTOR]: 3 } });

    render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('marketplace-reputation-seller-rating')).toHaveTextContent('No rating yet');
    expect(screen.getByTestId('marketplace-reputation-header').textContent).not.toContain('4.5');
    expect(
      screen.getByText('2 reviews verified by attestors this app trusts, not yet rated on their own'),
    ).toBeInTheDocument();
  });

  it('words the legacy line for a single trusted verified review', () => {
    reputation.value = rated({ attestors: { [TEST_TRUSTED_ATTESTOR.pubky]: 1, [UNKNOWN_ATTESTOR]: 4 } });

    render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);

    expect(
      screen.getByText('1 review verified by an attestor this app trusts, not yet rated on its own'),
    ).toBeInTheDocument();
  });

  it('shows no stars when every attestation comes from an unrecognized key', () => {
    reputation.value = rated({ attestors: { [UNKNOWN_ATTESTOR]: 5 } });

    render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('marketplace-reputation-seller-rating')).toHaveTextContent('No rating yet');
    expect(screen.queryByTitle(/verified purchase/)).not.toBeInTheDocument();
    expect(screen.getByText('No reviews verified by an attestor this app trusts')).toBeInTheDocument();
  });

  it('shows "No rating yet" and no stars on the compact listing-page variant of a legacy index', () => {
    reputation.value = rated({ attestors: { [TEST_TRUSTED_ATTESTOR.pubky]: 1, [UNKNOWN_ATTESTOR]: 4 } });

    render(<MarketplaceReputationHeader sellerPubky={SELLER} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('marketplace-reputation-header')).toHaveTextContent(/^No rating yet$/);
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
    expect(screen.getByText('5 reviews counted: verified purchases from attestors this app trusts')).toBeVisible();
  });

  describe('count line ignores unfiltered review totals', () => {
    function basisLine(overrides: Partial<CommerceReputationSummary>): string | null {
      reputation.value = rated(overrides);
      const { unmount } = render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);
      const text = screen.getByText(/counted:/).textContent;
      unmount();
      return text;
    }

    it('keeps the empty counted line unchanged when only unverified reviews are added', () => {
      const empty = bucket({
        orders: 0,
        buyers: 0,
        sumBuyerMeans: 0,
        weightedSum: 0,
        weightTotal: 0,
        histogram: [0, 0, 0, 0, 0],
        firstIat: null,
        lastIat: null,
        sellerBuyers: 0,
        sumSellerBuyerMeans: 0,
      });
      const countedFigures = { buckets: {}, scoped: empty };
      const before = basisLine({
        ...countedFigures,
        count: 0,
        verifiedCount: 0,
        unverifiedCount: 0,
        histogram: [0, 0, 0, 0, 0],
      });
      const after = basisLine({
        ...countedFigures,
        count: 50,
        verifiedCount: 0,
        unverifiedCount: 50,
        histogram: [10, 10, 10, 10, 10],
      });

      expect(after).toBe(before);
      expect(after).toBe('No reviews counted: none is a verified purchase from an attestor this app trusts');
    });

    it('keeps two counted reviews unchanged when many unverified reviews are added', () => {
      const twoReviews = bucket({
        orders: 2,
        buyers: 2,
        sumBuyerMeans: 9,
        weightedSum: 9,
        weightTotal: 2,
        histogram: [0, 0, 0, 1, 1],
        sellerBuyers: 2,
        sumSellerBuyerMeans: 9,
      });
      const countedFigures = { buckets: { [TEST_TRUSTED_ATTESTOR.pubky]: twoReviews }, scoped: twoReviews };
      const before = basisLine({
        ...countedFigures,
        count: 2,
        verifiedCount: 2,
        unverifiedCount: 0,
        histogram: [0, 0, 0, 1, 1],
      });
      const after = basisLine({
        ...countedFigures,
        count: 52,
        verifiedCount: 2,
        unverifiedCount: 50,
        histogram: [10, 10, 10, 10, 12],
      });

      expect(after).toBe(before);
      expect(after).toBe('2 reviews counted: verified purchases from attestors this app trusts');
    });

    it('words the count line for a single counted review', () => {
      const oneReview = bucket({
        orders: 1,
        buyers: 1,
        sumBuyerMeans: 5,
        weightedSum: 5,
        weightTotal: 1,
        histogram: [0, 0, 0, 0, 1],
        sellerBuyers: 1,
        sumSellerBuyerMeans: 5,
      });

      expect(
        basisLine({
          buckets: { [TEST_TRUSTED_ATTESTOR.pubky]: oneReview },
          scoped: oneReview,
          count: 9,
          verifiedCount: 1,
          unverifiedCount: 8,
        }),
      ).toBe('1 review counted: a verified purchase from an attestor this app trusts');
    });

    it('keeps legacy text unchanged when unfiltered reviews raise the total and move the average', () => {
      function legacyText(count: number, avg: number): string | null {
        reputation.value = rated({
          count,
          avg,
          verifiedCount: 3,
          histogram: [0, 0, 0, 0, count],
          attestors: { [TEST_TRUSTED_ATTESTOR.pubky]: 3 },
        });
        const { container, unmount } = render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);
        const text = container.textContent;
        unmount();
        return text;
      }

      const before = legacyText(3, 3.1);
      const after = legacyText(300, 4.9);

      expect(after).toBe(before);
      expect(after).not.toContain('300');
      expect(after).not.toContain('4.9');
      expect(after).toBe('No rating yet3 reviews verified by attestors this app trusts, not yet rated on their own');
    });

    it('shows no legacy rating without a trusted attestor', () => {
      reputation.value = rated({ count: 50, verifiedCount: 0, attestors: {} });

      render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);

      expect(screen.getByTestId('marketplace-reputation-seller-rating')).toHaveTextContent('No rating yet');
      expect(screen.getByText('No reviews verified by an attestor this app trusts')).toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });
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

  describe('weighted line', () => {
    const weighted = bucket({ buyers: 3, sumBuyerMeans: 13.8, weightedSum: 22.5, weightTotal: 5 });

    it('adds a secondary "Weighted by purchase value" line when the buckets carry weights', () => {
      reputation.value = rated({ buckets: { [TEST_TRUSTED_ATTESTOR.pubky]: weighted }, scoped: weighted });
      reputation.ratedListings = 2;

      render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);

      expect(screen.getByTestId('marketplace-reputation-weighted')).toHaveTextContent(
        'Weighted by purchase value: 4.5',
      );
      expect(screen.getByTestId('marketplace-reputation-seller-rating')).toHaveTextContent('4.7seller rating');
      expect(screen.getByTestId('marketplace-reputation-products')).toHaveTextContent('Products rated 4.6');
    });

    it('shows it on the compact variant too, from the card rule over summed buckets', () => {
      reputation.value = rated({ buckets: { [TEST_TRUSTED_ATTESTOR.pubky]: weighted } });

      render(<MarketplaceReputationHeader sellerPubky={SELLER} />);

      expect(screen.getByTestId('marketplace-reputation-weighted')).toHaveTextContent(
        'Weighted by purchase value: 4.5',
      );
    });

    it('shows none for buckets of an index without weights, or reviews without a price_decade', () => {
      reputation.value = rated({ buckets: { [TEST_TRUSTED_ATTESTOR.pubky]: bucket() }, scoped: bucket() });

      render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);

      expect(screen.getByTestId('marketplace-reputation-products')).toBeVisible();
      expect(screen.queryByTestId('marketplace-reputation-weighted')).not.toBeInTheDocument();
      expect(screen.queryByText(/Weighted by purchase value/)).not.toBeInTheDocument();
    });

    it('shows none for a legacy index without buckets', () => {
      reputation.value = rated({ attestors: { [TEST_TRUSTED_ATTESTOR.pubky]: 5 } });

      render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);

      expect(screen.queryByText(/Weighted by purchase value/)).not.toBeInTheDocument();
    });

    it('shows none when nothing is counted', () => {
      reputation.value = rated({ buckets: { [UNKNOWN_ATTESTOR]: weighted } });

      render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);

      expect(screen.queryByText(/Weighted by purchase value/)).not.toBeInTheDocument();
    });
  });

  it('shows "No rating yet" when no attestor of the reviews is trusted', () => {
    reputation.value = rated({ buckets: { [UNKNOWN_ATTESTOR]: bucket() } });

    render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);

    expect(screen.getByTestId('marketplace-reputation-seller-rating')).toHaveTextContent('No rating yet');
    expect(screen.queryByTestId('marketplace-reputation-products')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(
      screen.getByText('No reviews counted: none is a verified purchase from an attestor this app trusts'),
    ).toBeVisible();
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

  it('shows no stars and no counted claim for an index without buckets', () => {
    reputation.value = rated({ attestors: { [TEST_TRUSTED_ATTESTOR.pubky]: 5 } });

    render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('marketplace-reputation-seller-rating')).toHaveTextContent('No rating yet');
    expect(screen.queryByText(/buyers/)).not.toBeInTheDocument();
    expect(screen.queryByText(/counted:/)).not.toBeInTheDocument();
  });
});

describe('MarketplaceReputationHeader under a reviewer filter', () => {
  beforeEach(() => {
    reputation.value = rated({ buckets: { [TEST_TRUSTED_ATTESTOR.pubky]: bucket() }, scoped: bucket() });
    reputation.ratedListings = 2;
  });

  const following = { kind: 'following' } as const;

  it('replaces the unfiltered figures with the matched ones and the people they come from', () => {
    render(
      <MarketplaceReputationHeader
        sellerPubky={SELLER}
        variant="full"
        filterSummary={{ state: 'ready', filter: following, matched: { buyers: 3, orders: 4, avg: 4.8 } }}
      />,
    );

    const header = screen.getByTestId('marketplace-reputation-header');
    expect(header).toHaveAttribute('data-filtered', 'true');
    expect(header).toHaveTextContent('from 3 people you follow');
    expect(screen.getByRole('img', { name: 'Rated 4.8 out of 5' })).toBeVisible();
    expect(header.textContent).not.toContain('4.7');
    expect(header.textContent).not.toContain('Weighted');
    expect(screen.queryByTestId('marketplace-reputation-products')).not.toBeInTheDocument();
  });

  it('adds the matched seller rating above the products line', () => {
    render(
      <MarketplaceReputationHeader
        sellerPubky={SELLER}
        variant="full"
        filterSummary={{
          state: 'ready',
          filter: { kind: 'wot' },
          matched: { buyers: 3, orders: 4, avg: 4.8, sellerBuyers: 2, sellerAvg: 4.2 },
        }}
      />,
    );

    expect(screen.getByTestId('marketplace-reputation-seller-rating')).toHaveTextContent(
      'seller rating from 2 people in your network',
    );
    expect(screen.getByTestId('marketplace-review-filter-rating')).toHaveTextContent(
      'products rated from 3 people in your network',
    );
    expect(screen.getByRole('img', { name: 'Rated 4.2 out of 5' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Rated 4.8 out of 5' })).toBeVisible();
  });

  it('says no reviews from them, never 0.0 and never the figure of everyone, when nobody matched', () => {
    render(
      <MarketplaceReputationHeader
        sellerPubky={SELLER}
        variant="full"
        filterSummary={{ state: 'ready', filter: following, matched: { buyers: 0, orders: 0, avg: null } }}
      />,
    );

    const header = screen.getByTestId('marketplace-reputation-header');
    expect(header).toHaveTextContent('No reviews from people you follow');
    expect(header.textContent).not.toContain('0.0');
    expect(header.textContent).not.toContain('4.7');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('holds the place while the index has not answered, and says when it cannot score the filter', () => {
    const { rerender } = render(
      <MarketplaceReputationHeader
        sellerPubky={SELLER}
        variant="full"
        filterSummary={{ state: 'loading', filter: following }}
      />,
    );
    expect(screen.getByTestId('marketplace-review-filter-rating-loading')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    rerender(
      <MarketplaceReputationHeader
        sellerPubky={SELLER}
        variant="full"
        filterSummary={{ state: 'unscored', filter: following }}
      />,
    );
    expect(screen.getByTestId('marketplace-reputation-header')).toHaveTextContent('No rating for this filter');
  });

  it('shows the unfiltered figures again once there is no filter summary', () => {
    render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" filterSummary={null} />);

    expect(screen.getByTestId('marketplace-reputation-seller-rating')).toHaveTextContent('4.7seller rating · 2 buyers');
    expect(screen.getByTestId('marketplace-reputation-header')).not.toHaveAttribute('data-filtered');
  });
});
