// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectVrtSurface, renderForVRT } from '@/test-utils/vrt';
import { VRT_FROZEN_NOW_MS } from '@/test-utils/vrt.clock';
import { VRT_VIEWPORT_DESKTOP } from '@/test-utils/vrt.viewports';
import { setupFixedDateLocale } from '@/test-utils/date-locale';
import { MarketplaceOrders } from '@/templates/Marketplace/MarketplaceOrders';
import { MarketplaceCheckout } from '@/templates/Marketplace/MarketplaceCheckout';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { MarketplaceSessionService } from '@/services/marketplace/marketplace-session';
import { MARKETPLACE_SESSION_GRANT } from '@/services/marketplace/marketplace-session-grant';
import { resetMarketplaceOrderDiagnostics } from '@/services/marketplace/marketplace-order-diagnostics';
import {
  PAYMENT_UPSTREAM_INCONSISTENT_BUYER_COPY,
  PAYMENT_UPSTREAM_INCONSISTENT_SELLER_COPY,
} from '@/libs/commerce/bitcoin-buyer-status';
import {
  DERIVED_PAYING_ORDER_ID,
  MALFORMED_ORDER_ID,
  STAGING_ORDERS_BUYER_PUBKY,
  STAGING_ORDERS_SELLER_PUBKY,
  stagingCheckoutPayingResponse,
  stagingOrdersResponse,
  stagingOrdersWithMalformedResponse,
  UPSTREAM_INCONSISTENT_ORDER_ID,
} from '@/test/fixtures/marketplace/orders-staging-2026-11-26';

setupFixedDateLocale('en-GB');

const SESSION_TOKEN = 'A'.repeat(43);
const MARKETPLACE_ORIGIN = 'http://127.0.0.1:8080';

const navigation = vi.hoisted(() => ({
  pathname: '/marketplace/orders',
  viewer: 'idgopdnhi9psboqguyzsmsj1hyyy7gks7wxa4ym9eazz6pibsfay',
}));

let ordersPayload: { orders: unknown[] } = { orders: [] };

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return {
    ...actual,
    getCommerceAdapterMode: () => 'transaction-service',
    getMarketplaceUrl: () => 'http://127.0.0.1:8080',
    // The orders hook polls. A long interval keeps the capture on the first read.
    getCommercePollIntervalMs: () => 60 * 60 * 1000,
  };
});

vi.mock('@/stores/auth/auth.store', async () => {
  const { createMarketplaceVrtAuthStore: createAuth } = await import('@/test/mocks/marketplace-vrt');
  return {
    useAuthStore: createAuth({ getCurrentUserPubky: () => navigation.viewer }),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock('@/hooks/useIndicativeBtcRate/useIndicativeBtcRate', () => ({
  useIndicativeBtcRate: (enabled: boolean) =>
    enabled ? { satUsd: 0.001, btcUsd: 100_000, lastUpdatedAt: new Date('2026-01-01T12:00:00.000Z') } : null,
}));

vi.mock('@/hooks/useMarketplaceCheckout/useMarketplaceCheckout', async () => {
  const { useForm } = await import('react-hook-form');
  const { marketplaceCheckoutDefaults } = await import('@/hooks/useMarketplaceCheckout/useMarketplaceCheckout.types');
  const { noZoneShipping: emptyZoneShipping } = await import('@/test-utils/zone-shipping');
  return {
    useMarketplaceCheckout: () => ({
      form: useForm({ defaultValues: marketplaceCheckoutDefaults }),
      submit: vi.fn(async () => false),
      pay: vi.fn(async () => false),
      isPaying: false,
      needsSession: false,
      sessionError: null,
      hasMarketplaceSession: true,
      addresses: [],
      selectedAddressId: null,
      selectAddress: vi.fn(),
      fulfillmentOptionsForSeller: () => ['shipping'],
      fulfillmentForSeller: () => 'shipping',
      setFulfillmentChoice: vi.fn(),
      requiresDeliveryAddress: false,
      allowedDestinationCountries: null,
      storeShare: { stores: new Map(), chosen: new Set(), selected: [], setShare: () => undefined },
      hasFulfillmentConflict: false,
      isPickupCapabilityLoadingForSeller: () => false,
      orderCount: 0,
      zoneShipping: emptyZoneShipping(),
      rememberAddress: vi.fn(async () => undefined),
      pendingKeyChange: null,
      decideKeyChange: vi.fn(),
      fulfillmentForItem: () => 'shipping',
      setDigitalChoice: vi.fn(),
      canChooseDigitalForItem: () => false,
      digitalKindForItem: () => null,
      isDigitalCapabilityLoading: false,
      digitalNotReadyItemIds: [],
      isDigitalReady: true,
      requiresDeliveryEmail: false,
      hasInstantDigitalLine: false,
      hasManualDigitalLine: false,
      checkoutBusy: false,
    }),
  };
});

vi.mock('@/hooks/useMarketplaceOffers/useMarketplaceOffers', () => ({
  useMarketplaceOffers: () => ({ offers: [], isLoading: false, error: null, needsSession: false, refresh: vi.fn() }),
}));

vi.mock('@/hooks/useMarketplaceOfferCheckout/useMarketplaceOfferCheckout', () => ({
  useMarketplaceOfferCheckout: () => ({
    submit: vi.fn(),
    isSubmitting: false,
    pendingKeyChange: null,
    decideKeyChange: vi.fn(),
    deliveryKeyBlock: null,
  }),
}));

vi.mock('@/hooks/useMarketplaceCart/useMarketplaceCart', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useMarketplaceCart/useMarketplaceCart')>();
  return {
    ...actual,
    useMarketplaceCart: () => ({
      items: [],
      ordinaryItems: [],
      awardItems: [],
      subtotals: [],
      isLoading: false,
      clear: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    }),
  };
});

vi.mock('@/hooks/useChatUnread/useChatUnread', () => ({
  useChatUnread: () => 0,
}));

vi.mock('@/hooks/useMarketplaceCartCount/useMarketplaceCartCount', () => ({
  useMarketplaceCartCount: () => 0,
}));

vi.mock('@/hooks/useMarketplaceActivityUnread/useMarketplaceActivityUnread', () => ({
  useMarketplaceActivityUnread: () => 0,
}));

vi.mock('@/organisms/Marketplace/MarketplaceContentLayout', () => ({
  MarketplaceContentLayout: ({ children }: { children: ReactNode }) => <main className="w-full py-6">{children}</main>,
}));

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function installOrdersFetch(original: typeof fetch) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    let parsed: URL | null = null;
    try {
      parsed = new URL(url, MARKETPLACE_ORIGIN);
    } catch {
      parsed = null;
    }
    if (parsed?.origin === MARKETPLACE_ORIGIN && parsed.pathname === '/v1/orders') {
      return new Response(JSON.stringify(ordersPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (parsed?.origin === MARKETPLACE_ORIGIN) {
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    }
    return original(input, init);
  });
}

function showRoute(pathname: string, search = '') {
  navigation.pathname = pathname;
  window.history.replaceState(null, '', `${pathname}${search}`);
}

function establishSession(pubky: string) {
  MarketplaceSessionService.clearSession();
  MarketplaceSessionService.establishClaimedGrantSession(
    {
      token: SESSION_TOKEN,
      pubky,
      capabilities: MARKETPLACE_SESSION_GRANT,
      expiresAt: '2027-01-02T12:00:00.000Z',
    },
    pubky,
  );
}

beforeEach(() => {
  // The paying view counts down once a second. Pin `Date.now` so the 30:00
  // hold does not move between browsers or during the matcher retry.
  vi.spyOn(Date, 'now').mockReturnValue(VRT_FROZEN_NOW_MS);
  navigation.viewer = STAGING_ORDERS_BUYER_PUBKY;
  resetMarketplaceOrderDiagnostics();
  establishSession(STAGING_ORDERS_BUYER_PUBKY);
  installOrdersFetch(globalThis.fetch.bind(globalThis));
  vi.spyOn(CommerceController, 'resumeOwnReviewPublications').mockResolvedValue(0);
  vi.spyOn(CommerceController, 'resumeOwnReviewRemovals').mockResolvedValue(0);
  vi.spyOn(CommerceController, 'resumeOwnReviewResponsePublications').mockResolvedValue(0);
  vi.spyOn(CommerceController, 'sweepOwnAuctionReserves').mockResolvedValue(0);
  vi.spyOn(CommerceController, 'publishOrderReceipts').mockResolvedValue(undefined);
  vi.spyOn(CommerceController, 'getOwnMarketplaceReviews').mockResolvedValue([]);
  vi.spyOn(CommerceController, 'getAwaitingReleaseOwnMarketplaceReviews').mockResolvedValue([]);
  vi.spyOn(CommerceController, 'refreshOwnMarketplaceReviews').mockResolvedValue(0);
  vi.spyOn(CommerceController, 'markOrdersAttentionSeen').mockResolvedValue(undefined);
  vi.spyOn(CommerceController, 'getOrFetchListingIfFound').mockResolvedValue(null);
  vi.spyOn(CommerceController, 'fetchUsdtPaymentsAvailable').mockResolvedValue(false);
  vi.spyOn(ConnectorsController, 'fetchPushOverview').mockRejectedValue(new Error('connectors not used in this scene'));
});

describe('PR 582 staging orders visual proof', () => {
  it('renders the captured buyer orders, including 470c02d8', async () => {
    ordersPayload = stagingOrdersResponse();
    showRoute('/marketplace/orders');

    const screen = await renderForVRT(<MarketplaceOrders />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });

    await expect.element(screen.getByText('Order 470c02d8')).toBeVisible();
    await expect.element(screen.getByText('British laugh')).toBeVisible();
    await expect
      .element(screen.getByTestId('payment-manual-review-copy'))
      .toHaveTextContent(PAYMENT_UPSTREAM_INCONSISTENT_BUYER_COPY);
    expect(screen.container.querySelectorAll('[data-testid="order-reference"]')).toHaveLength(7);
    expect(
      screen.container.querySelector('[data-testid="marketplace-abandoned-checkouts"]')?.textContent,
    ).not.toContain('Order 470c02d8');
    expect(screen.container.textContent).not.toContain('temporarily unavailable');
    await expect(await expectVrtSurface('marketplace-orders')).toMatchScreenshot('after-orders-list', {
      screenshotOptions: { animations: 'disabled', caret: 'hide' },
    });
  });

  it('renders checkout for the exact 470c02d8 order with the under-review sentence', async () => {
    ordersPayload = stagingOrdersResponse();
    showRoute('/marketplace/checkout', `?order=${UPSTREAM_INCONSISTENT_ORDER_ID}`);

    const screen = await renderForVRT(<MarketplaceCheckout />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });

    await expect
      .element(screen.getByTestId('payment-manual-review-copy'))
      .toHaveTextContent(PAYMENT_UPSTREAM_INCONSISTENT_BUYER_COPY);
    await expect.element(screen.getByText('Order 470c02d8')).toBeVisible();
    await expect.element(screen.getByText('Under manual review')).toBeVisible();
    await expect(await expectVrtSurface('marketplace-checkout')).toMatchScreenshot(
      'after-checkout-470c02d8-under-review',
      { screenshotOptions: { animations: 'disabled', caret: 'hide' } },
    );
  });

  it('renders the derived paying view with the order number and pay-by time', async () => {
    ordersPayload = stagingCheckoutPayingResponse();
    showRoute('/marketplace/checkout', `?order=${DERIVED_PAYING_ORDER_ID}`);

    const screen = await renderForVRT(<MarketplaceCheckout />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });

    await expect.element(screen.getByText('Order d06cc87e')).toBeVisible();
    await expect.element(screen.getByText(/Pay by/)).toBeVisible();
    await expect.element(screen.getByText(/30:00/)).toBeVisible();
    expect(screen.container.textContent).not.toContain('no longer waiting for payment');
    await expect(await expectVrtSurface('marketplace-checkout')).toMatchScreenshot('after-checkout-paying', {
      screenshotOptions: { animations: 'disabled', caret: 'hide' },
    });
  });

  it('renders the inline parse-error card beside the captured orders', async () => {
    ordersPayload = stagingOrdersWithMalformedResponse();
    showRoute('/marketplace/orders');

    const screen = await renderForVRT(<MarketplaceOrders />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });

    await expect.element(screen.getByTestId('marketplace-order-parse-error')).toBeVisible();
    await expect.element(screen.getByText('Order could not be displayed')).toBeVisible();
    // The card still names the order locally. Diagnostics omit that id.
    await expect.element(screen.getByText(MALFORMED_ORDER_ID)).toBeVisible();
    await expect.element(screen.getByText('Order 470c02d8')).toBeVisible();
    expect(screen.container.querySelectorAll('[data-testid="order-reference"]')).toHaveLength(7);
    await expect(await expectVrtSurface('marketplace-orders')).toMatchScreenshot('after-orders-parse-error', {
      screenshotOptions: { animations: 'disabled', caret: 'hide' },
    });
  });

  it('renders 470c02d8 for the seller with wallet-check guidance and the review form', async () => {
    navigation.viewer = STAGING_ORDERS_SELLER_PUBKY;
    establishSession(STAGING_ORDERS_SELLER_PUBKY);
    ordersPayload = stagingOrdersResponse();
    showRoute('/marketplace/orders');

    const screen = await renderForVRT(<MarketplaceOrders />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });

    await expect.element(screen.getByText('Order 470c02d8')).toBeVisible();
    await expect
      .element(screen.getByTestId('payment-manual-review-copy'))
      .toHaveTextContent(PAYMENT_UPSTREAM_INCONSISTENT_SELLER_COPY);
    await expect
      .element(screen.getByTestId('seller-bitcoin-resolve-prompt'))
      .toHaveTextContent('Resolve payment review');
    await expect(await expectVrtSurface('marketplace-orders')).toMatchScreenshot('after-orders-470c02d8-seller', {
      screenshotOptions: { animations: 'disabled', caret: 'hide' },
    });
  });
});
