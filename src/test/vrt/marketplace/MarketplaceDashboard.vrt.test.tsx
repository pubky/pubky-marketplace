// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { createMarketplaceVrtAuthStore, createMarketplaceVrtCommerceController } from '@/test/mocks/marketplace-vrt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectVrtSurface, renderForVRT, VRT_DENSE_CHROME_SCREENSHOT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { MarketplaceDashboard } from '@/templates/Marketplace/MarketplaceDashboard';

const fixtures = vi.hoisted(async () => {
  const { createCommerceListingFixture, createCommerceShopFixture, COMMERCE_FIXTURE_SELLER } =
    await import('@/test/fixtures/commerce/commerce');
  const { toCommerceListingModel, toCommerceShopModel } = await import('@/test/fixtures/commerce/listing-models');

  const listings = [
    toCommerceListingModel(
      createCommerceListingFixture({
        variants: [
          { id: 'variant_42', options: { size: '42' }, quantity: 3, mediaIds: ['image_01'], enabled: true },
          { id: 'variant_43', options: { size: '43' }, quantity: 1, mediaIds: ['image_01'], enabled: true },
        ],
      }),
    ),
    toCommerceListingModel(
      createCommerceListingFixture({
        listingId: 'selvedge_jacket',
        title: 'Selvedge denim jacket',
        categoryId: 'fashion-jackets',
        sale: {
          format: 'fixed_price',
          unitPrice: { amountMinor: 8_900, currency: 'USD', exponent: 2 },
          acceptsOffers: true,
        },
      }),
    ),
    toCommerceListingModel(
      createCommerceListingFixture({
        listingId: 'rangefinder_camera',
        title: '35mm rangefinder camera',
        categoryId: 'electronics-cameras-film',
        sale: {
          format: 'auction',
          startingPrice: { amountMinor: 4_500, currency: 'USD', exponent: 2 },
          minimumIncrement: { amountMinor: 500, currency: 'USD', exponent: 2 },
          startsAt: '2026-08-19T20:00:00.000Z',
          endsAt: '2026-08-29T20:00:00.000Z',
          antiSnipingWindowSeconds: 120,
          antiSnipingExtensionSeconds: 120,
        },
      }),
    ),
    toCommerceListingModel(createCommerceListingFixture({ listingId: 'paused_boots', state: 'paused' })),
  ];

  return {
    seller: COMMERCE_FIXTURE_SELLER,
    shop: toCommerceShopModel(createCommerceShopFixture()),
    defaultShop: toCommerceShopModel(createCommerceShopFixture({ shippingPolicy: '', returnPolicy: '' })),
    listings,
    populatedMetrics: {
      activeListings: 3,
      totalInventory: 6,
      lowStock: 2,
      paidOrders: 4,
      revenue: [{ amountMinor: 51_300, currency: 'USD', exponent: 2 }],
      openOffers: 2,
    },
    populatedActionNeeded: {
      ordersToShip: 2,
      offersAwaitingReply: 2,
      expiringAuctions: 1,
      total: 5,
    },
    emptyMetrics: {
      activeListings: 0,
      totalInventory: 0,
      lowStock: 0,
      paidOrders: 0,
      revenue: [],
      openOffers: 0,
    },
    emptyActionNeeded: {
      ordersToShip: 0,
      offersAwaitingReply: 0,
      expiringAuctions: 0,
      total: 0,
    },
  };
});

const view = vi.hoisted(() => ({
  listings: [] as unknown[],
  metrics: {} as unknown,
  actionNeeded: {} as unknown,
  isLoading: false,
  shop: null as unknown,
  unfinishedDrafts: [] as Array<{ listingId: string; title: string; updatedAt: number; ageLabel: string }>,
  selling: {
    active: false,
    checking: false,
    blocked: false,
    held: false,
    source: null,
    message: null,
    sellingMessage: null,
    info: null,
  } as unknown,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/marketplace/dashboard',
}));

// The browser build has no region policy; a scene sets what the policy would say.
vi.mock('@/hooks/useSellingAvailability/useSellingAvailability', () => ({
  useSellingAvailability: () => view.selling,
}));

vi.mock('@/hooks/useSellerPaymentMethodGate/useSellerPaymentMethodGate', () => ({
  useSellerPaymentMethodGate: () => ({ isDurable: false, ready: true, reason: null }),
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: createMarketplaceVrtAuthStore({ currentUserPubky: 'y'.repeat(52) }),
}));

// The dashboard's shop query is async (it normalizes "no record" to null), so
// this mock unwraps promises into state instead of passing them through.
vi.mock('dexie-react-hooks', async () => {
  const { useEffect, useState } = await import('react');
  return {
    useLiveQuery: (querier: () => unknown, deps: unknown[] = []) => {
      const [value, setValue] = useState<unknown>(undefined);
      useEffect(() => {
        let active = true;
        Promise.resolve(querier()).then((resolved) => {
          if (active) setValue(resolved);
        });
        return () => {
          active = false;
        };
        // The querier identity changes every render; the deps array is the contract.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps);
      return value;
    },
  };
});

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    ...createMarketplaceVrtCommerceController(),
    getShop: () => Promise.resolve(view.shop),
    getOrFetchShop: () =>
      view.shop ? Promise.resolve((view.shop as { record: unknown }).record) : Promise.reject(new Error('no shop')),
    getListingsBySeller: () => Promise.resolve(view.listings),
    getMarketplaceMediaOwnerHomeserver: (_ownerPubky: unknown) => Promise.resolve(null),
    hasFullHomeserverGrant: () => true,
  },
}));

vi.mock('@/hooks/useMarketplaceSellerDashboard/useMarketplaceSellerDashboard', async () => {
  const { formatListingStock } = await vi.importActual<typeof import('@/libs/commerce/unlimited-stock')>(
    '@/libs/commerce/unlimited-stock',
  );
  return {
    useMarketplaceSellerDashboard: () => ({
      listings: view.listings,
      sellerOrders: [],
      offers: [],
      isLoading: view.isLoading,
      needsSession: false,
      sessionError: null,
      metrics: view.metrics,
      actionNeeded: view.actionNeeded,
      updateListingState: vi.fn(async () => false),
      duplicateListing: vi.fn(async () => false),
      hasUnsavedListingDraft: vi.fn(async () => null),
      unfinishedDrafts: view.unfinishedDrafts,
      discardListingDraft: vi.fn(async () => undefined),
      resumeListingDraft: vi.fn(),
      canOfferRegistration: () => true,
      listingStockLabel: (listing: {
        record: Parameters<typeof formatListingStock>[0];
        purchasableQuantity?: number | null;
      }) => formatListingStock(listing.record, listing.purchasableQuantity ?? null),
      exportCsv: async () => new TextEncoder().encode('record_uri,seller_pubky\r\n'),
    }),
  };
});

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main className="w-full py-6">{children}</main>,
}));

describe('Marketplace seller dashboard — visual regression', () => {
  beforeEach(() => {
    view.unfinishedDrafts = [];
    view.selling = {
      active: false,
      checking: false,
      blocked: false,
      held: false,
      source: null,
      message: null,
      sellingMessage: null,
      info: null,
    };
  });

  // A seller in a blocked region keeps the studio, read-only: selling is off, orders and the storefront stay.
  it.each([
    { name: 'desktop', viewport: VRT_VIEWPORT_DESKTOP },
    { name: 'mobile', viewport: VRT_VIEWPORT_MOBILE },
  ])(
    'renders the read-only studio of a seller whose shop country is blocked at $name viewport',
    async ({ name, viewport }) => {
      const { listings, populatedMetrics, populatedActionNeeded, shop } = await fixtures;
      const { evaluateCommerceAvailability } = await import('@/libs/commerce/commerce-availability');
      const { createRegionPolicy, parseRegionModes } = await import('@/libs/commerce/region-modes');
      const parsed = parseRegionModes('EU=blocked,GB=blocked,US=blocked');
      if (!parsed.ok) throw new Error(parsed.error);
      view.selling = evaluateCommerceAvailability(createRegionPolicy(parsed.entries), {
        declaredCountry: 'GB',
        client: { status: 'ready', country: 'CH' },
      });
      view.listings = listings;
      view.metrics = populatedMetrics;
      view.actionNeeded = populatedActionNeeded;
      view.isLoading = false;
      view.shop = shop;

      const screen = await renderForVRT(<MarketplaceDashboard />, { viewport });
      await vi.waitFor(() => {
        if (!screen.container.textContent?.includes('update your shop country')) {
          throw new Error('The selling notice has not rendered yet.');
        }
      });
      await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
        `dashboard-region-blocked-${name}`,
        VRT_DENSE_CHROME_SCREENSHOT,
      );
    },
  );

  it('renders populated metrics and inventory with row actions at desktop viewport', async () => {
    const { listings, populatedMetrics, populatedActionNeeded, shop } = await fixtures;
    view.listings = listings;
    view.metrics = populatedMetrics;
    view.actionNeeded = populatedActionNeeded;
    view.isLoading = false;
    view.shop = shop;
    view.unfinishedDrafts = [];

    const screen = await renderForVRT(<MarketplaceDashboard />, { viewport: VRT_VIEWPORT_DESKTOP });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'dashboard-populated-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders populated metrics and inventory at mobile viewport', async () => {
    const { listings, populatedMetrics, populatedActionNeeded, shop } = await fixtures;
    view.listings = listings;
    view.metrics = populatedMetrics;
    view.actionNeeded = populatedActionNeeded;
    view.isLoading = false;
    view.shop = shop;

    const screen = await renderForVRT(<MarketplaceDashboard />, { viewport: VRT_VIEWPORT_MOBILE });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'dashboard-populated-mobile',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  // A seller with published listings but NO shop record dead-ends buyers on
  // their shop link — the dashboard must say so and offer the setup path.
  it('renders the set-up-your-shop prompt when listings exist without a shop at desktop viewport', async () => {
    const { listings, populatedMetrics, populatedActionNeeded } = await fixtures;
    view.listings = listings;
    view.metrics = populatedMetrics;
    view.actionNeeded = populatedActionNeeded;
    view.isLoading = false;
    view.shop = null;

    const screen = await renderForVRT(<MarketplaceDashboard />, { viewport: VRT_VIEWPORT_DESKTOP });
    await vi.waitFor(() => {
      if (!screen.container.textContent?.includes('Your storefront is not set up')) {
        throw new Error('The shop prompt has not rendered yet.');
      }
    });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'dashboard-no-shop-prompt-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  // The storefront the Shop publishes by default has no policies; the
  // dashboard keeps asking for them until the seller writes one.
  it('renders the add-policies prompt for a default storefront at desktop viewport', async () => {
    const { listings, populatedMetrics, populatedActionNeeded, defaultShop } = await fixtures;
    view.listings = listings;
    view.metrics = populatedMetrics;
    view.actionNeeded = populatedActionNeeded;
    view.isLoading = false;
    view.shop = defaultShop;

    const screen = await renderForVRT(<MarketplaceDashboard />, { viewport: VRT_VIEWPORT_DESKTOP });
    await vi.waitFor(() => {
      if (!screen.container.textContent?.includes('Add your shipping and return policies')) {
        throw new Error('The policies prompt has not rendered yet.');
      }
    });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'dashboard-policies-prompt-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it.each([
    { name: 'desktop', viewport: VRT_VIEWPORT_DESKTOP },
    { name: 'mobile', viewport: VRT_VIEWPORT_MOBILE },
    { name: 'small-mobile', viewport: { width: 375, height: 812 } },
  ])('renders the new-seller empty state with one action row at $name viewport', async ({ name, viewport }) => {
    const { emptyMetrics, emptyActionNeeded, shop } = await fixtures;
    view.listings = [];
    view.metrics = emptyMetrics;
    view.actionNeeded = emptyActionNeeded;
    view.isLoading = false;
    view.shop = shop;

    const screen = await renderForVRT(<MarketplaceDashboard />, { viewport });
    const actions = screen.getByTestId('marketplace-listing-actions').element();
    const buttons = Array.from(actions.querySelectorAll('button'));
    expect(new Set(buttons.map((button) => button.getBoundingClientRect().top)).size).toBe(1);
    expect(actions.scrollWidth).toBeLessThanOrEqual(actions.clientWidth);
    expect(buttons.at(-1)!.getBoundingClientRect().right).toBeLessThanOrEqual(viewport.width);
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      `dashboard-empty-${name}`,
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders the loading state at desktop viewport', async () => {
    const { emptyMetrics, emptyActionNeeded, shop } = await fixtures;
    view.listings = [];
    view.metrics = emptyMetrics;
    view.actionNeeded = emptyActionNeeded;
    view.isLoading = true;
    view.shop = shop;

    const screen = await renderForVRT(<MarketplaceDashboard />, { viewport: VRT_VIEWPORT_DESKTOP });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'dashboard-loading-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders unfinished drafts when more than one is saved at desktop viewport', async () => {
    const { listings, populatedMetrics, populatedActionNeeded, shop } = await fixtures;
    view.listings = listings;
    view.metrics = populatedMetrics;
    view.actionNeeded = populatedActionNeeded;
    view.isLoading = false;
    view.shop = shop;
    view.unfinishedDrafts = [
      { listingId: 'draft_a', title: 'Vintage leather boots', updatedAt: 1, ageLabel: '3 min ago' },
      { listingId: 'draft_b', title: 'Untitled listing', updatedAt: 2, ageLabel: '1 hour ago' },
    ];

    const screen = await renderForVRT(<MarketplaceDashboard />, { viewport: VRT_VIEWPORT_DESKTOP });
    await vi.waitFor(() => {
      if (!screen.container.querySelector('[data-surface="listing-drafts-list"]')) {
        throw new Error('The unfinished drafts list has not rendered yet.');
      }
    });
    await expect(await expectVrtSurface('listing-drafts-list')).toMatchScreenshot(
      'dashboard-unfinished-drafts-desktop',
    );
    view.unfinishedDrafts = [];
  });
});
