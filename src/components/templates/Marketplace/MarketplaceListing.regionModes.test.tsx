import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMERCE_BLOCKED_INFO,
  COMMERCE_BLOCKED_MESSAGE,
  COMMERCE_UNKNOWN_REGION_MESSAGE,
  PAID_UNLOCKS_BLOCKED_MESSAGE,
  SELLING_BLOCKED_COUNTRY_MESSAGE,
} from '@/libs/commerce/region-modes';
import type { CommerceReputationSnippet } from '@/models/commerce/commerce.schema';
import type { MarketplaceOffer } from '@/services/marketplace/marketplace';
import type { GrantSigner } from '@/stores/auth/auth.types';
import {
  COMMERCE_FIXTURE_SELLER,
  createCommerceListingFixture,
  createCommerceShopFixture,
} from '@/test/fixtures/commerce/commerce';
import { toCommerceListingModel, toCommerceShopModel } from '@/test/fixtures/commerce/listing-models';
import { createOrderFixture } from '@/test/fixtures/commerce/orders';
import { createListingProjectionFixture } from '@/test/fixtures/commerce/projections';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
import { MarketplaceListing } from './MarketplaceListing';

const cartAdd = vi.hoisted(() => vi.fn());
const publicAvailabilityRead = vi.hoisted(() => vi.fn());
const paymentBadgesRead = vi.hoisted(() => vi.fn());
const projectionRefresh = vi.hoisted(() => vi.fn());
const confirmRemovedCalls = vi.hoisted(() => vi.fn());
const listingRating = vi.hoisted((): { value: CommerceReputationSnippet | null | 'unavailable' | undefined } => ({
  value: null,
}));
const authState = vi.hoisted(() => ({
  currentUserPubky: 'b'.repeat(52) as string | null,
  session: { grant: {} },
  hasProfile: true,
  isRestoringSession: false,
  isLoggingOut: false,
  grantSigner: 'ring' as GrantSigner,
  setShowSignInDialog: vi.fn(),
}));
const sessionState = vi.hoisted(() => ({
  pubky: null as string | null,
}));

const view = vi.hoisted(() => ({
  listing: null as ReturnType<typeof toCommerceListingModel> | null,
  shop: null as ReturnType<typeof toCommerceShopModel> | null,
  projection: null as ReturnType<typeof createListingProjectionFixture> | null,
  projectionError: null as string | null,
  listingRemoved: false,
  fetchFailure: null as unknown,
  confirmedRemoved: false as boolean | Error,
  needsSession: false,
  publicStock: null as 'available' | 'reserved' | 'sold' | null,
  publicStockFailure: false,
  publicStockVariants: undefined as { variantId: string; soldOut: boolean }[] | undefined,
  hasFullHomeserverGrant: true,
  orders: [] as Array<{ order: ReturnType<typeof createOrderFixture> }>,
  offers: [] as MarketplaceOffer[],
}));

vi.mock('@/hooks/useMarketplaceCartCount/useMarketplaceCartCount', () => ({ useMarketplaceCartCount: () => 0 }));
vi.mock('@/hooks/useMarketplaceActivityUnread/useMarketplaceActivityUnread', () => ({
  useMarketplaceActivityUnread: () => 0,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/marketplace/listing/seller/item',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/config/commerce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/commerce')>();
  return { ...actual, getCommerceAdapterMode: () => 'transaction-service' };
});

vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>()),
  getMarketplaceGrantFlowEnabled: () => true,
}));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (querier: () => unknown) => querier(),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getListing: () => view.listing,
    getShop: () => view.shop,
    refreshShopOrGetCached: () => Promise.resolve(null),
    getOrFetchListing: () => (view.fetchFailure === null ? Promise.resolve(null) : Promise.reject(view.fetchFailure)),
    isListingConfirmedRemoved: (_seller: string, _listing: string, fetchError: unknown) => {
      confirmRemovedCalls(fetchError);
      return view.confirmedRemoved instanceof Error
        ? Promise.reject(view.confirmedRemoved)
        : Promise.resolve(view.confirmedRemoved);
    },
    getSellerAnnualLimit: vi.fn(async () => ({ enabled: false })),
    setBuyerCountry: vi.fn(),
    getPublicListingAvailability: publicAvailabilityRead,
    fetchSellerPaymentBadges: paymentBadgesRead,
    hasFullHomeserverGrant: () => view.hasFullHomeserverGrant,
    canRegisterListings: () => false,
    ensureListingRegistered: vi.fn(async () => {}),
  },
}));

const sessionConnect = vi.hoisted(() => ({ onConnected: undefined as (() => void) | undefined }));

vi.mock('@/hooks/useMarketplaceSessionConnect/useMarketplaceSessionConnect', () => ({
  useMarketplaceSessionConnect: (options: { onConnected?: () => void }) => {
    sessionConnect.onConnected = options.onConnected;
    return {
      status: 'awaiting',
      authorizationUrl: 'pubkyauth://signin_grant?caps=%2Fpub%2Fpubky.app%2Fmarketplace-service%2Fv1%2F%3Arw',
      errorMessage: null,
      requestsFullGrant: false,
      requestsGrantReconnect: false,
      requestsGrantBootstrap: true,
      requestsPassport: false,
      approvalSigner: authState.grantSigner === 'ring' ? 'Pubky Ring' : 'your signer',
      start: vi.fn(),
      cancel: vi.fn(),
      copyAuthUrl: vi.fn(async () => {}),
      openInRing: vi.fn(),
      isOpeningRing: false,
    };
  },
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: Object.assign((selector: (state: typeof authState) => unknown) => selector(authState), {
    getState: () => authState,
  }),
}));

vi.mock('@/hooks/useCommerceFavorite/useCommerceFavorite', () => ({
  useCommerceFavorite: () => ({ isFavorite: false, isMutating: false, toggle: vi.fn() }),
}));

vi.mock('@/hooks/useMarketplaceCart/useMarketplaceCart', () => ({
  useMarketplaceCart: () => ({
    items: [],
    itemCount: 0,
    subtotals: [],
    isLoading: false,
    add: cartAdd,
    update: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  }),
}));

vi.mock('@/services/marketplace/marketplace-session', () => ({
  MarketplaceSessionService: {
    getActiveSession: () => (sessionState.pubky ? { pubky: sessionState.pubky } : null),
  },
}));

vi.mock('@/hooks/useMarketplaceOffers/useMarketplaceOffers', () => ({
  useMarketplaceOffers: () => ({
    offers: view.offers,
    isLoading: false,
    error: null,
    needsSession: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/hooks/useMarketplaceOrders/useMarketplaceOrders', () => ({
  useMarketplaceOrders: () => ({
    orders: view.orders,
    isLoading: false,
    error: null,
    needsSession: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/hooks/useMarketplaceProjection/useMarketplaceProjection', () => ({
  useMarketplaceProjection: () => ({
    projection: view.projection,
    isLoading: false,
    error: view.projectionError,
    listingRemoved: view.listingRemoved,
    needsSession: view.needsSession,
    refresh: projectionRefresh,
  }),
}));

vi.mock('@/hooks/useMarketplaceReviews/useMarketplaceReviews', () => ({
  useListingRating: () => listingRating.value,
  useMarketplaceReviews: () => ({ filterSummary: null }),
}));

vi.mock('@/hooks/useMeasurementSystem/useMeasurementSystem', () => ({
  useMeasurementSystem: () => 'metric',
}));

vi.mock('@/hooks/useIndicativeBtcRate/useIndicativeBtcRate', () => ({
  useIndicativeBtcRate: () => null,
}));

vi.mock('@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl', async () => {
  return await import('@/test/mocks/marketplace-media-hooks');
});

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/organisms/Marketplace/MarketplaceCommunityTags', () => ({
  MarketplaceCommunityTags: () => null,
}));

vi.mock('@/organisms/Marketplace/MarketplaceListingSavePicker', () => ({
  MarketplaceListingSavePicker: () => null,
}));

vi.mock('@/organisms/Marketplace/MarketplaceMessageDialog', () => ({
  MarketplaceMessageDialog: () => <button type="button">Message seller</button>,
}));

vi.mock('@/organisms/Marketplace/MarketplaceReviewsSection', () => ({
  MarketplaceReviewsSection: () => <section aria-label="Reviews" />,
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
});

describe('MarketplaceListing under the region modes', () => {
  beforeEach(() => {
    resetRegionState();
    view.listing = toCommerceListingModel(createCommerceListingFixture());
    view.shop = toCommerceShopModel(createCommerceShopFixture());
    view.projection = createListingProjectionFixture();
    view.projectionError = null;
    view.listingRemoved = false;
    view.fetchFailure = null;
    view.confirmedRemoved = false;
    confirmRemovedCalls.mockClear();
    view.needsSession = false;
    view.publicStock = null;
    view.publicStockFailure = false;
    view.publicStockVariants = undefined;
    publicAvailabilityRead.mockReset();
    publicAvailabilityRead.mockImplementation(async () =>
      view.publicStockFailure
        ? Promise.reject(new Error('offline'))
        : view.publicStock
          ? {
              aggregateId: 'listing:x',
              state: view.publicStock,
              serverTime: '2026-10-13T07:45:00.000Z',
              ...(view.publicStockVariants ? { variants: view.publicStockVariants } : {}),
            }
          : null,
    );
    paymentBadgesRead.mockReset();
    paymentBadgesRead.mockResolvedValue([]);
    view.hasFullHomeserverGrant = true;
    view.orders = [];
    view.offers = [];
    sessionState.pubky = null;
    listingRating.value = null;
    cartAdd.mockClear();
    projectionRefresh.mockClear();
    authState.currentUserPubky = 'b'.repeat(52);
    authState.grantSigner = 'ring';
    authState.setShowSignInDialog.mockClear();
    view.shop = toCommerceShopModel(createCommerceShopFixture({ location: { countryCode: 'CH' } }));
  });

  afterEach(() => {
    cleanup();
    resetRegionState();
  });

  const renderListing = () => {
    const listing = view.listing;
    if (!listing) throw new Error('Expected listing fixture');
    render(<MarketplaceListing sellerPubky={listing.seller_id} listingId={listing.listing_id} />);
    return listing;
  };

  const buyButton = () => screen.getByRole('button', { name: 'Buy' });
  const acceptingOffers = () =>
    toCommerceListingModel(
      createCommerceListingFixture({
        sale: {
          format: 'fixed_price',
          unitPrice: { amountMinor: 12_500, currency: 'USD', exponent: 2 },
          acceptsOffers: true,
        },
      }),
    );

  it('replaces Buy and Make offer with the one line and an info icon for a visitor in a blocked region', async () => {
    setRegionModes('EU=blocked,GB=blocked,US=blocked');
    stubClientRegion('US');
    view.listing = acceptingOffers();
    renderListing();

    expect(await screen.findByTestId('marketplace-listing-blocked')).toHaveTextContent(COMMERCE_BLOCKED_MESSAGE);
    expect(buyButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Make offer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'About this limit' })).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-listing-region')).not.toBeInTheDocument();
  });

  it('shows the info text behind the icon', async () => {
    const user = userEvent.setup();
    setRegionModes('EU=blocked,GB=blocked,US=blocked');
    stubClientRegion('DE');
    renderListing();

    await user.click(await screen.findByRole('button', { name: 'About this limit' }));
    expect(await screen.findByTestId('info-hint-content')).toHaveTextContent(COMMERCE_BLOCKED_INFO);
  });

  it('keeps the listing readable: price, title and the watchlist stay', async () => {
    setRegionModes('EU=blocked,GB=blocked,US=blocked');
    stubClientRegion('GB');
    renderListing();

    await screen.findByTestId('marketplace-listing-blocked');
    expect(screen.getByRole('heading', { level: 1, name: 'Vintage leather boots' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to watchlist' })).toBeEnabled();
  });

  it('keeps Buy off, silently, while the visitor region is still being read', () => {
    setRegionModes('EU=blocked,GB=blocked,US=blocked');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    renderListing();

    expect(buyButton()).toBeDisabled();
    expect(screen.queryByTestId('marketplace-listing-blocked')).not.toBeInTheDocument();
  });

  it('lets a visitor from an open country buy and make an offer', async () => {
    setRegionModes('EU=blocked,GB=blocked,US=blocked');
    const fetchStub = stubClientRegion('CH');
    view.listing = acceptingOffers();
    renderListing();

    await waitFor(() => expect(buyButton()).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Make offer' })).toBeEnabled();
    expect(screen.queryByTestId('marketplace-listing-blocked')).not.toBeInTheDocument();
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('blocks a visitor whose location is unknown with the unknown-region line', async () => {
    setRegionModes('EU=blocked,GB=blocked,US=blocked');
    stubClientRegion(null);
    renderListing();

    expect(await screen.findByTestId('marketplace-listing-blocked')).toHaveTextContent(COMMERCE_UNKNOWN_REGION_MESSAGE);
    expect(buyButton()).toBeDisabled();
  });

  it('blocks buying from a seller whose shop is in a blocked country', async () => {
    setRegionModes('EU=blocked,GB=blocked,US=blocked');
    stubClientRegion('CH');
    view.shop = toCommerceShopModel(createCommerceShopFixture({ location: { countryCode: 'US' } }));
    view.listing = acceptingOffers();
    renderListing();

    expect(await screen.findByTestId('marketplace-listing-blocked')).toHaveTextContent(SELLING_BLOCKED_COUNTRY_MESSAGE);
    expect(buyButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Make offer' })).toBeDisabled();
  });

  it('names paid unlocks on a digital-only listing', async () => {
    setRegionModes('EU=blocked,GB=blocked,US=blocked');
    stubClientRegion('US');
    view.listing = toCommerceListingModel(
      createCommerceListingFixture({ fulfillmentMethods: ['digital'], package: undefined, shippingOptions: [] }),
    );
    view.projection = createListingProjectionFixture({
      fulfillmentMethods: ['digital'],
      digitalDelivery: { kind: 'file', contentType: 'application/pdf', sizeBytes: 12_582_912 },
    });
    renderListing();

    expect(await screen.findByTestId('marketplace-listing-blocked')).toHaveTextContent(PAID_UNLOCKS_BLOCKED_MESSAGE);
    expect(buyButton()).toBeDisabled();
  });

  it('replaces the bid button of an auction', async () => {
    setRegionModes('EU=blocked,GB=blocked,US=blocked');
    stubClientRegion('US');
    view.listing = toCommerceListingModel(
      createCommerceListingFixture({
        sale: {
          format: 'auction',
          startingPrice: { amountMinor: 5_000, currency: 'USD', exponent: 2 },
          startsAt: '2026-10-01T00:00:00.000Z',
          endsAt: '2099-01-01T00:00:00.000Z',
        } as never,
      }),
    );
    renderListing();

    expect(await screen.findByTestId('marketplace-listing-blocked')).toHaveTextContent(COMMERCE_BLOCKED_MESSAGE);
    expect(screen.getByRole('button', { name: 'Place a bid' })).toBeDisabled();
  });

  it('shows the owner of the listing no blocked line', async () => {
    setRegionModes('EU=blocked,GB=blocked,US=blocked');
    stubClientRegion('US');
    authState.currentUserPubky = COMMERCE_FIXTURE_SELLER;
    renderListing();

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    expect(screen.queryByTestId('marketplace-listing-blocked')).not.toBeInTheDocument();
  });

  it('is unchanged, and reads no region, while every region is open', async () => {
    const fetchStub = stubClientRegion('US');
    for (const modes of [undefined, 'none']) {
      setRegionModes(modes);
      view.listing = acceptingOffers();
      renderListing();
      await waitFor(() => expect(buyButton()).toBeEnabled());
      expect(screen.queryByTestId('marketplace-listing-blocked')).not.toBeInTheDocument();
      cleanup();
    }
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("keeps today's country prompt for nuanced regions and reads no region", async () => {
    setRegionModes('EU=nuanced,GB=nuanced');
    const fetchStub = stubClientRegion('US');
    renderListing();

    expect(await screen.findByTestId('marketplace-listing-region')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-listing-blocked')).not.toBeInTheDocument();
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
