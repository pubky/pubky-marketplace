// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { createMarketplaceVrtCommerceController } from '@/test/mocks/marketplace-vrt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { MarketplaceListingCard } from '@/organisms/Marketplace/MarketplaceListingCard';
import { MarketplaceReputationHeader } from '@/organisms/Marketplace/MarketplaceReputationHeader';
import { ReviewsSection } from '@/test-utils/marketplace-reviews';
import { useAuthStore } from '@/stores/auth/auth.store';
import { setSocialHost } from '@/test-utils/social-host';
import { TEST_TRUSTED_ATTESTOR } from '@/test/fixtures/commerce/trusted-attestors';

// The Phase 2 public review surfaces in every honest state: stars on catalog
// cards (only when the index reported reviews; counted per-buyer means from
// trusted attestor buckets), the rating header (rated / "New seller" / the
// RV2 seller headline / "No seller rating yet" / "No rating yet"), and the
// review list, counted reviews first, with the D5 labeling spectrum —
// verified-by-trusted-attestor, attested-by-unrecognized-signer, unverified —
// plus the D7 subject response threaded beneath and the subject's composer,
// moderated reviews (hidden text, the not-counted group) and the Report
// review dialog.

/** The attestor the mocked runtime trust list holds, labelled "Pubky Market". */
const TRUSTED_ATTESTOR = TEST_TRUSTED_ATTESTOR.pubky;
const SELLER = 's'.repeat(52);
const BUYER_A = 'a'.repeat(52);
const BUYER_B = 'b'.repeat(52);
const BUYER_C = 'c'.repeat(52);

const controllerState = vi.hoisted(() => ({
  reputation: { status: 'unavailable' } as unknown,
  reviews: [] as unknown[],
  ownResponse: null as unknown,
  listing: null as unknown,
  catalogEntries: [] as unknown[],
  outcomes: new Map<string, { kind: 'refunded' | 'returned'; on: string }[]>(),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    ...createMarketplaceVrtCommerceController(),
    fetchSellerReputation: vi.fn(async () => controllerState.reputation),
    fetchSellerReviews: vi.fn(async (_seller: string, page: { sort?: string }) => ({
      status: 'ok',
      reviews: controllerState.reviews,
      sortApplied: page.sort !== undefined,
    })),
    fetchListingReviews: vi.fn(async (_seller: string, _listing: string, page: { sort?: string }) => ({
      status: 'ok',
      reviews: controllerState.reviews,
      sortApplied: page.sort !== undefined,
    })),
    fetchReviewOutcomes: vi.fn(async () => controllerState.outcomes),
    getOwnMarketplaceReviewResponse: vi.fn(async () => controllerState.ownResponse),
    getOrFetchListingIfFound: vi.fn(async () => controllerState.listing),
    getCatalogEntriesBySeller: vi.fn(async () => controllerState.catalogEntries),
    // The scenes render real MarketplaceListingCards against the real auth
    // store (one scene signs the seller in), so the cards' watch toggle
    // reaches the controller: keep the favorite statics on the mock.
    isFavorite: () => Promise.resolve(false),
    commitCreateFavorite: () => Promise.resolve(),
    commitDeleteFavorite: () => Promise.resolve(),
  },
}));

vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => {
  const { TEST_TRUSTED_ATTESTOR } = await import('@/test/fixtures/commerce/trusted-attestors');
  return {
    ...(await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>()),
    getMarketplaceTrustedAttestors: () => [TEST_TRUSTED_ATTESTOR],
  };
});

vi.mock('@/hooks/useCurrentUserProfile/useCurrentUserProfile', () => ({
  useCurrentUserProfile: () => ({ currentUserPubky: 'r'.repeat(52), userDetails: { name: 'VRT Reporter' } }),
}));

vi.mock('@/hooks/useRequireAuth/useRequireAuth', () => ({
  useRequireAuth: () => ({ isAuthenticated: true, requireAuth: (action: () => void) => action() }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/marketplace',
}));

// Deterministic BTC/USD rate and media, as in the other card VRTs.
vi.mock('@/hooks/useIndicativeBtcRate/useIndicativeBtcRate', () => ({
  useIndicativeBtcRate: (enabled: boolean) =>
    enabled ? { satUsd: 0.001, btcUsd: 100_000, lastUpdatedAt: new Date('2026-08-21T00:00:00Z') } : null,
}));
vi.mock('@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl', async () => {
  const { createMarketplaceMediaHooks } = await import('@/test/mocks/marketplace-media-hooks');
  return createMarketplaceMediaHooks(() => null);
});
vi.mock('@/hooks/useMarketplaceLiveBid/useMarketplaceLiveBid', () => ({
  useMarketplaceLiveBid: () => ({ ref: () => {}, bid: null }),
}));

function indexedReview(overrides: Record<string, unknown> = {}) {
  const reviewId = (overrides.reviewId as string | undefined) ?? '8Z8CWH8NVYQY39ZEBFGKQWWEKG';
  const reviewerId = (overrides.reviewerId as string | undefined) ?? BUYER_A;
  return {
    reviewId,
    uri: `pubky://${reviewerId}/pub/pubky.app/marketplace/v1/reviews/${reviewId}`,
    reviewerId,
    subjectId: SELLER,
    listingOwnerId: SELLER,
    listingId: 'rangefinder_camera',
    role: 'buyer_reviewing_seller' as const,
    ratingOverall: 5,
    text: 'Exactly as described and shipped the same day.',
    verified: true,
    attestorId: TRUSTED_ATTESTOR,
    editedLate: false,
    createdAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
    revision: 1,
    moderation: null,
    response: null,
    ...overrides,
  };
}

const REVIEW_SPECTRUM = [
  indexedReview(),
  indexedReview({
    reviewId: '8Z8CWH8NVYQY39ZEBFGKQWWEKH',
    reviewerId: BUYER_B,
    ratingOverall: 4,
    text: 'Solid seller, packaging could be sturdier.',
    attestorId: 'x'.repeat(52),
    response: {
      responderId: SELLER,
      text: 'Thanks — switched to double-boxing since this order.',
      createdAt: '2026-08-11T09:00:00.000Z',
      updatedAt: '2026-08-11T09:00:00.000Z',
      revision: 1,
    },
  }),
  indexedReview({
    reviewId: '8Z8CWH8NVYQY39ZEBFGKQWWEKJ',
    reviewerId: BUYER_C,
    ratingOverall: 2,
    text: 'Item arrived late.',
    verified: false,
    attestorId: null,
    editedLate: true,
  }),
];

// A counted review, one whose text moderation hid (stars kept, reason
// shown), and one excluded as fraud in the not-counted group.
const MODERATED_REVIEWS = [
  indexedReview(),
  indexedReview({
    reviewId: '8Z8CWH8NVYQY39ZEBFGKQWWEKH',
    reviewerId: BUYER_B,
    ratingOverall: 1,
    text: '',
    verified: false,
    attestorId: null,
    moderation: { state: 'text_hidden', reason: 'hatespeech' },
  }),
  indexedReview({
    reviewId: '8Z8CWH8NVYQY39ZEBFGKQWWEKJ',
    reviewerId: BUYER_C,
    ratingOverall: 5,
    text: '',
    verified: false,
    attestorId: null,
    moderation: { state: 'excluded', reason: 'review_fraud' },
  }),
];

const ORDER_REF = 'ab'.repeat(32);

/** An attested review with the attested order's reference, the key of its attestor's annotation. */
const ATTESTED_REVIEW = indexedReview({ orderRef: ORDER_REF });

function annotate(outcomes: { kind: 'refunded' | 'returned'; on: string }[]) {
  controllerState.outcomes = new Map([[`${TRUSTED_ATTESTOR}:${ORDER_REF}`, outcomes]]);
}

const ratedSummary = {
  status: 'rated',
  summary: {
    count: 3,
    verifiedCount: 2,
    avg: 3.7,
    histogram: [0, 1, 0, 1, 1],
    responseCount: 1,
    editedLateCount: 1,
    attestors: { [TRUSTED_ATTESTOR]: 1, ['x'.repeat(52)]: 1 },
  },
};

const UNRECOGNIZED_ATTESTOR = 'x'.repeat(52);

/** One attestor's IX2 bucket; the iat range sits inside the trusted window. */
function trustBucket(overrides: Record<string, unknown> = {}) {
  return {
    orders: 4,
    buyers: 3,
    sumBuyerMeans: 13.8,
    weightedSum: 18,
    weightTotal: 4,
    histogram: [0, 0, 0, 2, 2] as [number, number, number, number, number],
    firstIat: Date.parse('2026-08-01T00:00:00Z') / 1000,
    lastIat: Date.parse('2026-08-10T00:00:00Z') / 1000,
    sellerBuyers: 3,
    sumSellerBuyerMeans: 14.1,
    ...overrides,
  };
}

// IX2: the trusted attestor's bucket (and the scoped figure built from its
// window) drives the RV2 headline; the unrecognized signer's is not counted.
const countedSummary = {
  status: 'rated',
  summary: {
    count: 5,
    verifiedCount: 5,
    avg: 4.2,
    histogram: [0, 1, 0, 2, 2],
    responseCount: 0,
    editedLateCount: 0,
    attestors: { [TRUSTED_ATTESTOR]: 4, [UNRECOGNIZED_ATTESTOR]: 1 },
    unverifiedCount: 0,
    buckets: {
      [TRUSTED_ATTESTOR]: trustBucket(),
      [UNRECOGNIZED_ATTESTOR]: trustBucket({ orders: 1, buyers: 1, sumBuyerMeans: 2, sellerBuyers: 1 }),
    },
    scoped: trustBucket(),
  },
};

// Every counted buyer weighs 1 (reviews without a price_decade claim, or an
// index before weights): the same figures with no weighted line.
const unweightedSummary = {
  status: 'rated',
  summary: {
    ...countedSummary.summary,
    buckets: { [TRUSTED_ATTESTOR]: trustBucket({ weightedSum: 13.8, weightTotal: 3 }) },
    scoped: trustBucket({ weightedSum: 13.8, weightTotal: 3 }),
  },
};

// Every counted review predates the seller questions.
const legacyOnlySummary = {
  status: 'rated',
  summary: {
    ...countedSummary.summary,
    buckets: { [TRUSTED_ATTESTOR]: trustBucket({ sellerBuyers: 0, sumSellerBuyerMeans: 0 }) },
    scoped: trustBucket({ sellerBuyers: 0, sumSellerBuyerMeans: 0 }),
  },
};

// Reviews exist, but none from an attestor this app trusts.
const untrustedSummary = {
  status: 'rated',
  summary: {
    ...countedSummary.summary,
    count: 2,
    verifiedCount: 1,
    unverifiedCount: 1,
    attestors: { [UNRECOGNIZED_ATTESTOR]: 1 },
    buckets: { [UNRECOGNIZED_ATTESTOR]: trustBucket({ orders: 1, buyers: 1, sumBuyerMeans: 5 }) },
    scoped: trustBucket({
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
    }),
  },
};

/** Two cached listings of the seller, each with counted buyers. */
async function ratedCatalogEntries() {
  const { createCommerceCatalogEntryFixture } = await import('@/test/fixtures/commerce/commerce');
  const bucket = trustBucket({ orders: 2, buyers: 2, sumBuyerMeans: 9, sellerBuyers: null, sumSellerBuyerMeans: null });
  return ['rangefinder_camera', 'light_meter'].map((listingId) =>
    createCommerceCatalogEntryFixture({
      id: `${SELLER}:${listingId}`,
      seller_id: SELLER,
      listing_id: listingId,
      listing_reputation: { avg: 4.5, count: 2, verifiedCount: 2, buckets: { [TRUSTED_ATTESTOR]: bucket } },
    }),
  );
}

const cardFixtures = vi.hoisted(async () => {
  const { catalogItemFromCatalogEntry } = await import('@/hooks/useMarketplaceCatalog/useMarketplaceCatalog.utils');
  const { createCommerceCatalogEntryFixture } = await import('@/test/fixtures/commerce/commerce');
  const rated = catalogItemFromCatalogEntry(
    createCommerceCatalogEntryFixture({
      id: `${'s'.repeat(52)}:rangefinder_camera`,
      seller_id: 's'.repeat(52),
      listing_id: 'rangefinder_camera',
      title: '35mm rangefinder camera',
      description: 'Recently serviced mechanical rangefinder with bright optics.',
      category_id: 'electronics-cameras-film',
      condition: 'excellent',
      tags: ['film', 'camera'],
      sale_format: 'fixed_price',
      media_urls: [],
      price: { amountMinor: 4_500, currency: 'USD', exponent: 2 },
      auction: null,
      listing_reputation: { avg: 4.7, count: 12, verifiedCount: 9 },
      updated_at: Date.parse('2026-08-19T21:02:00.000Z'),
    }),
  );
  // A seller the index holds no reviews for: the card shows NO stars at all
  // (absence, never 0.0).
  const unrated = catalogItemFromCatalogEntry(
    createCommerceCatalogEntryFixture({
      id: `${'u'.repeat(52)}:silver_signet`,
      seller_id: 'u'.repeat(52),
      listing_id: 'silver_signet',
      title: 'Brutalist silver signet',
      description: 'Solid recycled silver ring cast and finished by hand.',
      category_id: 'fashion-jewelry-rings',
      condition: 'new',
      tags: ['silver', 'handmade'],
      sale_format: 'fixed_price',
      media_urls: [],
      price: { amountMinor: 12_000, currency: 'USD', exponent: 2 },
      auction: null,
      reputation: null,
      updated_at: Date.parse('2026-08-19T21:06:00.000Z'),
    }),
  );
  return { rated, unrated };
});

/**
 * IX2 cards: one whose trusted bucket sits inside the trust window (counted
 * per-buyer mean with its basis), one whose bucket starts before the window
 * opened, so the window cuts it and nothing is counted.
 */
async function countedCardFixtures() {
  const { catalogItemFromCatalogEntry } = await import('@/hooks/useMarketplaceCatalog/useMarketplaceCatalog.utils');
  const { createCommerceCatalogEntryFixture } = await import('@/test/fixtures/commerce/commerce');
  const card = (listingId: string, title: string, bucket: ReturnType<typeof trustBucket>) =>
    catalogItemFromCatalogEntry(
      createCommerceCatalogEntryFixture({
        id: `${SELLER}:${listingId}`,
        seller_id: SELLER,
        listing_id: listingId,
        title,
        description: 'Recently serviced mechanical rangefinder with bright optics.',
        category_id: 'electronics-cameras-film',
        condition: 'excellent',
        tags: ['film', 'camera'],
        sale_format: 'fixed_price',
        media_urls: [],
        price: { amountMinor: 4_500, currency: 'USD', exponent: 2 },
        auction: null,
        listing_reputation: { avg: 4.2, count: 5, verifiedCount: 5, buckets: { [TRUSTED_ATTESTOR]: bucket } },
        updated_at: Date.parse('2026-08-19T21:02:00.000Z'),
      }),
    );
  return {
    counted: card('rangefinder_camera', '35mm rangefinder camera', trustBucket()),
    cut: card(
      'light_meter',
      'Selenium light meter',
      trustBucket({ firstIat: Date.parse('2025-12-20T00:00:00Z') / 1000 }),
    ),
  };
}

beforeEach(async () => {
  const { useMarketplaceDisplayStore } = await import('@/stores/marketplace-display/marketplace-display.store');
  useMarketplaceDisplayStore.setState({ showFxEstimate: true, measurementSystem: 'metric' });
  useAuthStore.setState({ currentUserPubky: null });
  controllerState.reputation = { status: 'unavailable' };
  controllerState.reviews = [];
  controllerState.ownResponse = null;
  controllerState.listing = null;
  controllerState.catalogEntries = [];
  controllerState.outcomes = new Map();
});

async function waitForText(fragment: string) {
  await vi.waitFor(() => {
    if (!document.body.textContent?.includes(fragment)) throw new Error(`"${fragment}" has not rendered yet.`);
  });
}

describe('Marketplace public reviews — visual regression', () => {
  it('renders a rated card with stars next to an unrated card without any at desktop viewport', async () => {
    const { rated, unrated } = await cardFixtures;
    const screen = await renderForVRT(
      <div className="grid grid-cols-4 gap-5 p-6">
        <MarketplaceListingCard listing={rated} shopName="Proof of Film" />
        <MarketplaceListingCard listing={unrated} shopName="Low Time Preference" />
      </div>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('listing-cards-reputation-desktop');
  });

  it('renders the full rating header with its verified basis line at desktop viewport', async () => {
    controllerState.reputation = ratedSummary;
    const screen = await renderForVRT(
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-10">
        <MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await waitForText('verified by the marketplace attestor');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reputation-header-rated-full-desktop');
  });

  it('renders counted card stars with their buyer basis next to a card whose bucket the window cuts at desktop viewport', async () => {
    const { counted, cut } = await countedCardFixtures();
    const screen = await renderForVRT(
      <div className="grid grid-cols-4 gap-5 p-6">
        <MarketplaceListingCard listing={counted} shopName="Proof of Film" />
        <MarketplaceListingCard listing={cut} shopName="Proof of Film" />
      </div>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true },
    );
    await waitForText('3 buyers · 4 orders');
    await waitForText('No rating yet');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('listing-cards-counted-desktop');
  });

  it('renders the RV2 seller rating headline and the products line at desktop viewport', async () => {
    controllerState.reputation = countedSummary;
    controllerState.catalogEntries = await ratedCatalogEntries();
    const screen = await renderForVRT(
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-10">
        <MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await waitForText('seller rating · 3 buyers');
    await waitForText('across 2 listings');
    await waitForText('Weighted by purchase value: 4.5');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reputation-header-counted-full-desktop');
  });

  it('renders no weighted line when the counted buckets carry no purchase-value weights at desktop viewport', async () => {
    controllerState.reputation = unweightedSummary;
    controllerState.catalogEntries = await ratedCatalogEntries();
    const screen = await renderForVRT(
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-10">
        <MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await waitForText('seller rating · 3 buyers');
    await waitForText('across 2 listings');
    expect(document.body.textContent).not.toContain('Weighted by purchase value');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reputation-header-unweighted-full-desktop');
  });

  it('renders the RV2 seller rating headline at mobile viewport', async () => {
    controllerState.reputation = countedSummary;
    controllerState.catalogEntries = await ratedCatalogEntries();
    const screen = await renderForVRT(
      <main className="flex w-full flex-col gap-6 px-4 py-8">
        <MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />
      </main>,
      { viewport: VRT_VIEWPORT_MOBILE },
    );
    await waitForText('across 2 listings');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reputation-header-counted-full-mobile');
  });

  it('renders "No seller rating yet" for a seller with only legacy reviews at desktop viewport', async () => {
    controllerState.reputation = legacyOnlySummary;
    controllerState.catalogEntries = await ratedCatalogEntries();
    const screen = await renderForVRT(
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-10">
        <MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await waitForText('No seller rating yet');
    await waitForText('across 2 listings');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reputation-header-legacy-only-desktop');
  });

  it('renders "No rating yet" when no review is from a trusted attestor at desktop viewport', async () => {
    controllerState.reputation = untrustedSummary;
    const screen = await renderForVRT(
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-10">
        <MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await waitForText('No rating yet');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reputation-header-none-trusted-desktop');
  });

  it('renders the explicit new-seller state at desktop viewport', async () => {
    controllerState.reputation = { status: 'new_seller' };
    const screen = await renderForVRT(
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-10">
        <MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await waitForText('New seller');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reputation-header-new-seller-desktop');
  });

  it('renders the D5 labeling spectrum with a threaded response at desktop viewport', async () => {
    controllerState.reviews = REVIEW_SPECTRUM;
    const screen = await renderForVRT(
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
        <ReviewsSection sellerPubky={SELLER} />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await waitForText('Verified purchase');
    await waitForText('Attested (unrecognized attestor)');
    await waitForText('Unverified');
    await waitForText('switched to double-boxing');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reviews-section-spectrum-desktop');
  });

  it('links reviewers to their shop with a Profile on Pubky link under social link-out at desktop viewport', async () => {
    controllerState.reviews = REVIEW_SPECTRUM;
    setSocialHost('https://pubky.app');
    try {
      const screen = await renderForVRT(
        <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
          <ReviewsSection sellerPubky={SELLER} />
        </main>,
        { viewport: VRT_VIEWPORT_DESKTOP },
      );
      await waitForText('Verified purchase');
      await expect
        .element(screen.getByRole('link', { name: `${BUYER_A.slice(0, 8)}…` }))
        .toHaveAttribute('href', `/marketplace/shop/${BUYER_A}`);
      await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reviews-section-social-linkout-desktop');
    } finally {
      setSocialHost(undefined);
    }
  });

  it('renders the sort control with a chosen order above the list at desktop viewport', async () => {
    controllerState.reviews = REVIEW_SPECTRUM;
    const screen = await renderForVRT(
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
        <ReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await waitForText('Verified purchase');
    await screen.getByRole('combobox', { name: 'Sort reviews' }).click();
    await screen.getByRole('option', { name: 'Highest rated' }).click();
    await vi.waitFor(() => {
      const trigger = document.querySelector('[data-testid="marketplace-reviews-sort"]');
      if (trigger?.textContent !== 'Highest rated') throw new Error('The sort has not been chosen yet.');
    });
    await waitForText('Verified purchase');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reviews-section-sort-chosen-desktop');
  });

  it('renders the sort control above the list at mobile viewport', async () => {
    controllerState.reviews = REVIEW_SPECTRUM;
    const screen = await renderForVRT(
      <main className="flex w-full flex-col gap-6 px-4 py-8">
        <ReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />
      </main>,
      { viewport: VRT_VIEWPORT_MOBILE },
    );
    await waitForText('Verified purchase');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reviews-section-sort-mobile');
  });

  it('renders the review list at mobile viewport', async () => {
    controllerState.reviews = REVIEW_SPECTRUM;
    const screen = await renderForVRT(
      <main className="flex w-full flex-col gap-6 px-4 py-8">
        <ReviewsSection sellerPubky={SELLER} />
      </main>,
      { viewport: VRT_VIEWPORT_MOBILE },
    );
    await waitForText('Verified purchase');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reviews-section-spectrum-mobile');
  });

  it('leads each storefront review with its listing, two orders of one listing as two entries, at mobile viewport', async () => {
    const { createCommerceListingFixture } = await import('@/test/fixtures/commerce/commerce');
    controllerState.listing = createCommerceListingFixture({
      ownerPubky: SELLER,
      listingId: 'rangefinder_camera',
      title: '35mm rangefinder camera',
      media: [],
    });
    controllerState.reviews = [
      indexedReview({
        reviewId: '8Z8CWH8NVYQY39ZEBFGKQWWEKK',
        ratingOverall: 1,
        text: 'Second order arrived damaged.',
        createdAt: '2026-08-12T12:00:00.000Z',
        updatedAt: '2026-08-12T12:00:00.000Z',
      }),
      indexedReview(),
    ];
    const screen = await renderForVRT(
      <main className="flex w-full flex-col gap-6 px-4 py-8">
        <ReviewsSection sellerPubky={SELLER} />
      </main>,
      { viewport: VRT_VIEWPORT_MOBILE },
    );
    await waitForText('35mm rangefinder camera');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reviews-section-storefront-listing-mobile');
  });

  it('renders a Refunded note beside a verified review at desktop viewport', async () => {
    controllerState.reviews = [ATTESTED_REVIEW];
    annotate([{ kind: 'refunded', on: '2026-10-14' }]);
    const screen = await renderForVRT(
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
        <ReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await waitForText('Refunded');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reviews-section-outcome-refunded-desktop');
  });

  it('renders a Returned note beside a verified review at desktop viewport', async () => {
    controllerState.reviews = [ATTESTED_REVIEW];
    annotate([{ kind: 'returned', on: '2026-10-12' }]);
    const screen = await renderForVRT(
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
        <ReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await waitForText('Returned');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reviews-section-outcome-returned-desktop');
  });

  it('renders both notes beside a verified review at desktop viewport', async () => {
    controllerState.reviews = [ATTESTED_REVIEW];
    annotate([
      { kind: 'refunded', on: '2026-10-14' },
      { kind: 'returned', on: '2026-10-12' },
    ]);
    const screen = await renderForVRT(
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
        <ReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await waitForText('Refunded');
    await waitForText('Returned');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reviews-section-outcome-both-desktop');
  });

  it('renders both notes beside a verified review at mobile viewport', async () => {
    controllerState.reviews = [ATTESTED_REVIEW];
    annotate([
      { kind: 'refunded', on: '2026-10-14' },
      { kind: 'returned', on: '2026-10-12' },
    ]);
    const screen = await renderForVRT(
      <main className="flex w-full flex-col gap-6 px-4 py-8">
        <ReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />
      </main>,
      { viewport: VRT_VIEWPORT_MOBILE },
    );
    await waitForText('Refunded');
    await waitForText('Returned');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reviews-section-outcome-both-mobile');
  });

  it('renders a moderated review and the not-counted group at desktop viewport', async () => {
    controllerState.reviews = MODERATED_REVIEWS;
    const screen = await renderForVRT(
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
        <ReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await waitForText('Hidden by Pubky Market moderation · Reason: Hate speech');
    await waitForText('Excluded by Pubky Market moderation (fraud)');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reviews-section-moderation-desktop');
  });

  it('renders a moderated review and the not-counted group at mobile viewport', async () => {
    controllerState.reviews = MODERATED_REVIEWS;
    const screen = await renderForVRT(
      <main className="flex w-full flex-col gap-6 px-4 py-8">
        <ReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />
      </main>,
      { viewport: VRT_VIEWPORT_MOBILE },
    );
    await waitForText('Excluded by Pubky Market moderation (fraud)');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reviews-section-moderation-mobile');
  });

  it('renders the Report review dialog with the review reasons at desktop viewport', async () => {
    controllerState.reviews = [indexedReview()];
    const screen = await renderForVRT(
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
        <ReviewsSection sellerPubky={SELLER} listingId="rangefinder_camera" />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await waitForText('Verified purchase');
    await screen.getByRole('button', { name: 'Review actions' }).click();
    await screen.getByRole('menuitem', { name: 'Report review' }).click();
    await vi.waitFor(() => {
      if (!document.querySelector('[role="dialog"]')) throw new Error('Report dialog has not opened yet.');
    });
    await waitForText('Fake or fraudulent review');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reviews-section-report-dialog-desktop');
  });

  it('renders the empty review list honestly at desktop viewport', async () => {
    controllerState.reviews = [];
    const screen = await renderForVRT(
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
        <ReviewsSection sellerPubky={SELLER} />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await waitForText('No reviews yet');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reviews-section-empty-desktop');
  });

  it('renders the subject respond affordance and open composer at desktop viewport', async () => {
    controllerState.reviews = [indexedReview()];
    useAuthStore.setState({ currentUserPubky: SELLER });
    const screen = await renderForVRT(
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
        <ReviewsSection sellerPubky={SELLER} />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await waitForText('Respond');
    await screen.getByRole('button', { name: 'Respond' }).click();
    await vi.waitFor(() => {
      if (!document.querySelector('[data-cy="marketplace-review-response-composer"]')) {
        throw new Error('Composer has not opened yet.');
      }
    });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('reviews-section-composer-desktop');
  });
});
