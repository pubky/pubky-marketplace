import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommerceIndexedReviewsResult, CommerceSellerReputationOverview } from '@/application/commerce/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { TagController } from '@/controllers/tag/tag';
import type {
  CommerceIndexedReview,
  CommerceReputationBucket,
  CommerceReviewMatch,
} from '@/models/commerce/commerce.schema';
import { useAuthStore } from '@/stores/auth/auth.store';
import { TEST_TRUSTED_ATTESTOR } from '@/test/fixtures/commerce/trusted-attestors';
import { ReviewsSection, ReviewsWithHeader } from '@/test-utils/marketplace-reviews';

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
  useRequireAuth: () => ({ isAuthenticated: true, requireAuth: (action: () => unknown) => action() }),
}));

const SELLER = 's'.repeat(52);
const VIEWER = 'v'.repeat(52);
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

const EVERYONE = [review('e1', 'Everyone one.', 3), review('e2', 'Everyone two.', 5)];
const FOLLOWED = [review('f1', 'Followed one.', 5), review('f2', 'Followed two.', 4)];

function page(
  reviews: CommerceIndexedReview[],
  options: { filterApplied?: boolean; matched?: CommerceReviewMatch | null; sortApplied?: boolean } = {},
): CommerceIndexedReviewsResult {
  return {
    status: 'ok',
    reviews,
    sortApplied: options.sortApplied ?? false,
    filterApplied: options.filterApplied ?? false,
    matched: options.matched ?? null,
  };
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

const headerText = () => screen.getByTestId('marketplace-reputation-header').textContent;
const listed = () =>
  [...document.querySelectorAll('[data-cy="marketplace-review-item"]')].map((item) => item.textContent ?? '');
const seller = vi.mocked(CommerceController.fetchSellerReviews);

describe('review filter chips with the real list and header', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.setPointerCapture = vi.fn();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
    useAuthStore.setState({ currentUserPubky: VIEWER });
    vi.mocked(CommerceController.fetchSellerReputation).mockResolvedValue(overview);
    vi.mocked(CommerceController.getCatalogEntriesBySeller).mockResolvedValue([]);
    vi.mocked(CommerceController.getOrFetchListingIfFound).mockResolvedValue(null);
    vi.spyOn(TagController, 'getViewerUserTagLabels').mockResolvedValue([]);
  });

  it('offers no chips to a signed-out visitor, and never sends a viewer', async () => {
    useAuthStore.setState({ currentUserPubky: null });
    seller.mockResolvedValue(page(EVERYONE));

    render(<ReviewsSection sellerPubky={SELLER} />);
    await screen.findByText('Everyone one.');

    expect(screen.queryByTestId('marketplace-reviews-filter')).not.toBeInTheDocument();
    expect(seller.mock.calls.every(([, request]) => request?.filter === undefined)).toBe(true);
  });

  it('changes the header to the matched figure on a chip, and the order of the list on a sort without touching the header', async () => {
    seller.mockResolvedValueOnce(page(EVERYONE));
    const user = userEvent.setup();
    render(<ReviewsWithHeader sellerPubky={SELLER} />);
    await screen.findByText('Everyone one.');
    await screen.findByTestId('marketplace-reputation-weighted');
    const unfiltered = headerText();
    expect(unfiltered).toContain('seller rating · 2 buyers');

    seller.mockResolvedValueOnce(page(FOLLOWED, { filterApplied: true, matched: { buyers: 3, orders: 4, avg: 4.8 } }));
    await user.click(screen.getByRole('radio', { name: 'People I follow' }));

    await screen.findByText('Followed one.');
    await waitFor(() => expect(headerText()).toContain('from 3 people you follow'));
    expect(screen.getByTestId('marketplace-reputation-header')).toHaveAttribute('data-filtered', 'true');
    expect(screen.getByRole('img', { name: 'Rated 4.8 out of 5' })).toBeVisible();
    expect(seller.mock.lastCall?.[1]).toMatchObject({ skip: 0, filter: { viewerId: VIEWER, reach: 'following' } });
    const filtered = headerText();

    seller.mockResolvedValueOnce(
      page(FOLLOWED, { filterApplied: true, sortApplied: true, matched: { buyers: 3, orders: 4, avg: 4.8 } }),
    );
    await user.click(screen.getByRole('combobox', { name: 'Sort reviews' }));
    await user.click(await screen.findByRole('option', { name: 'Highest rated' }));
    await waitFor(() => expect(seller.mock.lastCall?.[1]).toMatchObject({ sort: 'rating_desc' }));
    await screen.findByText('Followed one.');

    expect(headerText()).toBe(filtered);
    expect(seller.mock.lastCall?.[1]).toMatchObject({ filter: { viewerId: VIEWER, reach: 'following' } });

    seller.mockResolvedValueOnce(page(EVERYONE, { sortApplied: true }));
    await user.click(screen.getByRole('radio', { name: 'People I follow' }));
    await screen.findByText('Everyone one.');
    await waitFor(() => expect(headerText()).toBe(unfiltered));
  });

  it('says no reviews from people you follow, never 0.0, when nobody matched, with the list empty', async () => {
    seller.mockResolvedValueOnce(page(EVERYONE));
    const user = userEvent.setup();
    render(<ReviewsWithHeader sellerPubky={SELLER} />);
    await screen.findByText('Everyone one.');

    seller.mockResolvedValueOnce(page([], { filterApplied: true, matched: { buyers: 0, orders: 0, avg: null } }));
    await user.click(screen.getByRole('radio', { name: 'People I follow' }));

    await waitFor(() => expect(headerText()).toContain('No reviews from people you follow'));
    expect(headerText()).not.toContain('0.0');
    expect(headerText()).not.toContain('4.5');
    expect(screen.getByTestId('marketplace-reviews-filter-notice')).toHaveTextContent('No reviews match this filter.');
    expect(screen.getByRole('button', { name: 'Show all reviews' })).toBeInTheDocument();
    expect(screen.getByTestId('marketplace-reviews-filter')).toBeInTheDocument();
  });

  it('shows the index message on a 400 and does not fall back to the full list', async () => {
    seller.mockResolvedValueOnce(page(EVERYONE));
    const user = userEvent.setup();
    render(<ReviewsSection sellerPubky={SELLER} />);
    await screen.findByText('Everyone one.');

    seller.mockResolvedValueOnce({ status: 'rejected' });
    await user.click(screen.getByRole('radio', { name: 'My network' }));

    await screen.findByText(/could not apply this filter/);
    expect(listed()).toEqual([]);
    expect(screen.getByRole('radio', { name: 'My network' })).toBeChecked();
    expect(seller).toHaveBeenCalledTimes(2);
  });

  it('hides the chips and keeps the full list, without an error, on an index that ignores the filters', async () => {
    seller.mockResolvedValueOnce(page(EVERYONE));
    const user = userEvent.setup();
    render(<ReviewsSection sellerPubky={SELLER} />);
    await screen.findByText('Everyone one.');

    seller.mockResolvedValueOnce(page(EVERYONE, { filterApplied: false }));
    await user.click(screen.getByRole('radio', { name: 'People I follow' }));

    await waitFor(() => expect(screen.queryByTestId('marketplace-reviews-filter')).not.toBeInTheDocument());
    expect(listed()).toHaveLength(2);
    expect(screen.queryByText(/Could not filter/)).not.toBeInTheDocument();
    expect(sessionStorage.getItem('marketplace:reviews:filters-unsupported')).toBe('1');
  });

  it('discards the late answer of a chip the viewer already left', async () => {
    seller.mockResolvedValueOnce(page(EVERYONE));
    const user = userEvent.setup();
    render(<ReviewsWithHeader sellerPubky={SELLER} />);
    await screen.findByText('Everyone one.');

    let answerFollowing: (result: CommerceIndexedReviewsResult) => void = () => undefined;
    seller.mockReturnValueOnce(
      new Promise((resolve) => {
        answerFollowing = resolve;
      }),
    );
    seller.mockResolvedValueOnce(
      page([review('w1', 'Network one.', 4)], { filterApplied: true, matched: { buyers: 1, orders: 1, avg: 4 } }),
    );
    await user.click(screen.getByRole('radio', { name: 'People I follow' }));
    await user.click(screen.getByRole('radio', { name: 'My network' }));
    await screen.findByText('Network one.');

    await act(async () => {
      answerFollowing(page(FOLLOWED, { filterApplied: true, matched: { buyers: 3, orders: 4, avg: 4.8 } }));
    });

    expect(listed()).toEqual([expect.stringContaining('Network one.')]);
    expect(headerText()).toContain('from 1 person in your network');
    expect(screen.queryByText('Followed one.')).not.toBeInTheDocument();
  });
});
