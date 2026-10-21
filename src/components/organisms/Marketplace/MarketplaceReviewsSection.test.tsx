import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { PUBKY_RUNTIME_ENV_NAMES } from '@/libs/runtime-config/runtime-config.schema';
import type { CommerceIndexedReview } from '@/models/commerce/commerce.schema';
import { useAuthStore } from '@/stores/auth/auth.store';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { TEST_TRUSTED_ATTESTOR } from '@/test/fixtures/commerce/trusted-attestors';
import { setSocialHost } from '@/test-utils/social-host';
import { MarketplaceReviewsSection } from './MarketplaceReviewsSection';

const SELLER = 's'.repeat(52);
const REVIEWER = 'a'.repeat(52);

const REVIEW: CommerceIndexedReview = {
  reviewId: '8Z8CWH8NVYQY39ZEBFGKQWWEKG',
  uri: `pubky://${REVIEWER}/pub/pubky.app/marketplace/v1/reviews/8Z8CWH8NVYQY39ZEBFGKQWWEKG`,
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
  moderation: null,
  response: null,
};

const listed = vi.hoisted((): { reviews: CommerceIndexedReview[] | null } => ({ reviews: null }));

vi.mock('@/hooks/useMarketplaceReviews/useMarketplaceReviews', () => ({
  useMarketplaceReviews: () => ({
    status: 'ok',
    reviews: listed.reviews ?? [REVIEW],
    isFetching: false,
    hasMore: false,
    loadMore: vi.fn(),
  }),
}));

const reportDialog = vi.hoisted((): { review: unknown } => ({ review: null }));

vi.mock('@/organisms/DialogReportPost/DialogReportPost', () => ({
  DialogReportPost: ({ open, review }: { open: boolean; review: unknown }) => {
    reportDialog.review = review;
    return open ? <div data-testid="report-dialog" /> : null;
  },
}));

// The menu's sign-in gate is useRequireAuth's own concern; here the reader is signed in.
vi.mock('@/hooks/useRequireAuth/useRequireAuth', () => ({
  useRequireAuth: () => ({ isAuthenticated: true, requireAuth: (action: () => unknown) => action() }),
}));

// No listing lookups reach the network: a storefront entry's listing resolves to nothing unless a test says otherwise.
beforeEach(() => {
  vi.spyOn(CommerceController, 'getOrFetchListingIfFound').mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leads each review with its listing, even one no longer active', async () => {
    const lookup = vi.spyOn(CommerceController, 'getOrFetchListingIfFound').mockResolvedValue(
      createCommerceListingFixture({
        ownerPubky: SELLER,
        listingId: 'rangefinder_camera',
        title: 'Rangefinder camera',
        media: [],
        state: 'ended',
      }),
    );

    render(<MarketplaceReviewsSection sellerPubky={SELLER} />);

    expect(await screen.findByRole('link', { name: 'Rangefinder camera' })).toHaveAttribute(
      'href',
      `/marketplace/listing/${SELLER}/rangefinder_camera`,
    );
    expect(lookup).toHaveBeenCalledWith(SELLER, 'rangefinder_camera');
    expect(screen.getByText('Exactly as described.')).toBeInTheDocument();
  });

  it('keeps the review of a deleted listing intact without a strict fetch that reports the 404', async () => {
    const lookup = vi.spyOn(CommerceController, 'getOrFetchListingIfFound').mockResolvedValue(null);
    const strictFetch = vi.spyOn(CommerceController, 'fetchListing');

    render(<MarketplaceReviewsSection sellerPubky={SELLER} />);

    await vi.waitFor(() => expect(lookup).toHaveBeenCalledWith(SELLER, 'rangefinder_camera'));
    expect(strictFetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Rangefinder camera' })).not.toBeInTheDocument();
    expect(screen.getByText('Exactly as described.')).toBeInTheDocument();
  });

  it('shows no listing on a listing page', () => {
    const lookup = vi.spyOn(CommerceController, 'getOrFetchListingIfFound');

    render(<MarketplaceReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />);

    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('MarketplaceReviewsSection verification badge', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUserPubky: null });
  });

  afterEach(() => {
    listed.reviews = null;
  });

  function renderReview(overrides: Partial<CommerceIndexedReview>) {
    listed.reviews = [{ ...REVIEW, ...overrides }];
    render(<MarketplaceReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />);
  }

  it('names the trusted attestor on the badge', () => {
    renderReview({ verified: true, attestorId: TEST_TRUSTED_ATTESTOR.pubky, createdAt: '2026-10-20T12:00:00.000Z' });

    expect(screen.getByText('Verified purchase · Pubky Market')).toBeInTheDocument();
  });

  it('does not vouch for a trusted key outside its window', () => {
    renderReview({ verified: true, attestorId: TEST_TRUSTED_ATTESTOR.pubky, createdAt: '2025-12-31T23:59:59.000Z' });

    expect(screen.getByText('Attested (unrecognized attestor)')).toBeInTheDocument();
    expect(screen.queryByText(/Verified purchase/)).not.toBeInTheDocument();
  });

  it("does not vouch for a review backdated into a retired key's window", () => {
    const envName = PUBKY_RUNTIME_ENV_NAMES.marketplaceTrustedAttestors;
    const suiteValue = process.env[envName];
    process.env[envName] = JSON.stringify([{ ...TEST_TRUSTED_ATTESTOR, validUntil: '2026-10-12' }]);
    resetRuntimeConfigForTests();
    try {
      renderReview({ verified: true, attestorId: TEST_TRUSTED_ATTESTOR.pubky, createdAt: '2026-09-15T12:00:00.000Z' });

      expect(screen.getByText('Attested (unrecognized attestor)')).toBeInTheDocument();
      expect(screen.queryByText(/Verified purchase/)).not.toBeInTheDocument();
    } finally {
      process.env[envName] = suiteValue;
      resetRuntimeConfigForTests();
    }
  });

  it('labels a valid signature from an unlisted key as unrecognized', () => {
    renderReview({ verified: true, attestorId: 'x'.repeat(52), createdAt: '2026-10-20T12:00:00.000Z' });

    expect(screen.getByText('Attested (unrecognized attestor)')).toBeInTheDocument();
  });

  it('labels an unverified review from a trusted key as unverified', () => {
    renderReview({ verified: false, attestorId: TEST_TRUSTED_ATTESTOR.pubky, createdAt: '2026-10-20T12:00:00.000Z' });

    expect(screen.getByText('Unverified')).toBeInTheDocument();
  });
});

describe('MarketplaceReviewsSection moderation', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUserPubky: null });
  });

  afterEach(() => {
    listed.reviews = null;
  });

  it('keeps the stars of a review whose text moderation hid and shows the reason instead of the text', () => {
    listed.reviews = [
      { ...REVIEW, ratingOverall: 2, text: '', moderation: { state: 'text_hidden', reason: 'hatespeech' } },
    ];
    render(<MarketplaceReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />);

    expect(screen.getByText('Hidden by Pubky Market moderation · Reason: Hate speech')).toBeInTheDocument();
    expect(screen.getByLabelText('Rated 2.0 out of 5')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-reviews-not-counted')).not.toBeInTheDocument();
  });

  it('shows the neutral reason for a moderator label this build does not know', () => {
    listed.reviews = [{ ...REVIEW, text: '', moderation: { state: 'text_hidden', reason: 'new_label' } }];
    render(<MarketplaceReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />);

    expect(
      screen.getByText('Hidden by Pubky Market moderation · Reason: Breaks the Pubky Market rules'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/new_label/)).not.toBeInTheDocument();
  });

  it('never shows text on a moderated review, even if the index sent some', () => {
    listed.reviews = [{ ...REVIEW, moderation: { state: 'text_hidden', reason: 'hatespeech' } }];
    render(<MarketplaceReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />);

    expect(screen.queryByText('Exactly as described.')).not.toBeInTheDocument();
  });

  it('puts an excluded review in the not-counted group, after the counted ones', () => {
    listed.reviews = [
      {
        ...REVIEW,
        reviewId: '8Z8CWH8NVYQY39ZEBFGKQWWEKH',
        text: '',
        moderation: { state: 'excluded', reason: 'review_fraud' },
      },
      REVIEW,
    ];
    render(<MarketplaceReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />);

    const group = screen.getByTestId('marketplace-reviews-not-counted');
    expect(within(group).getByText('1 not counted')).toBeInTheDocument();
    expect(within(group).getByText('Excluded by Pubky Market moderation (fraud)')).toBeInTheDocument();
    expect(within(group).queryByText('Exactly as described.')).not.toBeInTheDocument();
    const items = document.querySelectorAll('[data-cy="marketplace-review-item"]');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Exactly as described.');
    expect(group).toContainElement(items[1] as HTMLElement);
  });

  it('shows only the not-counted group when every review is excluded', () => {
    listed.reviews = [{ ...REVIEW, text: '', moderation: { state: 'excluded', reason: 'review_fraud' } }];
    render(<MarketplaceReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />);

    expect(screen.getByText('1 not counted')).toBeInTheDocument();
    expect(screen.queryByText('No reviews yet')).not.toBeInTheDocument();
  });

  it('treats a review the index sent without a moderation field as not moderated', () => {
    const { moderation: _omitted, ...legacy } = REVIEW;
    listed.reviews = [legacy as CommerceIndexedReview];
    render(<MarketplaceReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />);

    expect(screen.getByText('Exactly as described.')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-review-moderated')).not.toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-reviews-not-counted')).not.toBeInTheDocument();
  });
});

describe('MarketplaceReviewsSection Report review', () => {
  afterEach(() => {
    listed.reviews = null;
  });

  it('offers Report review in the review menu and opens the report dialog with the review as its target', async () => {
    useAuthStore.setState({ currentUserPubky: 'r'.repeat(52) });
    const user = userEvent.setup();
    render(<MarketplaceReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />);

    await user.click(screen.getByRole('button', { name: 'Review actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Report review' }));

    expect(await screen.findByTestId('report-dialog')).toBeInTheDocument();
    expect(reportDialog.review).toEqual({
      reviewUri: REVIEW.uri,
      reviewerPubky: REVIEWER,
      sellerPubky: SELLER,
      listingId: 'rangefinder_camera',
    });
  });

  it("doesn't offer the reviewer a report of their own review", () => {
    useAuthStore.setState({ currentUserPubky: REVIEWER });
    render(<MarketplaceReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />);

    expect(screen.queryByRole('button', { name: 'Review actions' })).not.toBeInTheDocument();
  });
});
