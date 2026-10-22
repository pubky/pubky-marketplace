import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommerceIndexedReviewsResult, CommerceSellerReputationOverview } from '@/application/commerce/commerce';
import { MARKETPLACE_REVIEWS_PAGE_SIZE } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { CommerceIndexedReview, CommerceReputationBucket } from '@/models/commerce/commerce.schema';
import { useAuthStore } from '@/stores/auth/auth.store';
import { TEST_TRUSTED_ATTESTOR } from '@/test/fixtures/commerce/trusted-attestors';
import { MarketplaceReputationHeader } from './MarketplaceReputationHeader';
import { MarketplaceReviewsSection } from './MarketplaceReviewsSection';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    fetchSellerReviews: vi.fn(),
    fetchListingReviews: vi.fn(),
    fetchSellerReputation: vi.fn(),
    getCatalogEntriesBySeller: vi.fn(),
    getOrFetchListingIfFound: vi.fn(),
  },
}));

vi.mock('@/hooks/useRequireAuth/useRequireAuth', () => ({
  useRequireAuth: () => ({ isAuthenticated: false, requireAuth: (action: () => unknown) => action() }),
}));

const SELLER = 's'.repeat(52);
const REVIEWER = 'a'.repeat(52);

function review(reviewId: string, text: string, ratingOverall: number): CommerceIndexedReview {
  return {
    reviewId,
    uri: `pubky://${REVIEWER}/pub/pubky.app/marketplace/v1/reviews/${reviewId}`,
    reviewerId: REVIEWER,
    subjectId: SELLER,
    listingOwnerId: SELLER,
    listingId: 'boots_01',
    role: 'buyer_reviewing_seller',
    ratingOverall,
    text,
    verified: true,
    attestorId: TEST_TRUSTED_ATTESTOR.pubky,
    editedLate: false,
    createdAt: '2026-10-20T12:00:00.000Z',
    updatedAt: '2026-10-20T12:00:00.000Z',
    revision: 1,
    moderation: null,
    response: null,
  };
}

const NEWEST = [review('n1', 'Newest review.', 3), review('n2', 'Older review.', 5)];
const BY_RATING = [review('n2', 'Older review.', 5), review('n1', 'Newest review.', 3)];

function reviews(list: CommerceIndexedReview[], sortApplied: boolean): CommerceIndexedReviewsResult {
  return { status: 'ok', reviews: list, sortApplied };
}

const seconds = (iso: string) => Date.parse(iso) / 1000;
const bucket: CommerceReputationBucket = {
  orders: 4,
  buyers: 3,
  sumBuyerMeans: 13.8,
  weightedSum: 22.5,
  weightTotal: 5,
  histogram: [0, 0, 0, 2, 3],
  firstIat: seconds('2026-10-01T00:00:00Z'),
  lastIat: seconds('2026-10-19T00:00:00Z'),
  sellerBuyers: 2,
  sumSellerBuyerMeans: 9.4,
};
const overview: CommerceSellerReputationOverview = {
  status: 'rated',
  summary: {
    count: 6,
    verifiedCount: 5,
    avg: 4.5,
    histogram: [0, 0, 1, 1, 4],
    responseCount: 0,
    editedLateCount: 0,
    attestors: {},
    lastReviewedAt: null,
    buckets: { [TEST_TRUSTED_ATTESTOR.pubky]: bucket },
    scoped: bucket,
  },
};

function headerText() {
  return screen.getByTestId('marketplace-reputation-header').textContent;
}

describe('review sort next to the reputation header', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.setPointerCapture = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ currentUserPubky: null });
    vi.mocked(CommerceController.fetchSellerReputation).mockResolvedValue(overview);
    vi.mocked(CommerceController.getCatalogEntriesBySeller).mockResolvedValue([]);
    vi.mocked(CommerceController.getOrFetchListingIfFound).mockResolvedValue(null);
  });

  it('reorders the list for a signed-out visitor and leaves every header figure as it was', async () => {
    vi.mocked(CommerceController.fetchSellerReviews).mockResolvedValueOnce(reviews(NEWEST, false));
    const user = userEvent.setup();
    render(
      <>
        <MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />
        <MarketplaceReviewsSection sellerPubky={SELLER} />
      </>,
    );
    await screen.findByText('Newest review.');
    await screen.findByTestId('marketplace-reputation-weighted');
    const before = headerText();
    expect(before).toContain('seller rating · 2 buyers');
    expect(before).toContain('Weighted by purchase value: 4.5');
    expect(vi.mocked(CommerceController.fetchSellerReviews).mock.calls[0][1]).toEqual({
      skip: 0,
      limit: MARKETPLACE_REVIEWS_PAGE_SIZE,
      sort: undefined,
    });

    vi.mocked(CommerceController.fetchSellerReviews).mockResolvedValueOnce(reviews(BY_RATING, true));
    await user.click(screen.getByRole('combobox', { name: 'Sort reviews' }));
    await user.click(await screen.findByRole('option', { name: 'Highest rated' }));

    await waitFor(() =>
      expect(
        [...document.querySelectorAll('[data-cy="marketplace-review-item"]')].map((item) => item.textContent),
      ).toEqual([expect.stringContaining('Older review.'), expect.stringContaining('Newest review.')]),
    );
    expect(vi.mocked(CommerceController.fetchSellerReviews).mock.lastCall?.[1]).toEqual({
      skip: 0,
      limit: MARKETPLACE_REVIEWS_PAGE_SIZE,
      sort: 'rating_desc',
    });
    expect(headerText()).toBe(before);
    expect(CommerceController.fetchSellerReputation).toHaveBeenCalledTimes(1);
  });

  it('falls back to Newest and drops the control, without an error, on an index that ignores the sort', async () => {
    vi.mocked(CommerceController.fetchSellerReviews).mockResolvedValueOnce(reviews(NEWEST, false));
    const user = userEvent.setup();
    render(<MarketplaceReviewsSection sellerPubky={SELLER} />);
    await screen.findByText('Newest review.');

    vi.mocked(CommerceController.fetchSellerReviews).mockResolvedValueOnce(reviews(NEWEST, false));
    await user.click(screen.getByRole('combobox', { name: 'Sort reviews' }));
    await user.click(await screen.findByRole('option', { name: 'Lowest rated' }));

    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Sort reviews' })).not.toBeInTheDocument());
    expect(screen.getByText('Newest review.')).toBeInTheDocument();
    expect(screen.queryByText(/Could not sort/)).not.toBeInTheDocument();
    expect(screen.getByTestId('marketplace-reviews-section')).toBeInTheDocument();
  });
});
