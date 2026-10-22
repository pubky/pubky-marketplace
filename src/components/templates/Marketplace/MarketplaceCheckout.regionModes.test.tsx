import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import {
  COMMERCE_BLOCKED_MESSAGE,
  COMMERCE_UNKNOWN_REGION_MESSAGE,
  SELLING_BLOCKED_COUNTRY_MESSAGE,
} from '@/libs/commerce/region-modes';
import { useClientRegionStore } from '@/stores/client-region/client-region.store';
import { setHeavySuiteBudgets } from '@/test-utils/load-budget';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
import { asOpaque } from '@/test-utils/type-assertions';
import { MarketplaceCheckout } from './MarketplaceCheckout';

setHeavySuiteBudgets();

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
});

const view = vi.hoisted(() => ({
  items: [] as unknown[],
  orders: [] as unknown[],
  isLoading: false,
  adapterMode: 'sandbox' as string,
  paykitServerApi: 'fork' as 'fork' | 'upstream',
  deliveryKeyBlock: null as null | { kind: string; sellerPubky: string | null; message: string },
  deployEnv: 'production' as 'production' | 'staging' | undefined,
  hasMarketplaceSession: false,
  needsSession: false,
  sessionError: null as string | null,
  addresses: [] as unknown[],
  selectedAddressId: null as string | null,
  fulfillmentOptions: {} as Record<string, Array<'shipping' | 'pickup'>>,
  fulfillmentEffective: {} as Record<string, 'shipping' | 'pickup'>,
  requiresDeliveryAddress: true,
  hasFulfillmentConflict: false,
  isPickupCapabilityLoading: false,
  fulfillmentByItem: {} as Record<string, 'shipping' | 'pickup' | 'digital'>,
  isDigitalReady: true,
  isDigitalCapabilityLoading: false,
  digitalKinds: {} as Record<string, 'file' | 'link' | 'text' | 'email' | 'message' | null | undefined>,
  digitalChoosable: [] as string[],
  digitalNotReadyItemIds: [] as string[],
  requiresDeliveryEmail: false,
  hasInstantDigitalLine: false,
  hasManualDigitalLine: false,
  orderCount: 1,
  payResult: { ok: false, orderIds: [] as string[], boundOrders: [] as unknown[] } as {
    ok: boolean;
    orderIds: string[];
    boundOrders: unknown[];
    refusal?: string;
    soldOut?: boolean;
  },
  availability: new Map<string, { aggregateId: string; state: string; serverTime: string }>(),
  awardItems: [] as Array<{ awardId: string; listingId: string; variantId: string }>,
  shops: {} as Record<string, { name: string; deliveryAssumeDays?: number; autoCompleteDays?: number }>,
  allowedDestinationCountries: null as string[] | null,
  storeStores: new Map<string, unknown>(),
  storeChosen: new Set<string>(),
}));

const checkoutActions = vi.hoisted(() => ({
  pay: vi.fn(async () => view.payResult),
  actOnOrder: vi.fn(async () => true),
  setFulfillmentChoice: vi.fn(),
  setDigitalChoice: vi.fn(),
  setStoreShare: vi.fn(),
  remove: vi.fn(async () => {}),
  rememberAddress: vi.fn(async () => {}),
  lastAward: undefined as unknown,
}));

const offerState = vi.hoisted(() => ({
  offers: [] as Array<Record<string, unknown>>,
  isLoading: false,
  refresh: vi.fn(async () => {}),
  submit: vi.fn(),
  outcome: { ok: true, orderId: '00000000-0000-4000-8000-000000000803', boundOrder: null } as
    | { ok: true; orderId: string; boundOrder: null }
    | { ok: false; code: string },
}));

const listing = {
  id: 'seller:boots',
  listing_id: 'boots',
  record: {
    ownerPubky: 's'.repeat(52),
    listingId: 'boots',
    title: 'Vintage boots',
    media: [],
    variants: [{ id: 'variant_42', options: { size: '42' }, quantity: 3 }],
    sale: { format: 'fixed_price', unitPrice: { amountMinor: 1200, currency: 'USD', exponent: 2 } },
  },
};

const searchParams = vi.hoisted(() => ({ current: new URLSearchParams() }));

const buyerWallet = vi.hoisted(() => ({
  state: 'payable' as 'idle' | 'checking' | 'payable' | 'not_payable' | 'unsupported' | 'unverified' | 'unknown',
  recheck: vi.fn(),
  enabledCalls: [] as boolean[],
  watchCalls: [] as boolean[],
}));

vi.mock('@/hooks/useBuyerPaykitWallet/useBuyerPaykitWallet', () => ({
  useBuyerPaykitWallet: (_buyerPubky: string | null, enabled: boolean, watch = false) => {
    buyerWallet.enabledCalls.push(enabled);
    buyerWallet.watchCalls.push(watch);
    return { state: enabled ? buyerWallet.state : 'idle', recheck: buyerWallet.recheck };
  },
}));

const navigation = vi.hoisted(() => ({ navigateTop: vi.fn() }));

vi.mock('@/libs/navigation/navigate-top', () => ({ navigateTop: navigation.navigateTop }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/marketplace/checkout',
  useSearchParams: () => searchParams.current,
}));

vi.mock('@/config/commerce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/commerce')>();
  return { ...actual, getCommerceAdapterMode: () => view.adapterMode, getPaykitServerApi: () => view.paykitServerApi };
});

vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>();
  return { ...actual, getDeployEnv: () => view.deployEnv };
});

vi.mock('@/hooks/useMarketplaceCart/useMarketplaceCart', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useMarketplaceCart/useMarketplaceCart')>();
  const { sumMoneyByAsset } = await import('@/libs/commerce/pricing');
  return {
    ...actual,
    useMarketplaceCart: () => {
      const items = view.items as Array<{
        listingId: string;
        quantity: number;
        variantId: string;
        listing: {
          record: {
            variants: Array<{
              id: string;
              priceOverride?: { amountMinor: number; currency: string; exponent: number };
            }>;
            sale: { format: string; unitPrice?: { amountMinor: number; currency: string; exponent: number } };
          };
        };
        pricingSource?: 'listing' | 'offer';
      }>;
      return {
        items,
        ordinaryItems: items,
        awardItems: view.awardItems,
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
        remove: checkoutActions.remove,
        clear: vi.fn(),
        groups: actual.groupMarketplaceCartItems(items as never),
      };
    },
  };
});

vi.mock('@/hooks/useMarketplaceCheckout/useMarketplaceCheckout', async () => {
  const { useForm } = await import('react-hook-form');
  const { zodResolver } = await import('@hookform/resolvers/zod');
  const { marketplaceCheckoutDefaults, marketplaceCheckoutSchema } =
    await import('@/hooks/useMarketplaceCheckout/useMarketplaceCheckout.types');
  return {
    useMarketplaceCheckout: (_items: unknown, _clear: unknown, award?: unknown) => {
      checkoutActions.lastAward = award;
      return {
        // The real hook keeps the hidden address flag in sync with the groups.
        form: useForm({
          resolver: zodResolver(marketplaceCheckoutSchema),
          defaultValues: { ...marketplaceCheckoutDefaults, requiresDeliveryAddress: view.requiresDeliveryAddress },
          mode: 'onTouched',
        }),
        submit: vi.fn(async () => false),
        pay: checkoutActions.pay,
        isPaying: false,
        needsSession: view.needsSession,
        sessionError: view.sessionError,
        hasMarketplaceSession: view.hasMarketplaceSession,
        addresses: view.addresses,
        selectedAddressId: view.selectedAddressId,
        selectAddress: vi.fn(),
        rememberAddress: checkoutActions.rememberAddress,
        pendingKeyChange: null,
        decideKeyChange: vi.fn(),
        deliveryKeyBlock: view.deliveryKeyBlock,
        fulfillmentOptionsForSeller: (sellerPubky: string) => view.fulfillmentOptions[sellerPubky] ?? ['shipping'],
        fulfillmentForSeller: (sellerPubky: string) => view.fulfillmentEffective[sellerPubky] ?? 'shipping',
        setFulfillmentChoice: checkoutActions.setFulfillmentChoice,
        requiresDeliveryAddress: view.requiresDeliveryAddress,
        allowedDestinationCountries: view.allowedDestinationCountries,
        storeShare: {
          stores: view.storeStores,
          chosen: view.storeChosen,
          selected: [],
          setShare: checkoutActions.setStoreShare,
        },
        hasFulfillmentConflict: view.hasFulfillmentConflict,
        isPickupCapabilityLoadingForSeller: () => view.isPickupCapabilityLoading,
        orderCount: view.orderCount,
        fulfillmentForItem: (itemId: string) => {
          const line = (view.items as Array<{ id: string; listing: { record: { ownerPubky: string } } }>).find(
            ({ id }) => id === itemId,
          );
          return (
            view.fulfillmentByItem[itemId] ??
            view.fulfillmentEffective[line?.listing.record.ownerPubky ?? ''] ??
            'shipping'
          );
        },
        setDigitalChoice: checkoutActions.setDigitalChoice,
        canChooseDigitalForItem: (itemId: string) => view.digitalChoosable.includes(itemId),
        digitalKindForItem: (itemId: string) => view.digitalKinds[itemId],
        isDigitalCapabilityLoading: view.isDigitalCapabilityLoading,
        digitalNotReadyItemIds: view.digitalNotReadyItemIds,
        isDigitalReady: view.isDigitalReady,
        requiresDeliveryEmail: view.requiresDeliveryEmail,
        hasInstantDigitalLine: view.hasInstantDigitalLine,
        hasManualDigitalLine: view.hasManualDigitalLine,
      };
    },
  };
});

vi.mock('@/hooks/useMarketplaceOrders/useMarketplaceOrders', () => ({
  useMarketplaceOrders: () => ({
    orders: view.orders,
    isLoading: false,
    error: null,
    needsSession: false,
    adapterMode: view.adapterMode,
    refresh: vi.fn(),
    advancePayment: vi.fn(),
    actOnOrder: checkoutActions.actOnOrder,
  }),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getSellerPaymentConfig: vi.fn(async () => ({
      bitcoinAvailable: true,
      bitcoinOfferAvailable: true,
      paypalAvailable: true,
    })),
    fetchUsdtPaymentsAvailable: vi.fn(async () => false),
    refreshShopOrGetCached: vi.fn(async () => null),
    getSellerAnnualLimit: vi.fn(async () => ({ enabled: false })),
    getIndicativeBtcRate: vi.fn(async () => null),
    getOrFetchListing: vi.fn(async () => listing.record),
    getOrFetchListingIfFound: vi.fn(async () => listing.record),
    getListing: vi.fn(async () => listing),
    getCartItems: vi.fn(async () => []),
    getManyListings: vi.fn(async () => new Map()),
    refreshShop: vi.fn(async (sellerPubky: string) => {
      const shop = view.shops[sellerPubky];
      if (!shop) throw new Error('no shop record in this test');
      return { ...shop };
    }),
    getShop: vi.fn(async () => null),
    getConnectorStores: vi.fn(async () => new Map()),
    getPublicListingAvailability: vi.fn(async (sellerPubky: string, listingId: string) =>
      Promise.resolve(view.availability.get(`${sellerPubky}:${listingId}`) ?? null),
    ),
  },
}));

vi.mock('@/hooks/useMarketplaceCartCount/useMarketplaceCartCount', () => ({
  useMarketplaceCartCount: () => 0,
}));

vi.mock('@/hooks/useMarketplaceActivityUnread/useMarketplaceActivityUnread', () => ({
  useMarketplaceActivityUnread: () => 0,
}));

vi.mock('@/hooks/useMarketplaceOffers/useMarketplaceOffers', () => ({
  useMarketplaceOffers: () => ({
    offers: offerState.offers,
    isLoading: offerState.isLoading,
    refresh: offerState.refresh,
  }),
}));

vi.mock('@/hooks/useMarketplaceOfferCheckout/useMarketplaceOfferCheckout', () => ({
  useMarketplaceOfferCheckout: () => ({
    submit: offerState.submit,
    isSubmitting: false,
    pendingKeyChange: null,
    decideKeyChange: vi.fn(),
  }),
}));

const approval = vi.hoisted(() => ({ signer: 'Pubky Ring' as 'Bitkit' | 'Pubky Ring' }));
vi.mock('@/hooks/useMarketplaceApprovalSigner/useMarketplaceApprovalSigner', () => ({
  useMarketplaceApprovalSigner: () => approval.signer,
}));

const auth = vi.hoisted(() => ({ currentUserPubky: 'b'.repeat(52) }));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) => selector(auth),
}));

vi.mock('@/organisms/Marketplace/MarketplaceIndicativePrice', () => ({
  MarketplaceIndicativePrice: ({ money }: { money: { currency: string } }) =>
    money.currency === 'USD' ? <span>≈ ₿137,000</span> : null,
}));

vi.mock('@/organisms/Marketplace/MarketplacePaymentStatusCard', () => ({
  MarketplacePaymentStatusCard: ({ checkoutActions }: { checkoutActions?: React.ReactNode }) => (
    <div data-testid="payment-status-panel">{checkoutActions}</div>
  ),
}));

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/organisms/Marketplace/MarketplaceSessionConnectDialog', () => ({
  MarketplaceSessionConnectDialog: ({ triggerLabel }: { triggerLabel?: string }) => (
    <button type="button">{triggerLabel ?? 'Approve in Pubky Ring'}</button>
  ),
}));

vi.mock('@/hooks/useMarketplaceSellerSummary/useMarketplaceSellerSummary', () => ({
  useMarketplaceSellerSummary: (sellerPubky: string, options?: { includeReputation?: boolean }) => ({
    shop: null,
    reputation: options?.includeReputation === false ? { status: 'unavailable' } : { status: 'new_seller' },
    displayName: sellerPubky === listing.record.ownerPubky ? 'Satoshi Vintage' : 'Film Camera Supply',
  }),
}));

function resetCheckoutView() {
  view.orders = [];
  checkoutActions.pay.mockClear();
  checkoutActions.setFulfillmentChoice.mockReset();
  checkoutActions.remove.mockClear();
  checkoutActions.rememberAddress.mockClear();
  view.items = [];
  view.isLoading = false;
  view.adapterMode = 'sandbox';
  view.paykitServerApi = 'fork';
  view.deliveryKeyBlock = null;
  view.deployEnv = 'production';
  view.hasMarketplaceSession = false;
  view.needsSession = false;
  view.sessionError = null;
  view.addresses = [];
  view.selectedAddressId = null;
  view.fulfillmentOptions = {};
  view.fulfillmentEffective = {};
  view.requiresDeliveryAddress = true;
  view.hasFulfillmentConflict = false;
  view.isPickupCapabilityLoading = false;
  view.fulfillmentByItem = {};
  view.isDigitalReady = true;
  view.isDigitalCapabilityLoading = false;
  view.digitalKinds = {};
  view.digitalChoosable = [];
  view.digitalNotReadyItemIds = [];
  view.requiresDeliveryEmail = false;
  view.hasInstantDigitalLine = false;
  view.hasManualDigitalLine = false;
  checkoutActions.setDigitalChoice.mockReset();
  view.orderCount = 1;
  view.payResult = { ok: false, orderIds: [], boundOrders: [] };
  view.availability.clear();
  navigation.navigateTop.mockReset();
  view.awardItems = [];
  view.shops = {};
  view.allowedDestinationCountries = null;
  view.storeStores = new Map();
  view.storeChosen = new Set();
  offerState.offers = [];
  offerState.isLoading = false;
  offerState.refresh.mockClear();
  offerState.submit.mockReset();
  offerState.outcome = { ok: true, orderId: '00000000-0000-4000-8000-000000000803', boundOrder: null };
  offerState.submit.mockResolvedValue(offerState.outcome);
  searchParams.current = new URLSearchParams();
  window.history.replaceState(null, '', '/marketplace/checkout');
  buyerWallet.state = 'payable';
  buyerWallet.recheck.mockClear();
  buyerWallet.enabledCalls = [];
  buyerWallet.watchCalls = [];
  auth.currentUserPubky = 'b'.repeat(52);
}

function seededCart() {
  view.items = [
    {
      id: 'seller:boots:variant_42',
      listingId: listing.id,
      variantId: 'variant_42',
      quantity: 1,
      listing,
    },
  ];
  view.isLoading = false;
}

const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';

describe('MarketplaceCheckout under the region modes', () => {
  beforeEach(() => {
    resetCheckoutView();
    resetRegionState();
    approval.signer = 'Pubky Ring';
    vi.mocked(CommerceController.refreshShopOrGetCached).mockResolvedValue(asOpaque(null));
    seededCart();
  });
  afterEach(() => resetRegionState());

  const pay = () => screen.getByTestId('marketplace-checkout-pay');

  it('disables Pay and shows the one line with an info icon for a visitor in a blocked region', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('US');
    render(<MarketplaceCheckout />);

    expect(await screen.findByTestId('marketplace-checkout-blocked')).toHaveTextContent(COMMERCE_BLOCKED_MESSAGE);
    expect(screen.getByRole('button', { name: 'About this limit' })).toBeInTheDocument();
    expect(pay()).toBeDisabled();
    expect(document.getElementById('checkout-pay-reason')).toHaveTextContent(COMMERCE_BLOCKED_MESSAGE);
    expect(screen.queryByTestId('checkout-region-refusal')).not.toBeInTheDocument();
  });

  it('keeps the cart readable while Pay is off', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('DE');
    render(<MarketplaceCheckout />);

    await screen.findByTestId('marketplace-checkout-blocked');
    expect(screen.getByRole('heading', { level: 1, name: 'Checkout' })).toBeInTheDocument();
    expect(screen.getByText('Vintage boots')).toBeInTheDocument();
  });

  it('keeps Pay off, with no line, while the visitor region is being read', () => {
    setRegionModes(LAUNCH);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    render(<MarketplaceCheckout />);

    expect(pay()).toBeDisabled();
    expect(screen.queryByTestId('marketplace-checkout-blocked')).not.toBeInTheDocument();
  });

  it('says the location cannot be told for an unknown visitor', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion(null);
    render(<MarketplaceCheckout />);

    expect(await screen.findByTestId('marketplace-checkout-blocked')).toHaveTextContent(
      COMMERCE_UNKNOWN_REGION_MESSAGE,
    );
    expect(pay()).toBeDisabled();
  });

  it('blocks checkout with a seller whose shop is in a blocked country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    vi.mocked(CommerceController.refreshShopOrGetCached).mockResolvedValue({
      sellerStatus: 'private',
      location: { countryCode: 'US' },
    } as never);
    render(<MarketplaceCheckout />);

    expect(await screen.findByTestId('marketplace-checkout-blocked')).toHaveTextContent(
      SELLING_BLOCKED_COUNTRY_MESSAGE,
    );
    expect(pay()).toBeDisabled();
  });

  it('shows no line for a visitor from an open country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    render(<MarketplaceCheckout />);

    await waitFor(() => expect(useClientRegionStore.getState().status).toBe('ready'));
    expect(screen.queryByTestId('marketplace-checkout-blocked')).not.toBeInTheDocument();
    expect(document.getElementById('checkout-pay-reason')?.textContent ?? '').not.toContain(COMMERCE_BLOCKED_MESSAGE);
  });

  it('is unchanged, and reads no region, while no region is blocked', () => {
    setRegionModes('EU=nuanced,GB=nuanced');
    const fetchStub = stubClientRegion('US');
    render(<MarketplaceCheckout />);

    expect(screen.queryByTestId('marketplace-checkout-blocked')).not.toBeInTheDocument();
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
