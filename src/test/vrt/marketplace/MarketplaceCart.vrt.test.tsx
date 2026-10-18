// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseContractFaithfulOffer } from '@/test/fixtures/commerce/offer-award';
import { expectVrtSurface, parkVrtHover, renderForVRT, VRT_DENSE_CHROME_SCREENSHOT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { MarketplaceCart } from '@/templates/Marketplace/MarketplaceCart';

// Deterministic BTC/USD rate for the capture (1 BTC = $100,000): the "≈"
// estimates render from this fixed value, never from the network.
vi.mock('@/hooks/useIndicativeBtcRate/useIndicativeBtcRate', () => ({
  useIndicativeBtcRate: (enabled: boolean) =>
    enabled ? { satUsd: 0.001, btcUsd: 100_000, lastUpdatedAt: new Date('2026-08-21T00:00:00Z') } : null,
}));

// Cart rows show the listing's cover photo (record media order, first image);
// a deterministic data-URI keeps the capture free of network fetches.
const MEDIA_DATA_URL = vi.hoisted(
  () =>
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGN4UaKEFTEMLQkAgnNfgXMIh2kAAAAASUVORK5CYII=',
);

vi.mock('@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl', async () => {
  const { createMarketplaceMediaHooks } = await import('@/test/mocks/marketplace-media-hooks');
  return createMarketplaceMediaHooks((uri) => (uri ? MEDIA_DATA_URL : null));
});

const fixtures = vi.hoisted(async () => {
  const { createCommerceListingFixture } = await import('@/test/fixtures/commerce/commerce');
  const { toCommerceListingModel } = await import('@/test/fixtures/commerce/listing-models');

  const otherSeller = 'n'.repeat(52);
  const boots = toCommerceListingModel(
    createCommerceListingFixture({
      variants: [
        { id: 'variant_42', options: { size: '42' }, quantity: 3, mediaIds: ['image_01'], enabled: true },
        { id: 'variant_43', options: { size: '43' }, quantity: 1, mediaIds: ['image_01'], enabled: true },
      ],
    }),
  );
  const jacket = toCommerceListingModel(
    createCommerceListingFixture({
      listingId: 'selvedge_jacket',
      title: 'Selvedge denim jacket',
      categoryId: 'fashion-jackets',
      condition: 'excellent',
      variants: [{ id: 'variant_01', options: { size: 'M' }, quantity: 2, mediaIds: ['image_01'], enabled: true }],
      sale: {
        format: 'fixed_price',
        unitPrice: { amountMinor: 8_900, currency: 'USD', exponent: 2 },
        acceptsOffers: true,
      },
    }),
  );
  const camera = toCommerceListingModel(
    createCommerceListingFixture({
      ownerPubky: otherSeller,
      listingId: 'rangefinder_camera',
      title: '35mm rangefinder camera',
      categoryId: 'electronics-cameras-film',
      condition: 'excellent',
      variants: [{ id: 'variant_01', options: {}, quantity: 1, mediaIds: ['image_01'], enabled: true }],
      sale: {
        format: 'fixed_price',
        unitPrice: { amountMinor: 4_500, currency: 'USD', exponent: 2 },
        acceptsOffers: false,
      },
    }),
  );

  const locksTrack = toCommerceListingModel(
    createCommerceListingFixture({
      listingId: 'field_recordings',
      title: 'Field recordings archive (digital)',
      categoryId: 'collectibles-music-vinyl',
      condition: 'new',
      fulfillmentMethods: ['digital'],
      package: undefined,
      shippingOptions: [],
      variants: [{ id: 'variant_01', options: {}, quantity: 5, mediaIds: ['image_01'], enabled: true }],
      digitalLock: {
        policyUri: `pubky://${'s'.repeat(52)}/pub/locks.app/policies/field_recordings.json`,
        criterionId: 'criterion-1',
        contentPath: 'field_recordings/archive.zip',
        resourceHash: 'a'.repeat(64),
        minimumConfirmations: 3,
      },
    }),
  );

  const item = (listing: ReturnType<typeof toCommerceListingModel>, variantId: string, quantity: number) => ({
    id: `${listing.id}:${variantId}`,
    listingId: listing.id,
    variantId,
    quantity,
    listing,
  });

  return {
    singleSeller: [item(boots, 'variant_42', 1), item(boots, 'variant_43', 1)],
    multiSeller: [item(boots, 'variant_42', 2), item(jacket, 'variant_01', 1), item(camera, 'variant_01', 1)],
    locksOnly: [item(locksTrack, 'variant_01', 1)],
    locksWithShipped: [item(boots, 'variant_42', 1), item(locksTrack, 'variant_01', 1)],
    staleItem: [item(boots, 'variant_42', 1), item(jacket, 'variant_gone', 1)],
    soldOut: [item(boots, 'variant_42', 1), item(camera, 'variant_01', 1), item(jacket, 'variant_01', 1)],
    soldOutKeys: {
      boots: `${boots.record.ownerPubky}:${boots.record.listingId}`,
      camera: `${camera.record.ownerPubky}:${camera.record.listingId}`,
    },
  };
});

interface CartItemMoneyLike {
  amountMinor: number;
  currency: string;
  exponent: number;
}

interface CartItemLike {
  quantity: number;
  variantId: string;
  pricingSource?: 'listing' | 'offer';
  listing: {
    record: {
      variants: Array<{ id: string; priceOverride?: CartItemMoneyLike }>;
      sale: { format: string; unitPrice?: CartItemMoneyLike };
    };
  };
}

const view = vi.hoisted(() => ({
  items: [] as unknown[],
  offers: [] as unknown[],
  isLoading: false,
  durable: false,
  availability: new Map<
    string,
    { state: 'available' | 'reserved' | 'sold'; variants?: Array<{ variantId: string; soldOut: boolean }> }
  >(),
}));

vi.mock('@/config/commerce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/commerce')>();
  return {
    ...actual,
    getCommerceAdapterMode: () => (view.durable ? 'transaction-service' : actual.getCommerceAdapterMode()),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/marketplace/cart',
}));

vi.mock('@/hooks/useMarketplaceCart/useMarketplaceCart', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useMarketplaceCart/useMarketplaceCart')>();
  const { sumMoneyByAsset } = await import('@/libs/commerce/pricing');
  return {
    ...actual,
    useMarketplaceCart: () => {
      const items = view.items as CartItemLike[];
      return {
        items,
        ordinaryItems: items.filter((item) => item.pricingSource !== 'offer'),
        awardItems: items.filter((item) => item.pricingSource === 'offer'),
        itemCount: items.reduce((total, item) => total + item.quantity, 0),
        subtotals: sumMoneyByAsset(
          items.flatMap((item) => {
            const variant = item.listing.record.variants.find(({ id }) => id === item.variantId);
            const price =
              variant?.priceOverride ??
              (item.listing.record.sale.format === 'fixed_price' ? item.listing.record.sale.unitPrice : null);
            return price ? [{ money: price, quantity: item.quantity }] : [];
          }),
        ),
        isLoading: view.isLoading,
        add: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
        clear: vi.fn(),
        groups: actual.groupMarketplaceCartItems(items.filter((item) => item.pricingSource !== 'offer') as never),
      };
    },
  };
});

vi.mock('@/hooks/useMarketplaceOffers/useMarketplaceOffers', () => ({
  useMarketplaceOffers: () => ({ offers: view.offers, isLoading: false, error: null, needsSession: false }),
}));

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main className="w-full py-6">{children}</main>,
}));

vi.mock('@/hooks/useMarketplaceSellerSummary/useMarketplaceSellerSummary', () => ({
  useMarketplaceSellerSummary: (sellerPubky: string, options?: { includeReputation?: boolean }) => ({
    shop: null,
    reputation: options?.includeReputation === false ? { status: 'unavailable' } : { status: 'new_seller' },
    displayName: sellerPubky === 'n'.repeat(52) ? 'Film Camera Supply' : 'Satoshi Vintage',
  }),
}));

// The display store persists to localStorage, which the VRT browser shares
// across test files — pin the defaults so captures never depend on what a
// previously-run file left behind.
beforeEach(async () => {
  const { useMarketplaceDisplayStore } = await import('@/stores/marketplace-display/marketplace-display.store');
  useMarketplaceDisplayStore.setState({ showFxEstimate: true, measurementSystem: 'metric' });
  view.offers = [];
  view.isLoading = false;
  view.durable = false;
  view.availability.clear();
  const { CommerceController } = await import('@/controllers/commerce/commerce');
  vi.spyOn(CommerceController, 'getPublicListingAvailability').mockImplementation(async (seller, listingId) => {
    const answer = view.availability.get(`${String(seller)}:${String(listingId)}`);
    return answer ? { aggregateId: 'listing:vrt', serverTime: '2026-10-16T09:00:00.000Z', ...answer } : null;
  });
});

describe('Marketplace cart — visual regression', () => {
  it('rejects a missing production surface marker', () => {
    expect(() => expectVrtSurface('missing-marketplace-cart')).toThrow(
      'no production [data-surface="missing-marketplace-cart"] root is mounted',
    );
  });

  async function captureCart(sceneName: string) {
    await parkVrtHover();
    const surface = await expectVrtSurface('marketplace-cart');
    await expect(surface).toMatchScreenshot(sceneName, VRT_DENSE_CHROME_SCREENSHOT);
  }

  function expectDesktopSummaryGeometry(viewportHeight: number) {
    const surface = document.querySelector('[data-surface="marketplace-cart"]');
    const summary = document.querySelector('[data-testid="marketplace-cart-summary"]');
    if (!(surface instanceof HTMLElement) || !(summary instanceof HTMLElement)) {
      throw new Error('VRT geometry rejected: production cart surface or summary is missing');
    }

    const surfaceRect = surface.getBoundingClientRect();
    const summaryRect = summary.getBoundingClientRect();
    expect(summaryRect.top).toBeGreaterThanOrEqual(surfaceRect.top);
    expect(Math.abs(summaryRect.top - surfaceRect.top)).toBeLessThanOrEqual(2);
    expect(summaryRect.bottom).toBeLessThanOrEqual(viewportHeight);
    expect(summaryRect.right).toBeLessThanOrEqual(document.documentElement.clientWidth);
    expect(summaryRect.left).toBeGreaterThanOrEqual(0);
  }

  function expectMobileWorkflowGeometry() {
    const surface = document.querySelector('[data-surface="marketplace-cart"]');
    if (!(surface instanceof HTMLElement)) throw new Error('VRT geometry rejected: production cart surface is missing');

    const items = surface.querySelector('[data-testid="marketplace-cart-items"]');
    const summary = surface.querySelector('[data-testid="marketplace-cart-summary"]');
    const checkout = surface.querySelector('[data-testid="marketplace-cart-checkout"]');
    if (!(items instanceof HTMLElement) || !(summary instanceof HTMLElement) || !(checkout instanceof HTMLElement)) {
      throw new Error('VRT geometry rejected: missing cart items, summary, or Checkout region');
    }
    expect(items.getBoundingClientRect().top).toBeLessThanOrEqual(summary.getBoundingClientRect().top);
    expect(checkout.getBoundingClientRect().bottom - surface.getBoundingClientRect().top).toBeLessThanOrEqual(
      surface.scrollHeight,
    );
    expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth);
    for (const control of surface.querySelectorAll('button, [data-testid="marketplace-cart-checkout"]')) {
      expect(control.getBoundingClientRect().right).toBeLessThanOrEqual(surface.getBoundingClientRect().right);
    }
    for (const decrease of surface.querySelectorAll('button[aria-label^="Decrease "]')) {
      const quantity = decrease.parentElement!.getBoundingClientRect();
      const actions = decrease.parentElement!.parentElement!.getBoundingClientRect();
      expect(quantity.left + quantity.width / 2).toBeCloseTo(actions.left + actions.width / 2, 0);
    }
  }

  it('renders a single-seller cart at desktop viewport', async () => {
    const { singleSeller } = await fixtures;
    view.items = singleSeller;
    view.isLoading = false;

    await renderForVRT(<MarketplaceCart />, { viewport: VRT_VIEWPORT_DESKTOP });
    await captureCart('cart-single-seller-desktop');
  });

  it('renders a single-seller cart at mobile viewport', async () => {
    const { singleSeller } = await fixtures;
    view.items = singleSeller;
    view.isLoading = false;

    await renderForVRT(<MarketplaceCart />, { viewport: VRT_VIEWPORT_MOBILE });
    await captureCart('cart-single-seller-mobile');
  });

  it('renders a Locks digital cart with no shipping at desktop viewport', async () => {
    const { locksOnly } = await fixtures;
    view.items = locksOnly;
    view.isLoading = false;

    await renderForVRT(<MarketplaceCart />, { viewport: VRT_VIEWPORT_DESKTOP });
    await captureCart('cart-locks-digital-desktop');
  });

  it('renders a Locks digital cart with no shipping at mobile viewport', async () => {
    const { locksOnly } = await fixtures;
    view.items = locksOnly;
    view.isLoading = false;

    await renderForVRT(<MarketplaceCart />, { viewport: VRT_VIEWPORT_MOBILE });
    await captureCart('cart-locks-digital-mobile');
  });

  it('renders a Locks item beside a shipped item at desktop viewport', async () => {
    const { locksWithShipped } = await fixtures;
    view.items = locksWithShipped;
    view.isLoading = false;

    await renderForVRT(<MarketplaceCart />, { viewport: VRT_VIEWPORT_DESKTOP });
    await captureCart('cart-locks-with-shipped-desktop');
  });

  it('renders a multi-seller cart at desktop viewport', async () => {
    const { multiSeller } = await fixtures;
    view.items = multiSeller;
    view.isLoading = false;

    await renderForVRT(<MarketplaceCart />, { viewport: VRT_VIEWPORT_DESKTOP });
    await captureCart('cart-multi-seller-desktop');
  });

  it('keeps the desktop summary aligned and above the fold for multi-seller carts', async () => {
    const { multiSeller } = await fixtures;
    view.items = multiSeller;
    view.isLoading = false;

    await renderForVRT(<MarketplaceCart />, { viewport: VRT_VIEWPORT_DESKTOP });
    expectDesktopSummaryGeometry(VRT_VIEWPORT_DESKTOP.height);
  });

  it('rejects the old row-coupled desktop summary geometry', async () => {
    const { singleSeller } = await fixtures;
    view.items = singleSeller;
    view.isLoading = false;

    await renderForVRT(<MarketplaceCart />, { viewport: VRT_VIEWPORT_DESKTOP });
    const summary = document.querySelector('[data-testid="marketplace-cart-summary"]');
    if (!(summary instanceof HTMLElement)) throw new Error('VRT calibration rejected: production summary is missing');
    summary.style.gridRowStart = '2';

    expect(() => expectDesktopSummaryGeometry(VRT_VIEWPORT_DESKTOP.height)).toThrow();
  });

  it('renders a multi-seller cart at mobile viewport', async () => {
    const { multiSeller } = await fixtures;
    view.items = multiSeller;
    view.isLoading = false;

    await renderForVRT(<MarketplaceCart />, { viewport: VRT_VIEWPORT_MOBILE });
    const progress = document.querySelector<HTMLElement>('[aria-label="Checkout progress: step 1 of 3, Cart"]')!;
    const header = progress.parentElement!.parentElement!;
    const bar = progress.querySelector<HTMLElement>('.lg\\:hidden')!;
    expect(bar.getBoundingClientRect().width).toBeCloseTo(header.getBoundingClientRect().width, 0);
    await captureCart('cart-multi-seller-mobile');
  });

  it.each(['singleSeller', 'multiSeller'] as const)(
    'keeps mobile %s items above the summary with every control in view',
    async (fixture) => {
      view.items = (await fixtures)[fixture];
      view.isLoading = false;

      await renderForVRT(<MarketplaceCart />, { viewport: VRT_VIEWPORT_MOBILE });
      expectMobileWorkflowGeometry();
    },
  );

  it('renders a cart with a stale item whose variant is gone at desktop viewport', async () => {
    const { staleItem } = await fixtures;
    view.items = staleItem;
    view.isLoading = false;

    await renderForVRT(<MarketplaceCart />, { viewport: VRT_VIEWPORT_DESKTOP });
    await captureCart('cart-stale-item-desktop');
  });

  async function seedSoldOutCart() {
    const { soldOut, soldOutKeys } = await fixtures;
    view.items = soldOut;
    view.durable = true;
    view.availability.set(soldOutKeys.boots, {
      state: 'available',
      variants: [
        { variantId: 'variant_42', soldOut: true },
        { variantId: 'variant_43', soldOut: false },
      ],
    });
    view.availability.set(soldOutKeys.camera, { state: 'sold' });
  }

  async function waitForSoldOutLines() {
    await vi.waitFor(() => {
      if (document.querySelectorAll('[data-testid="marketplace-cart-line-sold-out"]').length !== 2) {
        throw new Error('The sold-out lines have not rendered yet.');
      }
    });
  }

  it.each([
    ['desktop', VRT_VIEWPORT_DESKTOP],
    ['mobile', VRT_VIEWPORT_MOBILE],
  ] as const)(
    'marks a sold-out listing and a sold-out size and blocks Checkout at %s viewport',
    async (name, viewport) => {
      await seedSoldOutCart();

      await renderForVRT(<MarketplaceCart />, { viewport });
      await waitForSoldOutLines();
      expect(document.querySelector('[data-testid="marketplace-cart-checkout"]')).toHaveProperty('disabled', true);
      await captureCart(`cart-sold-out-${name}`);
    },
  );

  it('keeps the sold-out cart inside the phone width with every control in view', async () => {
    await seedSoldOutCart();

    await renderForVRT(<MarketplaceCart />, { viewport: VRT_VIEWPORT_MOBILE });
    await waitForSoldOutLines();
    expectMobileWorkflowGeometry();
  });

  it('renders the empty cart at desktop viewport', async () => {
    view.items = [];
    view.isLoading = false;

    await renderForVRT(<MarketplaceCart />, { viewport: VRT_VIEWPORT_DESKTOP });
    await captureCart('cart-empty-desktop');
  });

  it('renders the loading state at desktop viewport', async () => {
    view.items = [];
    view.isLoading = true;

    await renderForVRT(<MarketplaceCart />, { viewport: VRT_VIEWPORT_DESKTOP });
    await captureCart('cart-loading-desktop');
  });

  it('renders an accepted-offer group without mixing it into ordinary checkout', async () => {
    const { singleSeller } = await fixtures;
    const offer = parseContractFaithfulOffer('accepted', 'active');
    view.items = [
      ...singleSeller,
      {
        ...singleSeller[0],
        id: 'award-cart-line',
        awardId: offer.award?.id,
        pricingSource: 'offer',
      },
    ];
    view.offers = [offer];
    view.isLoading = false;

    await renderForVRT(<MarketplaceCart />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    expect(document.querySelector('[data-surface="marketplace-award-cart-group"]')).toBeTruthy();
    await captureCart('cart-award-group-desktop');
  });
});
