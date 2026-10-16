import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKETPLACE_DELIVERY_ADDRESS_DISCLOSURE } from '@/config/commerce-copy';
import { LISTING_CURRENCY_REGISTRY, LISTING_FIAT_CURRENCY_CODES } from '@/config/currencies';
import { CommerceController } from '@/controllers/commerce/commerce';
import { DELIVERY_KEY_COPY } from '@/libs/commerce/delivery-key-copy';
import { formatCommerceMoney } from '@/libs/commerce/format';
import { createOrderFixture, createPaymentFixture } from '@/test/fixtures/commerce/orders';
import { createPaykitOrderFixture } from '@/test/fixtures/commerce/paykit-orders';
import { setHeavySuiteBudgets } from '@/test-utils/load-budget';
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
  payResult: { ok: false, orderIds: [] as string[], boundOrders: [] as unknown[] },
  awardItems: [] as Array<{ awardId: string; listingId: string; variantId: string }>,
  shops: {} as Record<string, { name: string; deliveryAssumeDays?: number; autoCompleteDays?: number }>,
  allowedDestinationCountries: null as string[] | null,
}));

const checkoutActions = vi.hoisted(() => ({
  pay: vi.fn(async () => view.payResult),
  actOnOrder: vi.fn(async () => true),
  setFulfillmentChoice: vi.fn(),
  setDigitalChoice: vi.fn(),
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

const secondSellerListing = {
  ...listing,
  id: 'other:camera',
  listing_id: 'camera',
  record: {
    ...listing.record,
    ownerPubky: 'o'.repeat(52),
    listingId: 'camera',
    title: 'Rangefinder camera',
    variants: [{ id: 'variant_01', options: {}, quantity: 2 }],
    sale: { format: 'fixed_price', unitPrice: { amountMinor: 15000, currency: 'BTC', exponent: 8 } },
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
    getIndicativeBtcRate: vi.fn(async () => null),
    getOrFetchListing: vi.fn(async () => listing.record),
    getListing: vi.fn(async () => listing),
    getCartItems: vi.fn(async () => []),
    getManyListings: vi.fn(async () => new Map()),
    refreshShop: vi.fn(async (sellerPubky: string) => {
      const shop = view.shops[sellerPubky];
      if (!shop) throw new Error('no shop record in this test');
      return { ...shop };
    }),
    getShop: vi.fn(async () => null),
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
  navigation.navigateTop.mockReset();
  view.awardItems = [];
  view.shops = {};
  view.allowedDestinationCountries = null;
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

async function fillValidDelivery(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Full name'), 'Alice Buyer');
  await user.type(screen.getByLabelText('Address line 1'), '1 Market Street');
  await user.type(screen.getByLabelText('City'), 'New York');
  await user.type(screen.getByLabelText('State'), 'NY');
  await user.type(screen.getByLabelText('ZIP code'), '10001');
}

describe('MarketplaceCheckout', () => {
  beforeEach(() => {
    resetCheckoutView();
    approval.signer = 'Pubky Ring';
  });

  it('does not ask an already approved Bitkit user to approve again', () => {
    seededCart();
    view.adapterMode = 'transaction-service';
    view.hasMarketplaceSession = true;
    approval.signer = 'Bitkit';

    render(<MarketplaceCheckout />);

    expect(screen.queryByRole('heading', { name: 'Enable purchases' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Pubky Ring/)).not.toBeInTheDocument();
  });

  it("states the seller's delivery periods in the order summary", async () => {
    seededCart();
    view.shops = {
      [listing.record.ownerPubky]: { name: 'Satoshi Vintage', deliveryAssumeDays: 3, autoCompleteDays: 5 },
    };

    render(<MarketplaceCheckout />);

    expect(await screen.findByTestId('marketplace-delivery-terms')).toHaveTextContent(
      'Delivery is assumed after 3 days (counted from payment for items the seller emails or sends in messages); the order completes 5 days after delivery unless you open a return.',
    );
    expect(within(screen.getByTestId('marketplace-checkout-summary')).getByTestId('marketplace-delivery-terms')).toBe(
      screen.getByTestId('marketplace-delivery-terms'),
    );
  });

  it('fills only the periods a seller left unset with the defaults', async () => {
    seededCart();
    view.shops = { [listing.record.ownerPubky]: { name: 'Satoshi Vintage', autoCompleteDays: 9 } };

    render(<MarketplaceCheckout />);

    expect(await screen.findByTestId('marketplace-delivery-terms')).toHaveTextContent(
      'Delivery is assumed after 14 days (counted from payment for items the seller emails or sends in messages); the order completes 9 days after delivery unless you open a return.',
    );
  });

  it('names each shop when two sellers set different periods', async () => {
    view.items = [
      { id: 'seller:boots:variant_42', listingId: listing.id, variantId: 'variant_42', quantity: 1, listing },
      {
        id: 'other:camera:variant_01',
        listingId: secondSellerListing.id,
        variantId: 'variant_01',
        quantity: 1,
        listing: secondSellerListing,
      },
    ];
    view.orderCount = 2;
    view.shops = {
      [listing.record.ownerPubky]: { name: 'Satoshi Vintage', deliveryAssumeDays: 3, autoCompleteDays: 5 },
      [secondSellerListing.record.ownerPubky]: {
        name: 'Film Camera Supply',
        deliveryAssumeDays: 30,
        autoCompleteDays: 45,
      },
    };

    render(<MarketplaceCheckout />);

    const terms = await screen.findByTestId('marketplace-delivery-terms');
    await waitFor(() => expect(terms).toHaveTextContent('Film Camera Supply: Delivery is assumed after 30 days'));
    expect(terms).toHaveTextContent('Satoshi Vintage: Delivery is assumed after 3 days');
  });

  it('offers only the seller’s destination countries in the address country picker', async () => {
    seededCart();
    view.allowedDestinationCountries = ['CH'];

    render(<MarketplaceCheckout />);

    expect(await screen.findByTestId('marketplace-address-country-select')).toBeInTheDocument();
    expect(document.querySelector('input[name="countryCode"]')).toBeNull();
  });

  it('shows no periods when the seller shop cannot be read, rather than guessing', async () => {
    seededCart();

    render(<MarketplaceCheckout />);

    await screen.findByTestId('marketplace-checkout-summary');
    await waitFor(() => expect(CommerceController.refreshShop).toHaveBeenCalled());
    expect(screen.queryByTestId('marketplace-delivery-terms')).not.toBeInTheDocument();
  });

  it('never includes Stripe in the checkout rail list', async () => {
    seededCart();
    view.adapterMode = 'transaction-service';
    view.hasMarketplaceSession = true;

    render(<MarketplaceCheckout />);

    expect(await screen.findByTestId('marketplace-checkout-method-paykit')).toBeInTheDocument();
    expect(screen.getByTestId('marketplace-checkout-method-paypal')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-checkout-method-stripe')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Stripe/ })).not.toBeInTheDocument();
  });

  it('disables Pay without a marketplace session in durable mode', () => {
    seededCart();
    view.adapterMode = 'transaction-service';
    view.hasMarketplaceSession = false;

    render(<MarketplaceCheckout />);

    expect(screen.getByRole('heading', { name: 'Enable purchases' })).toBeInTheDocument();
    const pay = screen.getByTestId('marketplace-checkout-pay');
    expect(pay).toBeDisabled();
    expect(pay).toHaveAttribute('aria-describedby', 'checkout-pay-reason');
    expect(document.getElementById('checkout-pay-reason')).toHaveTextContent('Enable purchases to pay.');
  });

  it.each(['transaction-service', 'locks-paykit', 'unavailable'] as const)(
    'shows a single payment notice in %s production checkout without a duplicate seller-direct helper',
    (adapterMode) => {
      seededCart();
      view.adapterMode = adapterMode;
      view.hasMarketplaceSession = true;
      view.deployEnv = 'production';

      render(<MarketplaceCheckout />);

      expect(screen.queryByRole('note')).not.toBeInTheDocument();
      expect(
        screen.queryByText('Real money. Payments are final and go directly to the seller.'),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('marketplace-checkout-payment-notice')).toBeInTheDocument();
      expect(screen.queryByText('Paid directly to the seller.')).not.toBeInTheDocument();
      expect(screen.getByText(MARKETPLACE_DELIVERY_ADDRESS_DISCLOSURE)).toBeInTheDocument();
    },
  );

  it.each([
    ['locks-paykit', 'Payment goes directly to the seller. This marketplace never holds funds.'],
    [
      'unavailable',
      'No payment rails are live in this deployment, so no real funds move. This marketplace never holds funds.',
    ],
  ] as const)(
    'replaces the guarantee checkbox with a non-interactive payment notice in %s mode',
    (adapterMode, copy) => {
      seededCart();
      view.adapterMode = adapterMode;
      view.hasMarketplaceSession = true;

      render(<MarketplaceCheckout />);

      const notice = screen.getByTestId('marketplace-checkout-payment-notice');
      expect(notice).toHaveTextContent(copy);
      expect(notice.querySelector('input, button, [role="checkbox"]')).toBeNull();
      expect(screen.queryByRole('checkbox', { name: /guarantee/i })).not.toBeInTheDocument();
    },
  );

  it('does not show a production money warning when the deploy environment is unknown', () => {
    seededCart();
    view.adapterMode = 'sandbox';
    view.deployEnv = undefined;

    render(<MarketplaceCheckout />);

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.queryByText(/Real money/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Staging environment/)).not.toBeInTheDocument();
  });

  it('shows the staging notice regardless of adapter mode', () => {
    seededCart();
    view.adapterMode = 'sandbox';
    view.deployEnv = 'staging';

    render(<MarketplaceCheckout />);

    expect(screen.getByRole('note')).toHaveTextContent('Staging environment. No real funds move.');
    expect(screen.queryByTestId('marketplace-checkout-payment-notice-group')).not.toBeInTheDocument();
    expect(screen.queryByText('Real money. Payments are final and go directly to the seller.')).not.toBeInTheDocument();
    expect(screen.queryByText('Paid directly to the seller.')).not.toBeInTheDocument();
  });

  it.each([false, true])('renders truthful address copy exactly once with saved addresses=%s', (hasSavedAddress) => {
    seededCart();
    view.addresses = hasSavedAddress ? [{ id: 'home', label: 'Home', city: 'New York', is_default: true }] : [];

    render(<MarketplaceCheckout />);

    expect(screen.getAllByText(MARKETPLACE_DELIVERY_ADDRESS_DISCLOSURE)).toHaveLength(1);
    expect(screen.queryByText(/not sent/)).not.toBeInTheDocument();
  });

  it('enables Pay after session plus a valid form', async () => {
    const user = userEvent.setup();
    seededCart();
    view.adapterMode = 'transaction-service';
    view.hasMarketplaceSession = true;

    render(<MarketplaceCheckout />);

    expect(screen.queryByRole('heading', { name: 'Enable purchases' })).not.toBeInTheDocument();
    const pay = screen.getByTestId('marketplace-checkout-pay');
    expect(pay).toBeDisabled();
    expect(pay).toHaveAttribute('aria-describedby', 'checkout-pay-reason');
    expect(document.getElementById('checkout-pay-reason')).toHaveTextContent('Fill in delivery details');

    await fillValidDelivery(user);

    await waitFor(() => expect(pay).toBeEnabled());
  });

  it('shows why Pay stopped when the seller has no delivery key, next to the Pay button', async () => {
    seededCart();
    view.adapterMode = 'transaction-service';
    view.hasMarketplaceSession = true;
    view.deliveryKeyBlock = {
      kind: 'no_key',
      sellerPubky: 's'.repeat(52),
      message: DELIVERY_KEY_COPY.noKey,
    };

    render(<MarketplaceCheckout />);

    const notice = await screen.findByTestId('delivery-key-blocked');
    expect(notice).toHaveTextContent("This seller hasn't finished setting up delivery yet");
    expect(notice.compareDocumentPosition(screen.getByTestId('marketplace-checkout-pay'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('asks a buyer without a Paykit wallet to connect Bitkit instead of letting Paykit Pay fail', async () => {
    const user = userEvent.setup();
    seededCart();
    view.adapterMode = 'transaction-service';
    view.hasMarketplaceSession = true;
    buyerWallet.state = 'not_payable';
    view.paykitServerApi = 'upstream';

    render(<MarketplaceCheckout />);

    const pay = screen.getByTestId('marketplace-checkout-pay');
    await fillValidDelivery(user);
    const notice = await screen.findByTestId('marketplace-checkout-bitkit-required');
    expect(notice).toHaveTextContent('Connect Bitkit to pay with Paykit');
    expect(notice).toHaveTextContent('Use your marketplace pubky in Bitkit to receive a payment request.');
    expect(pay).toBeDisabled();
    expect(pay).toHaveAttribute('aria-describedby', 'checkout-pay-reason');
    expect(document.getElementById('checkout-pay-reason')).toHaveTextContent('A compatible Bitkit wallet is required');

    await user.click(screen.getByTestId('marketplace-checkout-bitkit-recheck'));
    expect(buyerWallet.recheck).toHaveBeenCalledTimes(1);

    // Another rail stays payable.
    await user.click(screen.getByTestId('marketplace-checkout-method-paypal'));
    await waitFor(() => expect(pay).toBeEnabled());
    expect(screen.queryByTestId('marketplace-checkout-bitkit-required')).not.toBeInTheDocument();
    expect(checkoutActions.pay).not.toHaveBeenCalled();
  });

  it('does not offer incompatible downloads or the connection guide on fork checkout', async () => {
    const user = userEvent.setup();
    seededCart();
    view.adapterMode = 'transaction-service';
    view.hasMarketplaceSession = true;
    buyerWallet.state = 'not_payable';
    view.paykitServerApi = 'fork';
    render(<MarketplaceCheckout />);
    await fillValidDelivery(user);
    const notice = screen.getByTestId('marketplace-checkout-bitkit-required');
    expect(notice).toHaveTextContent('does not support Bitkit 2.6 or later yet');
    expect(within(notice).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-checkout-bitkit-connect')).not.toBeInTheDocument();
    const pay = screen.getByTestId('marketplace-checkout-pay');
    expect(pay).toBeDisabled();
    expect(pay).toHaveAttribute('aria-describedby', 'checkout-pay-reason');
    await user.click(screen.getByTestId('marketplace-checkout-bitkit-recheck'));
    expect(buyerWallet.recheck).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('marketplace-checkout-method-paypal'));
    await waitFor(() => expect(pay).toBeEnabled());
    expect(checkoutActions.pay).not.toHaveBeenCalled();
  });

  it.each(['fork', 'upstream'] as const)(
    'discloses the extra Bitcoin amount before Pay only on fork (%s)',
    async (api) => {
      const user = userEvent.setup();
      seededCart();
      view.adapterMode = 'transaction-service';
      view.hasMarketplaceSession = true;
      view.paykitServerApi = api;
      render(<MarketplaceCheckout />);
      await fillValidDelivery(user);
      const note = screen.queryByTestId('bitcoin-payment-code-note');
      if (api === 'fork') {
        expect(note).toHaveTextContent('₿1–₿999');
        expect(note!.compareDocumentPosition(screen.getByTestId('marketplace-checkout-pay'))).toBe(
          Node.DOCUMENT_POSITION_FOLLOWING,
        );
      } else {
        expect(note).not.toBeInTheDocument();
      }
      await user.click(screen.getByTestId('marketplace-checkout-method-paypal'));
      expect(screen.queryByTestId('bitcoin-payment-code-note')).not.toBeInTheDocument();
      expect(checkoutActions.pay).not.toHaveBeenCalled();
    },
  );

  it.each(['staging', undefined] as const)('keeps the production payment notice out of %s', (deployEnv) => {
    seededCart();
    view.adapterMode = 'locks-paykit';
    view.deployEnv = deployEnv;
    render(<MarketplaceCheckout />);
    expect(screen.queryByTestId('marketplace-checkout-payment-notice')).not.toBeInTheDocument();
  });

  it('connects the buyer’s account through the guide and real recheck without paying automatically', async () => {
    const user = userEvent.setup();
    seededCart();
    view.adapterMode = 'transaction-service';
    view.hasMarketplaceSession = true;
    buyerWallet.state = 'not_payable';
    view.paykitServerApi = 'upstream';
    const { rerender } = render(<MarketplaceCheckout />);
    await fillValidDelivery(user);
    const pay = screen.getByTestId('marketplace-checkout-pay');

    await user.click(await screen.findByTestId('marketplace-checkout-bitkit-connect'));
    expect(screen.getByRole('dialog', { name: 'Connect Bitkit' })).toBeVisible();
    expect(screen.getByTestId('buyer-bitkit-account')).toHaveTextContent(auth.currentUserPubky);
    expect(buyerWallet.recheck).toHaveBeenCalledTimes(1);
    expect(buyerWallet.watchCalls.at(-1)).toBe(true);

    buyerWallet.state = 'checking';
    rerender(<MarketplaceCheckout />);
    expect(screen.getByRole('dialog', { name: 'Connect Bitkit' })).toBeVisible();
    expect(pay).toBeDisabled();
    buyerWallet.state = 'payable';
    rerender(<MarketplaceCheckout />);
    await user.click(screen.getByRole('button', { name: 'Continue checkout' }));
    expect(screen.queryByRole('dialog', { name: 'Connect Bitkit' })).not.toBeInTheDocument();
    expect(buyerWallet.watchCalls.at(-1)).toBe(false);
    expect(pay).toBeEnabled();
    expect(checkoutActions.pay).not.toHaveBeenCalled();
  });

  it('keeps a known missing wallet blocked after a failed connection check, including after closing', async () => {
    const user = userEvent.setup();
    seededCart();
    view.adapterMode = 'transaction-service';
    view.hasMarketplaceSession = true;
    buyerWallet.state = 'not_payable';
    view.paykitServerApi = 'upstream';
    const { rerender } = render(<MarketplaceCheckout />);
    await fillValidDelivery(user);
    const pay = screen.getByTestId('marketplace-checkout-pay');
    await user.click(await screen.findByTestId('marketplace-checkout-bitkit-connect'));
    buyerWallet.state = 'unknown';
    rerender(<MarketplaceCheckout />);
    expect(pay).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Continue checkout' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(pay).toBeDisabled();
    expect(buyerWallet.watchCalls.at(-1)).toBe(false);
    expect(screen.getByTestId('marketplace-checkout-bitkit-unverified')).toBeInTheDocument();
    await user.click(screen.getByTestId('marketplace-checkout-method-paypal'));
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(screen.getByTestId('marketplace-checkout-method-paykit'));
    expect(pay).toBeDisabled();
    expect(screen.queryByRole('dialog', { name: 'Connect Bitkit' })).not.toBeInTheDocument();
    expect(checkoutActions.pay).not.toHaveBeenCalled();
  });

  it('keeps Pay blocked after an inline connection check fails until the wallet is verified', async () => {
    const user = userEvent.setup();
    seededCart();
    view.adapterMode = 'transaction-service';
    view.hasMarketplaceSession = true;
    buyerWallet.state = 'not_payable';
    view.paykitServerApi = 'upstream';
    const { rerender } = render(<MarketplaceCheckout />);
    await fillValidDelivery(user);
    const pay = screen.getByTestId('marketplace-checkout-pay');

    await user.click(await screen.findByTestId('marketplace-checkout-bitkit-recheck'));
    expect(buyerWallet.recheck).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Connect Bitkit' })).not.toBeInTheDocument();
    buyerWallet.state = 'unknown';
    rerender(<MarketplaceCheckout />);
    expect(pay).toBeDisabled();
    expect(screen.getByTestId('marketplace-checkout-bitkit-unverified')).toBeInTheDocument();

    buyerWallet.state = 'payable';
    rerender(<MarketplaceCheckout />);
    expect(pay).toBeEnabled();
    expect(checkoutActions.pay).not.toHaveBeenCalled();
  });

  it('closes the buyer guide if the signed-in account changes', async () => {
    const user = userEvent.setup();
    seededCart();
    view.adapterMode = 'transaction-service';
    view.hasMarketplaceSession = true;
    buyerWallet.state = 'not_payable';
    view.paykitServerApi = 'upstream';
    const { rerender } = render(<MarketplaceCheckout />);
    await user.click(await screen.findByTestId('marketplace-checkout-bitkit-connect'));
    auth.currentUserPubky = 'c'.repeat(52);
    rerender(<MarketplaceCheckout />);
    expect(screen.queryByRole('dialog', { name: 'Connect Bitkit' })).not.toBeInTheDocument();
    expect(buyerWallet.watchCalls.at(-1)).toBe(false);
    await user.click(screen.getByTestId('marketplace-checkout-bitkit-connect'));
    expect(screen.getByTestId('buyer-bitkit-account')).toHaveTextContent(auth.currentUserPubky);
  });

  it('tells a Bitkit 2.6 buyer Bitcoin checkout is not supported yet and keeps PayPal payable', async () => {
    const user = userEvent.setup();
    seededCart();
    view.adapterMode = 'transaction-service';
    view.hasMarketplaceSession = true;
    buyerWallet.state = 'unsupported';

    render(<MarketplaceCheckout />);

    const pay = screen.getByTestId('marketplace-checkout-pay');
    await fillValidDelivery(user);
    const notice = await screen.findByTestId('marketplace-checkout-bitkit-unsupported');
    expect(notice).toHaveAttribute('role', 'alert');
    expect(notice).toHaveTextContent('Bitcoin checkout does not support Bitkit 2.6 yet');
    expect(notice).toHaveTextContent('This pubky uses Bitkit 2.6 or later.');
    expect(notice).toHaveTextContent('You can pay with PayPal instead.');
    expect(screen.queryByTestId('marketplace-checkout-bitkit-required')).not.toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-checkout-bitkit-recheck')).not.toBeInTheDocument();
    expect(pay).toBeDisabled();
    expect(
      screen.getByText('Bitcoin checkout does not support Bitkit 2.6 yet. Choose PayPal to pay now.'),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId('marketplace-checkout-method-paypal'));
    await waitFor(() => expect(pay).toBeEnabled());
    expect(screen.queryByTestId('marketplace-checkout-bitkit-unsupported')).not.toBeInTheDocument();
    expect(checkoutActions.pay).not.toHaveBeenCalled();
  });

  it('holds Bitcoin Pay when the wallet could not be verified, and offers a recheck', async () => {
    const user = userEvent.setup();
    seededCart();
    view.adapterMode = 'transaction-service';
    view.hasMarketplaceSession = true;
    buyerWallet.state = 'unverified';

    render(<MarketplaceCheckout />);

    const pay = screen.getByTestId('marketplace-checkout-pay');
    await fillValidDelivery(user);
    const notice = await screen.findByTestId('marketplace-checkout-bitkit-unverified');
    expect(notice).toHaveAttribute('role', 'alert');
    expect(notice).toHaveTextContent("Couldn't verify your Bitcoin wallet");
    expect(notice).toHaveTextContent('You can also pay with PayPal.');
    expect(pay).toBeDisabled();
    expect(
      screen.getByText('Check your Bitcoin wallet again to pay with Bitcoin, or choose PayPal.'),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId('marketplace-checkout-bitkit-unverified-recheck'));
    expect(buyerWallet.recheck).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('marketplace-checkout-method-paypal'));
    await waitFor(() => expect(pay).toBeEnabled());
    expect(screen.queryByTestId('marketplace-checkout-bitkit-unverified')).not.toBeInTheDocument();
    expect(checkoutActions.pay).not.toHaveBeenCalled();
  });

  it('keeps Bitcoin Pay available while the wallet check is inconclusive, and holds it while checking', async () => {
    const user = userEvent.setup();
    seededCart();
    view.adapterMode = 'transaction-service';
    view.hasMarketplaceSession = true;
    buyerWallet.state = 'checking';

    const { rerender } = render(<MarketplaceCheckout />);
    const pay = screen.getByTestId('marketplace-checkout-pay');
    await fillValidDelivery(user);
    expect(await screen.findByText('Checking your Bitkit wallet…')).toBeInTheDocument();
    expect(pay).toBeDisabled();

    buyerWallet.state = 'unknown';
    rerender(<MarketplaceCheckout />);
    await waitFor(() => expect(pay).toBeEnabled());
    expect(screen.queryByTestId('marketplace-checkout-bitkit-required')).not.toBeInTheDocument();
    expect(buyerWallet.enabledCalls).toContain(true);
  });

  it.each(['paykit', 'paypal'] as const)('uses simulated sandbox payment with %s selected', async (method) => {
    const user = userEvent.setup();
    seededCart();
    view.payResult = { ok: true, orderIds: ['018f47d2-6a27-7c23-a49d-000000000001'], boundOrders: [] };

    render(<MarketplaceCheckout />);
    expect(await screen.findByTestId('marketplace-checkout-method-paykit')).toHaveAttribute('aria-pressed', 'true');
    if (method === 'paypal') await user.click(screen.getByTestId('marketplace-checkout-method-paypal'));
    await fillValidDelivery(user);
    await user.click(screen.getByTestId('marketplace-checkout-pay'));

    expect(checkoutActions.pay).toHaveBeenCalledWith(null, expect.any(Function));
    await waitFor(() => expect(window.location.hash).toBe('#018f47d2-6a27-7c23-a49d-000000000001'));
  });

  it.each(['paykit', 'paypal'] as const)('preserves the selected %s rail for real checkout', async (method) => {
    const user = userEvent.setup();
    seededCart();
    view.adapterMode = 'transaction-service';
    view.hasMarketplaceSession = true;

    render(<MarketplaceCheckout />);
    await user.click(await screen.findByTestId(`marketplace-checkout-method-${method}`));
    await fillValidDelivery(user);
    const pay = screen.getByTestId('marketplace-checkout-pay');
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    expect(checkoutActions.pay).toHaveBeenCalledWith(method, expect.any(Function));
  });

  describe('PayPal hand-off leaves the Shop through the top window', () => {
    const PAYPAL_URL = 'https://www.paypal.com/checkoutnow?token=EC-ABC123';

    async function payWithPaypal() {
      const user = userEvent.setup();
      seededCart();
      view.adapterMode = 'transaction-service';
      view.hasMarketplaceSession = true;
      render(<MarketplaceCheckout />);
      await user.click(await screen.findByTestId('marketplace-checkout-method-paypal'));
      await fillValidDelivery(user);
      const pay = screen.getByTestId('marketplace-checkout-pay');
      await waitFor(() => expect(pay).toBeEnabled());
      await user.click(pay);
    }

    it('navigates the top window to the single PayPal checkout URL', async () => {
      view.payResult = {
        ok: true,
        orderIds: ['018f47d2-6a27-7c23-a49d-000000000001'],
        boundOrders: [{ fiatCheckoutUrl: PAYPAL_URL }],
      };

      await payWithPaypal();

      await waitFor(() => expect(navigation.navigateTop).toHaveBeenCalledTimes(1));
      expect(navigation.navigateTop).toHaveBeenCalledWith(PAYPAL_URL);
    });

    it('stays on the order overview when no order carries a PayPal URL', async () => {
      view.payResult = {
        ok: true,
        orderIds: ['018f47d2-6a27-7c23-a49d-000000000001'],
        boundOrders: [{ fiatCheckoutUrl: null }],
      };

      await payWithPaypal();

      await waitFor(() => expect(window.location.hash).toBe('#018f47d2-6a27-7c23-a49d-000000000001'));
      expect(navigation.navigateTop).not.toHaveBeenCalled();
    });

    it('does not guess when several orders carry a PayPal URL', async () => {
      view.payResult = {
        ok: true,
        orderIds: ['018f47d2-6a27-7c23-a49d-000000000001', '018f47d2-6a27-7c23-a49d-000000000002'],
        boundOrders: [{ fiatCheckoutUrl: PAYPAL_URL }, { fiatCheckoutUrl: `${PAYPAL_URL}-2` }],
      };

      await payWithPaypal();

      await waitFor(() => expect(window.location.hash).toBe('#018f47d2-6a27-7c23-a49d-000000000001'));
      expect(navigation.navigateTop).not.toHaveBeenCalled();
    });
  });

  it('shows no guarantee checkbox and enables pay on a valid delivery alone', async () => {
    seededCart();

    render(<MarketplaceCheckout />);

    expect(screen.queryByRole('checkbox', { name: /guarantee/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/guarantee/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('marketplace-checkout-pay')).toBeDisabled();

    await fillValidDelivery(userEvent.setup());
    await waitFor(() => expect(screen.getByTestId('marketplace-checkout-pay')).toBeEnabled());
  });

  it('re-opens Ring approval when a session expires mid-flow', () => {
    seededCart();
    view.adapterMode = 'locks-paykit';
    view.hasMarketplaceSession = true;
    view.needsSession = true;
    view.sessionError = 'Marketplace session required.';

    render(<MarketplaceCheckout />);

    expect(screen.getByRole('heading', { name: 'Enable purchases' })).toBeInTheDocument();
    expect(screen.getByTestId('marketplace-checkout-pay')).toBeDisabled();
  });

  it('shows an empty checkout when the cart has no ordinary items', () => {
    render(<MarketplaceCheckout />);

    expect(screen.getByText('Nothing to check out')).toBeInTheDocument();
  });

  describe('checkout order overview', () => {
    afterEach(() => {
      window.location.hash = '';
    });

    const showPaidOrder = (overrides: { paymentMethod: 'bitcoin' | 'paypal'; confirmations: number }) => {
      const payment = createPaymentFixture('confirmed', {
        adapter: overrides.paymentMethod === 'bitcoin' ? 'paykit' : 'paypal',
        confirmations: overrides.confirmations,
      });
      const order = createOrderFixture('paid', {
        paymentId: payment.id,
        paymentMethod: overrides.paymentMethod,
        paykitRequestState: overrides.paymentMethod === 'bitcoin' ? 'confirmed' : null,
      });
      view.orders = [{ order, payment }];
      window.location.hash = `#${order.id}`;
      render(<MarketplaceCheckout />);
    };

    it('shows order snapshot items in the checkout overview', async () => {
      showPaidOrder({ paymentMethod: 'paypal', confirmations: 0 });
      expect(screen.getByRole('link', { name: 'Handmade leather boots' })).toBeInTheDocument();
      expect(screen.getByText('Quantity 1')).toBeInTheDocument();
      expect(screen.getByText('Review your items and payment status.')).toBeInTheDocument();
      await waitFor(() => expect(CommerceController.getOrFetchListing).toHaveBeenCalled());
      // The current listing title differs; the order snapshot must remain visible.
      expect(screen.queryByRole('link', { name: 'Vintage boots' })).not.toBeInTheDocument();
    });

    it('confirms cancellation of a pending PayPal checkout through the existing order action', async () => {
      const user = userEvent.setup();
      checkoutActions.actOnOrder.mockClear();
      const payment = createPaymentFixture('awaiting_entitlement');
      const order = createOrderFixture('pending_payment', { paymentId: payment.id, paymentMethod: 'paypal' });
      view.orders = [{ order, payment }];
      window.location.hash = `#${order.id}`;
      render(<MarketplaceCheckout />);

      expect(screen.getByTestId('payment-status-panel')).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Checkout complete' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Cancel checkout' }));
      expect(screen.getByRole('dialog')).toHaveTextContent('Cancel checkout');
      expect(checkoutActions.actOnOrder).not.toHaveBeenCalled();
      await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Changed my mind');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));
      await waitFor(() =>
        expect(checkoutActions.actOnOrder).toHaveBeenCalledWith(order, 'order.cancel_request', {
          reason: 'Changed my mind',
        }),
      );
    });

    it('shows the reserved header for a pending PayPal checkout that is not yet awaiting entitlement', () => {
      const order = createOrderFixture('pending_payment', { paymentMethod: 'paypal' });
      view.orders = [{ order, payment: null }];
      window.location.hash = `#${order.id}`;
      render(<MarketplaceCheckout />);

      expect(screen.getByText(/Awaiting payment · Item reserved/)).toBeInTheDocument();
    });

    it('drops the reserved header once the buyer has cancelled the checkout (#50)', () => {
      const payment = createPaymentFixture('awaiting_entitlement');
      const order = createOrderFixture('cancelled', {
        paymentId: payment.id,
        paymentMethod: 'paypal',
        holdExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
      view.orders = [{ order, payment }];
      window.location.hash = `#${order.id}`;
      render(<MarketplaceCheckout />);

      expect(screen.getByTestId('payment-status-panel')).toBeInTheDocument();
      expect(screen.queryByText(/Awaiting payment/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Item reserved/)).not.toBeInTheDocument();
      expect(screen.queryByText('Checkout in progress')).not.toBeInTheDocument();
    });

    it('drops the reserved header for a cancelled order that was never bound to a method', () => {
      const order = createOrderFixture('cancelled', { paymentMethod: null });
      view.orders = [{ order, payment: null }];
      window.location.hash = `#${order.id}`;
      render(<MarketplaceCheckout />);

      expect(screen.queryByText('Checkout in progress')).not.toBeInTheDocument();
      expect(screen.queryByText(/Awaiting payment/)).not.toBeInTheDocument();
    });

    it('keeps the reserved header for a single Paykit order nothing has been paid on yet', () => {
      view.adapterMode = 'transaction-service';
      const { order, payment } = createPaykitOrderFixture('unpaid');
      view.orders = [{ order, payment }];
      window.location.hash = `#${order.id}`;
      render(<MarketplaceCheckout />);

      expect(screen.getByText(/Awaiting payment · Item reserved/)).toBeInTheDocument();
      expect(screen.getByTestId('payment-status-panel')).toBeInTheDocument();
    });

    it('keeps the status card for a single Paykit order paid in USDT, and shows the badge for one paid in Bitcoin', () => {
      view.adapterMode = 'transaction-service';
      const usdt = createPaykitOrderFixture('paid-usdt');
      view.orders = [usdt];
      window.location.hash = `#${usdt.order.id}`;
      const first = render(<MarketplaceCheckout />);
      expect(screen.getByTestId('payment-status-panel')).toBeInTheDocument();
      first.unmount();

      const bitcoin = createPaykitOrderFixture('paid-bitcoin');
      view.orders = [bitcoin];
      window.location.hash = `#${bitcoin.order.id}`;
      render(<MarketplaceCheckout />);
      expect(screen.queryByTestId('payment-status-panel')).not.toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Checkout complete' })).toBeInTheDocument();
    });

    it('omits the duplicate confirmation heading and cancellation for a paid order', () => {
      showPaidOrder({ paymentMethod: 'paypal', confirmations: 0 });
      expect(screen.queryByTestId('marketplace-checkout-paid-headline')).not.toBeInTheDocument();
      expect(screen.queryByTestId('payment-status-panel')).not.toBeInTheDocument();
      expect(screen.getByTestId('order-reference')).toHaveTextContent('Payment confirmed');
      expect(screen.getByRole('group', { name: 'Checkout complete' })).toBeInTheDocument();
      expect(screen.queryByText('Checkout in progress')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancel checkout' })).not.toBeInTheDocument();
    });
  });
});

describe('MarketplaceCheckout local pickup (Wave 7, §A2)', () => {
  beforeEach(() => {
    resetCheckoutView();
  });

  it('offers the fulfillment choice only when every line in the group publishes both', async () => {
    const user = userEvent.setup();
    seededCart();
    view.fulfillmentOptions = { [listing.record.ownerPubky]: ['shipping', 'pickup'] };

    render(<MarketplaceCheckout />);

    const select = screen.getByLabelText(`Fulfillment for items from ${listing.record.ownerPubky}`);
    expect(select).toHaveTextContent('Ship it');
    await user.click(select);
    await user.click(screen.getByRole('option', { name: 'Local pickup' }));
    expect(checkoutActions.setFulfillmentChoice).toHaveBeenCalledWith(listing.record.ownerPubky, 'pickup');
  });

  it('renders a pickup group with no shipping line and the reveal note', () => {
    seededCart();
    view.fulfillmentEffective = { [listing.record.ownerPubky]: 'pickup' };
    view.requiresDeliveryAddress = false;

    render(<MarketplaceCheckout />);

    expect(screen.getByText(/Local pickup — no delivery address or shipping for these items/)).toBeInTheDocument();
    expect(document.querySelector('[data-surface="checkout-pickup-group"]')).toBeTruthy();
  });

  it('hides the delivery-address step on a pickup-only checkout and says why', () => {
    seededCart();
    view.fulfillmentEffective = { [listing.record.ownerPubky]: 'pickup' };
    view.requiresDeliveryAddress = false;

    render(<MarketplaceCheckout />);

    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
    expect(
      screen.getByText('No delivery address needed. Pickup location is shared once payment is confirmed.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No shipping — pickup is arranged with the seller after payment.')).toBeInTheDocument();
    expect(screen.getByTestId('marketplace-checkout-payment-notice-group')).toHaveTextContent('Local pickup');
  });

  it('states the (seller, fulfillment) split plainly before pay', () => {
    view.items = [
      { id: 'seller:boots:variant_42', listingId: listing.id, variantId: 'variant_42', quantity: 1, listing },
      {
        id: 'other:camera:variant_01',
        listingId: secondSellerListing.id,
        variantId: 'variant_01',
        quantity: 1,
        listing: secondSellerListing,
      },
    ];
    view.orderCount = 2;

    render(<MarketplaceCheckout />);

    expect(screen.getByText(/Each order requires a separate payment\./)).toBeInTheDocument();
  });

  it('blocks pay and explains when a group has no common fulfillment', () => {
    seededCart();
    view.fulfillmentOptions = { [listing.record.ownerPubky]: [] };
    view.fulfillmentEffective = {};
    view.hasFulfillmentConflict = true;

    render(<MarketplaceCheckout />);

    expect(screen.getByRole('alert')).toHaveTextContent(/can't be checked out together/);
    expect(screen.getByTestId('marketplace-checkout-pay')).toBeDisabled();
    expect(screen.getByText("Some items can't be checked out together — see the note above.")).toHaveAttribute(
      'id',
      'checkout-pay-reason',
    );
  });

  it('shows a skeleton instead of pickup or conflict copy while pickup capability is loading', () => {
    seededCart();
    view.isPickupCapabilityLoading = true;
    view.fulfillmentOptions = { [listing.record.ownerPubky]: [] };
    view.hasFulfillmentConflict = true;

    render(<MarketplaceCheckout />);

    expect(screen.getByTestId('pickup-capability-skeleton')).toHaveAttribute(
      'aria-label',
      'Checking pickup availability',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Local pickup — no delivery address/)).not.toBeInTheDocument();
  });
});

describe('MarketplaceCheckout digital lines (digital delivery design §3 "Checkout")', () => {
  const CART_ITEM_ID = 'seller:boots:variant_42';

  beforeEach(() => {
    resetCheckoutView();
  });

  it('adds no shipping for a line the buyer takes digitally', () => {
    view.items = [
      {
        id: CART_ITEM_ID,
        listingId: listing.id,
        variantId: 'variant_42',
        quantity: 1,
        listing: {
          ...listing,
          record: {
            ...listing.record,
            shippingOptions: [
              {
                id: 'ground',
                pricing: 'flat',
                label: 'Ground',
                price: { amountMinor: 500, currency: 'USD', exponent: 2 },
                estimatedMinDays: 3,
                estimatedMaxDays: 7,
              },
            ],
          },
        },
      },
    ];
    const { unmount } = render(<MarketplaceCheckout />);
    expect(screen.getByText('Shipping')).toBeInTheDocument();
    unmount();

    view.fulfillmentByItem = { [CART_ITEM_ID]: 'digital' };
    view.requiresDeliveryAddress = false;
    render(<MarketplaceCheckout />);
    expect(screen.queryByText('Shipping')).not.toBeInTheDocument();
    expect(screen.getByText('Delivery').parentElement).not.toHaveTextContent('$');
    expect(screen.getByText('No shipping for digital items.')).toBeInTheDocument();
  });

  it('shows no fulfillment conflict for a seller whose lines are all digital', () => {
    seededCart();
    view.fulfillmentOptions = { [listing.record.ownerPubky]: [] };
    view.fulfillmentByItem = { [CART_ITEM_ID]: 'digital' };

    render(<MarketplaceCheckout />);

    expect(screen.queryByText(/can't be checked out together/)).not.toBeInTheDocument();
  });

  it('shows no fulfillment conflict while the digital capability loads', () => {
    seededCart();
    view.fulfillmentOptions = { [listing.record.ownerPubky]: [] };
    view.isDigitalCapabilityLoading = true;
    view.isDigitalReady = false;

    render(<MarketplaceCheckout />);

    expect(screen.queryByText(/can't be checked out together/)).not.toBeInTheDocument();
    expect(screen.getByTestId('marketplace-checkout-pay')).toBeDisabled();
  });

  it('labels a digital line with how it arrives', () => {
    seededCart();
    view.requiresDeliveryAddress = false;
    view.fulfillmentByItem = { [CART_ITEM_ID]: 'digital' };
    view.digitalKinds = { [CART_ITEM_ID]: 'file' };

    render(<MarketplaceCheckout />);

    expect(screen.getByTestId('checkout-digital-line')).toHaveTextContent('Digital delivery · Instant download');
  });

  it('says a line cannot be bought until its seller sets delivery (B4)', () => {
    seededCart();
    view.requiresDeliveryAddress = false;
    view.fulfillmentByItem = { [CART_ITEM_ID]: 'digital' };
    view.digitalKinds = { [CART_ITEM_ID]: null };
    view.digitalNotReadyItemIds = [CART_ITEM_ID];
    view.isDigitalReady = false;

    render(<MarketplaceCheckout />);

    expect(screen.getByTestId('checkout-digital-line')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('checkout-digital-line')).toHaveTextContent(
      "The seller hasn't finished setting up delivery for this item.",
    );
    expect(document.getElementById('checkout-pay-reason')).toHaveTextContent(
      "An item's seller hasn't finished setting up delivery. Remove it in the cart to continue.",
    );
  });

  it('says Pay unlocks once delivery options load', () => {
    seededCart();
    view.isDigitalReady = false;

    render(<MarketplaceCheckout />);

    expect(document.getElementById('checkout-pay-reason')).toHaveTextContent('Pay unlocks once delivery options load.');
  });

  it('offers Physical copy or Digital delivery on a line whose listing offers both', async () => {
    const user = userEvent.setup();
    seededCart();
    view.digitalChoosable = [CART_ITEM_ID];

    render(<MarketplaceCheckout />);

    const select = screen.getByLabelText(`Delivery for ${listing.record.title}`);
    expect(select).toHaveTextContent('Physical copy');
    await user.click(select);
    await user.click(screen.getByRole('option', { name: 'Digital delivery' }));
    expect(checkoutActions.setDigitalChoice).toHaveBeenCalledWith(CART_ITEM_ID, true);
  });

  it('asks for the email for an email-kind line, with the disclosure (§3, F1)', () => {
    seededCart();
    view.requiresDeliveryAddress = false;
    view.requiresDeliveryEmail = true;
    view.fulfillmentByItem = { [CART_ITEM_ID]: 'digital' };
    view.digitalKinds = { [CART_ITEM_ID]: 'email' };

    render(<MarketplaceCheckout />);

    expect(screen.getByRole('heading', { name: 'Email for delivery' })).toBeInTheDocument();
    expect(
      screen.getByText(
        "The seller of this item sees this after your payment is confirmed, to send your order. It isn't used for anything else.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('maxLength', '254');
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
  });

  it('asks for no email when no line is email-kind', () => {
    seededCart();

    render(<MarketplaceCheckout />);

    expect(screen.queryByRole('heading', { name: 'Email for delivery' })).not.toBeInTheDocument();
  });

  it('states each consent line above Pay', () => {
    seededCart();
    view.hasInstantDigitalLine = true;
    view.hasManualDigitalLine = true;

    render(<MarketplaceCheckout />);

    expect(screen.getByTestId('checkout-consent-instant')).toHaveTextContent(
      "Delivery starts as soon as payment is confirmed. Digital orders can't be cancelled once delivered; message the seller about a refund.",
    );
    expect(screen.getByTestId('checkout-consent-manual')).toHaveTextContent(
      'You can ask to cancel until the seller marks it delivered.',
    );
  });

  it('shows no pickup copy on an all-digital checkout', () => {
    seededCart();
    view.requiresDeliveryAddress = false;
    view.fulfillmentByItem = { [CART_ITEM_ID]: 'digital' };
    view.digitalKinds = { [CART_ITEM_ID]: 'file' };

    render(<MarketplaceCheckout />);

    expect(screen.queryByText(/No delivery address needed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pickup is arranged/)).not.toBeInTheDocument();
    expect(screen.getByText('No shipping for digital items.')).toBeInTheDocument();
  });

  it('keeps Pay disabled until every digital line is ready', async () => {
    const user = userEvent.setup();
    seededCart();
    view.isDigitalReady = false;

    render(<MarketplaceCheckout />);
    await fillValidDelivery(user);

    expect(screen.getByTestId('marketplace-checkout-pay')).toBeDisabled();
  });
});

describe('MarketplaceCheckout with no usable payment method', () => {
  const ALL_RAILS = {
    bitcoinAvailable: true,
    bitcoinOfferAvailable: true,
    paypalAvailable: true,
  };
  const NO_RAILS = {
    bitcoinAvailable: false,
    bitcoinOfferAvailable: true,
    paypalAvailable: false,
  };

  beforeEach(() => {
    resetCheckoutView();
    view.adapterMode = 'locks-paykit';
    view.hasMarketplaceSession = true;
  });

  afterEach(() => {
    vi.mocked(CommerceController.getSellerPaymentConfig).mockImplementation(async () => ALL_RAILS);
  });

  it('says the one seller has not set up a method this cart can use, without multi-seller advice', async () => {
    seededCart();
    vi.mocked(CommerceController.getSellerPaymentConfig).mockImplementation(async () => NO_RAILS);

    render(<MarketplaceCheckout />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This seller hasn't set up a payment method this cart can use, so Pay stays disabled.",
    );
    expect(screen.queryByText(/These sellers do not share a payment method/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Remove a seller/)).not.toBeInTheDocument();
    expect(screen.getByText('Pay unlocks once this seller sets up a payment method.')).toHaveAttribute(
      'id',
      'checkout-pay-reason',
    );
    expect(screen.getByTestId('marketplace-checkout-pay')).toBeDisabled();
  });

  it('offers PayPal for a seller whose public config has only a PayPal email', async () => {
    seededCart();
    vi.mocked(CommerceController.getSellerPaymentConfig).mockImplementation(async () => ({
      ...NO_RAILS,
      paypalAvailable: true,
    }));

    render(<MarketplaceCheckout />);

    expect(await screen.findByTestId('marketplace-checkout-method-paypal')).toHaveTextContent('PayPal');
    expect(screen.queryByTestId('marketplace-checkout-method-paykit')).not.toBeInTheDocument();
    expect(screen.queryByText(/hasn't set up a payment method/)).not.toBeInTheDocument();
  });

  describe('a Paykit outage', () => {
    const PAYKIT_DOWN = { ...NO_RAILS, bitcoinOfferAvailable: false, paykitUnreachable: true };

    afterEach(() => {
      vi.useRealTimers();
    });

    it('says Paykit is unreachable, never "no payment method", and re-enables Pay when Paykit is back', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      seededCart();
      vi.mocked(CommerceController.getSellerPaymentConfig)
        .mockImplementationOnce(async () => PAYKIT_DOWN)
        .mockImplementation(async () => ALL_RAILS);

      render(<MarketplaceCheckout />);

      expect(await screen.findByRole('status')).toHaveTextContent('Paykit is temporarily unreachable, retrying…');
      expect(screen.queryByText(/hasn't set up a payment method/)).not.toBeInTheDocument();
      expect(screen.queryByText('Pay unlocks once this seller sets up a payment method.')).not.toBeInTheDocument();
      expect(
        screen.getByText('Paykit is temporarily unreachable, retrying…', { selector: '#checkout-pay-reason' }),
      ).toBeInTheDocument();
      expect(screen.getByTestId('marketplace-checkout-pay')).toBeDisabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });

      expect(await screen.findByTestId('marketplace-checkout-method-paykit')).toBeInTheDocument();
      expect(screen.queryByText('Paykit is temporarily unreachable, retrying…')).not.toBeInTheDocument();
    });

    it('turns a Paykit-refused Pay into the same retrying state and re-enables Pay without a reload', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      seededCart();
      view.adapterMode = 'transaction-service';
      view.hasMarketplaceSession = true;
      view.payResult = { ok: false, orderIds: [], boundOrders: [], paykitUnavailable: true } as typeof view.payResult;

      render(<MarketplaceCheckout />);
      await user.click(await screen.findByTestId('marketplace-checkout-method-paykit'));
      await fillValidDelivery(user);
      const pay = screen.getByTestId('marketplace-checkout-pay');
      await waitFor(() => expect(pay).toBeEnabled());
      await user.click(pay);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      expect(document.getElementById('checkout-pay-reason')).toHaveTextContent(
        'Paykit is temporarily unreachable, retrying…',
      );
      expect(screen.getByText(/Paykit returns on its own; PayPal is unaffected\./)).toBeInTheDocument();
      expect(pay).toBeDisabled();
      expect(screen.getByTestId('marketplace-checkout-method-paypal')).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      await waitFor(() => expect(pay).toBeEnabled());
      expect(screen.queryByText(/Paykit is temporarily unreachable, retrying…/)).not.toBeInTheDocument();
    });

    it('keeps the outage showing while a recheck is in flight, and leaves it only when the re-read finds Paykit reachable', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      seededCart();
      view.adapterMode = 'transaction-service';
      view.hasMarketplaceSession = true;
      view.payResult = { ok: false, orderIds: [], boundOrders: [], paykitUnavailable: true } as typeof view.payResult;

      render(<MarketplaceCheckout />);
      await user.click(await screen.findByTestId('marketplace-checkout-method-paykit'));
      await fillValidDelivery(user);
      const pay = screen.getByTestId('marketplace-checkout-pay');
      await waitFor(() => expect(pay).toBeEnabled());
      await user.click(pay);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(pay).toBeDisabled();

      let finishRead: (config: typeof ALL_RAILS) => void = () => {};
      vi.mocked(CommerceController.getSellerPaymentConfig).mockImplementation(
        () =>
          new Promise((resolve) => {
            finishRead = resolve as typeof finishRead;
          }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });

      expect(pay).toBeDisabled();
      expect(document.getElementById('checkout-pay-reason')).toHaveTextContent(
        'Paykit is temporarily unreachable, retrying…',
      );
      expect(screen.queryByText(/hasn't set up a payment method/)).not.toBeInTheDocument();
      expect(screen.queryByText('Pay unlocks once this seller sets up a payment method.')).not.toBeInTheDocument();

      await act(async () => {
        finishRead(ALL_RAILS);
      });
      await waitFor(() => expect(pay).toBeEnabled());
    });

    it('backs off 5s, 10s, 20s while a refused Pay is still being checked, keeping Pay disabled throughout', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      seededCart();
      view.adapterMode = 'transaction-service';
      view.hasMarketplaceSession = true;
      view.payResult = { ok: false, orderIds: [], boundOrders: [], paykitUnavailable: true } as typeof view.payResult;

      render(<MarketplaceCheckout />);
      await user.click(await screen.findByTestId('marketplace-checkout-method-paykit'));
      await fillValidDelivery(user);
      const pay = screen.getByTestId('marketplace-checkout-pay');
      await waitFor(() => expect(pay).toBeEnabled());
      vi.mocked(CommerceController.getSellerPaymentConfig).mockImplementation(() => new Promise(() => {}));
      await user.click(pay);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      vi.mocked(CommerceController.getSellerPaymentConfig).mockClear();

      const reads = () => vi.mocked(CommerceController.getSellerPaymentConfig).mock.calls.length;
      // Elapsed since the refusal: re-reads are due near 5s, 15s and 35s, with margins for real-time drift.
      for (const [delay, expectedReads] of [
        [4_000, 0],
        [2_000, 1],
        [8_000, 1],
        [3_000, 2],
        [17_000, 2],
        [3_000, 3],
      ] as const) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(delay);
        });
        expect(reads()).toBe(expectedReads);
        expect(pay).toBeDisabled();
        expect(document.getElementById('checkout-pay-reason')).toHaveTextContent(
          'Paykit is temporarily unreachable, retrying…',
        );
      }
    });

    it('keeps retrying after the seller config read fails, and recovers with no click on Retry', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      seededCart();
      vi.mocked(CommerceController.getSellerPaymentConfig)
        .mockRejectedValueOnce(new Error('network down'))
        .mockRejectedValueOnce(new Error('network down'))
        .mockImplementation(async () => ALL_RAILS);

      render(<MarketplaceCheckout />);

      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load payment options.");
      expect(screen.queryByTestId('marketplace-checkout-method-paykit')).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load payment options.");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(await screen.findByTestId('marketplace-checkout-method-paykit')).toBeInTheDocument();
      expect(screen.queryByText("Couldn't load payment options.")).not.toBeInTheDocument();
    });

    it('stops rechecking once the cart is emptied after a failed read', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      seededCart();
      vi.mocked(CommerceController.getSellerPaymentConfig).mockRejectedValue(new Error('network down'));

      const { rerender } = render(<MarketplaceCheckout />);
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load payment options.");

      view.items = [];
      rerender(<MarketplaceCheckout />);
      expect(screen.getByText('Nothing to check out')).toBeInTheDocument();
      vi.mocked(CommerceController.getSellerPaymentConfig).mockClear();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });

      expect(CommerceController.getSellerPaymentConfig).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps the Paykit outage retrying through a failed read until Paykit is back', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      seededCart();
      vi.mocked(CommerceController.getSellerPaymentConfig)
        .mockImplementationOnce(async () => PAYKIT_DOWN)
        .mockRejectedValueOnce(new Error('network down'))
        .mockImplementation(async () => ALL_RAILS);

      render(<MarketplaceCheckout />);
      expect(await screen.findByRole('status')).toHaveTextContent('Paykit is temporarily unreachable, retrying…');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(await screen.findByTestId('marketplace-checkout-method-paykit')).toBeInTheDocument();
      expect(screen.queryByText(/Paykit is temporarily unreachable/)).not.toBeInTheDocument();
    });

    it('keeps the working methods usable and explains that Paykit returns on its own', async () => {
      seededCart();
      vi.mocked(CommerceController.getSellerPaymentConfig).mockImplementation(async () => ({
        ...PAYKIT_DOWN,
        paypalAvailable: true,
      }));

      render(<MarketplaceCheckout />);

      expect(await screen.findByTestId('marketplace-checkout-method-paypal')).toBeInTheDocument();
      expect(screen.queryByTestId('marketplace-checkout-method-paykit')).not.toBeInTheDocument();
      expect(screen.getByText(/Paykit returns on its own; PayPal is unaffected\./)).toBeInTheDocument();
    });
  });

  it('shows loading, not "no payment method", while a PayPal seller config loads after the cart hydrates', async () => {
    let resolveConfig: (config: typeof NO_RAILS) => void = () => {};
    vi.mocked(CommerceController.getSellerPaymentConfig).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveConfig = resolve as typeof resolveConfig;
        }),
    );

    const { rerender } = render(<MarketplaceCheckout />);
    expect(screen.getByText('Nothing to check out')).toBeInTheDocument();

    seededCart();
    rerender(<MarketplaceCheckout />);

    expect(await screen.findByLabelText('Loading payment methods')).toBeInTheDocument();
    expect(screen.queryByText(/hasn't set up a payment method/)).not.toBeInTheDocument();
    expect(screen.queryByText('Pay unlocks once this seller sets up a payment method.')).not.toBeInTheDocument();

    await waitFor(() => expect(CommerceController.getSellerPaymentConfig).toHaveBeenCalled());
    resolveConfig({ ...NO_RAILS, paypalAvailable: true });

    expect(await screen.findByTestId('marketplace-checkout-method-paypal')).toBeInTheDocument();
    expect(screen.queryByText(/hasn't set up a payment method/)).not.toBeInTheDocument();
  });

  it('offers Retry, not "no payment method", when the seller config read fails', async () => {
    const user = userEvent.setup();
    seededCart();
    vi.mocked(CommerceController.getSellerPaymentConfig).mockRejectedValueOnce(new Error('network down'));

    render(<MarketplaceCheckout />);

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load payment options.");
    expect(screen.queryByText(/hasn't set up a payment method/)).not.toBeInTheDocument();
    expect(screen.queryByText('Pay unlocks once this seller sets up a payment method.')).not.toBeInTheDocument();
    expect(screen.getByText('Pay unlocks once payment options load.')).toHaveAttribute('id', 'checkout-pay-reason');
    expect(screen.getByTestId('marketplace-checkout-pay')).toBeDisabled();

    vi.mocked(CommerceController.getSellerPaymentConfig).mockImplementation(async () => ({
      ...NO_RAILS,
      paypalAvailable: true,
    }));
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('marketplace-checkout-method-paypal')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load payment options.")).not.toBeInTheDocument();
  });

  it('keeps the shared-rail advice when two sellers have no method in common', async () => {
    view.items = [
      { id: 'seller:boots:variant_42', listingId: listing.id, variantId: 'variant_42', quantity: 1, listing },
      {
        id: 'other:camera:variant_01',
        listingId: secondSellerListing.id,
        variantId: 'variant_01',
        quantity: 1,
        listing: secondSellerListing,
      },
    ];
    vi.mocked(CommerceController.getSellerPaymentConfig).mockImplementation(async (sellerPubky: unknown) =>
      sellerPubky === listing.record.ownerPubky ? { ...NO_RAILS, paypalAvailable: true } : NO_RAILS,
    );

    render(<MarketplaceCheckout />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'These sellers do not share a payment method, so Pay stays disabled. Remove a seller in the cart or ask them to add a shared rail.',
    );
    expect(screen.queryByText(/This seller hasn't set up/)).not.toBeInTheDocument();
    expect(screen.getByText('Choose sellers that share a payment method.')).toHaveAttribute(
      'id',
      'checkout-pay-reason',
    );
  });
});

describe('MarketplaceCheckout Paykit option (Bitcoin or USDT)', () => {
  const RAILS_WITH_USDT = {
    bitcoinAvailable: true,
    bitcoinOfferAvailable: true,
    paypalAvailable: true,
    usdtAvailable: true,
  };
  const usdSecondSeller = {
    ...secondSellerListing,
    record: {
      ...secondSellerListing.record,
      sale: { format: 'fixed_price', unitPrice: { amountMinor: 4500, currency: 'USD', exponent: 2 } },
    },
  };
  const twoSellerItems = () => [
    { id: 'seller:boots:variant_42', listingId: listing.id, variantId: 'variant_42', quantity: 1, listing },
    {
      id: 'other:camera:variant_01',
      listingId: usdSecondSeller.id,
      variantId: 'variant_01',
      quantity: 1,
      listing: usdSecondSeller,
    },
  ];
  const onlyFirstSellerTakesUsdt = async (sellerPubky: unknown) =>
    sellerPubky === listing.record.ownerPubky ? RAILS_WITH_USDT : { ...RAILS_WITH_USDT, usdtAvailable: false };

  beforeEach(() => {
    resetCheckoutView();
    view.adapterMode = 'transaction-service';
    view.hasMarketplaceSession = true;
    vi.mocked(CommerceController.fetchUsdtPaymentsAvailable).mockResolvedValue(true);
    vi.mocked(CommerceController.getSellerPaymentConfig).mockImplementation(async () => RAILS_WITH_USDT);
  });

  afterEach(() => {
    vi.mocked(CommerceController.fetchUsdtPaymentsAvailable).mockResolvedValue(false);
    vi.mocked(CommerceController.getSellerPaymentConfig).mockImplementation(async () => ({
      bitcoinAvailable: true,
      bitcoinOfferAvailable: true,
      paypalAvailable: true,
    }));
  });

  it('offers one Pay with Paykit entry beside PayPal, never separate Bitcoin and USDT entries', async () => {
    seededCart();

    render(<MarketplaceCheckout />);

    const paykit = await screen.findByTestId('marketplace-checkout-method-paykit');
    expect(paykit).toHaveTextContent('Pay with Paykit');
    expect(paykit).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('marketplace-checkout-method-paypal')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-checkout-method-bitcoin')).not.toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-checkout-method-usdt')).not.toBeInTheDocument();
    expect(screen.getByTestId('marketplace-checkout-paykit-requirement')).toHaveTextContent(
      'Paykit payments require Bitkit. You choose Bitcoin or USDT there.',
    );
  });

  it('does not let a USDT-only Paykit entry be paid while Paykit is unreachable, and keeps PayPal usable', async () => {
    seededCart();
    vi.mocked(CommerceController.getSellerPaymentConfig).mockImplementation(async () => ({
      bitcoinAvailable: false,
      bitcoinOfferAvailable: false,
      paypalAvailable: true,
      usdtAvailable: true,
      paykitUnreachable: true,
    }));

    render(<MarketplaceCheckout />);

    await userEvent.click(await screen.findByTestId('marketplace-checkout-method-paykit'));
    expect(screen.getByTestId('marketplace-checkout-pay')).toBeDisabled();
    expect(document.getElementById('checkout-pay-reason')).toHaveTextContent(
      'Paykit is temporarily unreachable, retrying…',
    );
    expect(screen.queryByTestId('marketplace-checkout-method-bitcoin')).not.toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-checkout-method-usdt')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('marketplace-checkout-method-paypal'));
    expect(document.getElementById('checkout-pay-reason')).not.toHaveTextContent('Paykit is temporarily unreachable');
  });

  it('says Bitcoin only while the gate is off, even when the seller says USDT is available', async () => {
    seededCart();
    vi.mocked(CommerceController.fetchUsdtPaymentsAvailable).mockResolvedValue(false);

    render(<MarketplaceCheckout />);

    expect(await screen.findByTestId('marketplace-checkout-paykit-requirement')).toHaveTextContent(
      'Bitcoin payments require Bitkit. Marketplace currently supports on-chain bitcoin payments only.',
    );
    expect(screen.queryByText(/USDT/)).not.toBeInTheDocument();
  });

  it('says Bitcoin only when the seller public config does not say usdt_available', async () => {
    seededCart();
    vi.mocked(CommerceController.getSellerPaymentConfig).mockImplementation(async () => ({
      ...RAILS_WITH_USDT,
      usdtAvailable: false,
    }));

    render(<MarketplaceCheckout />);

    expect(await screen.findByTestId('marketplace-checkout-paykit-requirement')).toHaveTextContent(
      'Bitcoin payments require Bitkit. Marketplace currently supports on-chain bitcoin payments only.',
    );
    expect(screen.queryByText(/USDT/)).not.toBeInTheDocument();
  });

  it('names USDT on a Bitcoin-priced cart too: the service fixes the rate', async () => {
    view.items = [
      {
        id: 'other:camera:variant_01',
        listingId: secondSellerListing.id,
        variantId: 'variant_01',
        quantity: 1,
        listing: secondSellerListing,
      },
    ];

    render(<MarketplaceCheckout />);

    expect(await screen.findByTestId('marketplace-checkout-paykit-requirement')).toHaveTextContent(
      'Paykit payments require Bitkit. You choose Bitcoin or USDT there.',
    );
    expect(screen.queryByTestId('marketplace-checkout-usdt-missing-note')).not.toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-checkout-usdt-amount')).not.toBeInTheDocument();
  });

  it('names USDT on a multi-seller cart only when every seller takes it, and says who does not', async () => {
    view.items = twoSellerItems();
    vi.mocked(CommerceController.getSellerPaymentConfig).mockImplementation(onlyFirstSellerTakesUsdt);

    render(<MarketplaceCheckout />);

    expect(await screen.findByTestId('marketplace-checkout-paykit-requirement')).toHaveTextContent(
      'Bitcoin payments require Bitkit. Marketplace currently supports on-chain bitcoin payments only.',
    );
    expect(await screen.findByTestId('marketplace-checkout-usdt-missing-note')).toHaveTextContent(
      "USDT isn't available for this cart: Film Camera Supply doesn't accept USDT.",
    );
  });

  it('explains nothing when no seller takes USDT, when USDT is named, or when the gate is off', async () => {
    seededCart();
    vi.mocked(CommerceController.getSellerPaymentConfig).mockImplementation(async () => ({
      ...RAILS_WITH_USDT,
      usdtAvailable: false,
    }));
    const noSeller = render(<MarketplaceCheckout />);
    expect(await screen.findByTestId('marketplace-checkout-paykit-requirement')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-checkout-usdt-missing-note')).not.toBeInTheDocument();
    noSeller.unmount();

    vi.mocked(CommerceController.getSellerPaymentConfig).mockImplementation(async () => RAILS_WITH_USDT);
    const offered = render(<MarketplaceCheckout />);
    expect(await screen.findByTestId('marketplace-checkout-paykit-requirement')).toHaveTextContent('Bitcoin or USDT');
    expect(screen.queryByTestId('marketplace-checkout-usdt-missing-note')).not.toBeInTheDocument();
    offered.unmount();

    vi.mocked(CommerceController.fetchUsdtPaymentsAvailable).mockResolvedValue(false);
    render(<MarketplaceCheckout />);
    expect(await screen.findByTestId('marketplace-checkout-paykit-requirement')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-checkout-usdt-missing-note')).not.toBeInTheDocument();
    expect(screen.queryByText(/USDT/)).not.toBeInTheDocument();
  });

  it('keeps the sandbox off USDT: it binds no real rail, shows no Paykit note and never reads the capability', async () => {
    seededCart();
    view.adapterMode = 'sandbox';

    render(<MarketplaceCheckout />);

    expect(await screen.findByTestId('marketplace-checkout-method-paykit')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-checkout-paykit-note')).not.toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-checkout-usdt-missing-note')).not.toBeInTheDocument();
    expect(screen.queryByText(/USDT/)).not.toBeInTheDocument();
    expect(CommerceController.fetchUsdtPaymentsAvailable).not.toHaveBeenCalled();
  });

  it('shows the USDT amount of a USD cart, the network and the Bitkit hint beside the Paykit entry', async () => {
    seededCart();
    view.paykitServerApi = 'upstream';

    render(<MarketplaceCheckout />);

    expect(await screen.findByTestId('marketplace-checkout-usdt-amount')).toHaveTextContent(
      '12.000000 USDT · USDT0 on Arbitrum One if you pay in USDT',
    );
    expect(screen.getByTestId('marketplace-checkout-paykit-note')).toHaveTextContent(
      'Pay with a Bitkit version that supports USDT.',
    );
    expect(screen.queryByTestId('marketplace-checkout-bitcoin-amount-note')).not.toBeInTheDocument();
  });

  it('hides the whole Paykit note when PayPal is chosen', async () => {
    const user = userEvent.setup();
    seededCart();

    render(<MarketplaceCheckout />);
    await user.click(await screen.findByTestId('marketplace-checkout-method-paypal'));

    expect(screen.queryByTestId('marketplace-checkout-paykit-note')).not.toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-checkout-usdt-amount')).not.toBeInTheDocument();
  });

  it('shows no accept-by line before the request exists: the window starts at activation, on the order page', async () => {
    seededCart();

    render(<MarketplaceCheckout />);
    await screen.findByTestId('marketplace-checkout-paykit-note');

    expect(screen.queryByText(/accept-by|accept by|Approve in Bitkit within/i)).not.toBeInTheDocument();
  });

  it('tells the buyer of a shipped cart that, if they pay in USDT, the seller ships once Arbitrum finalizes it', async () => {
    seededCart();

    render(<MarketplaceCheckout />);

    expect(await screen.findByTestId('marketplace-checkout-usdt-finality-note')).toHaveTextContent(
      'If you pay in USDT, the seller ships once Arbitrum finalizes your payment, usually within minutes.',
    );
  });

  it('leaves the finality note off a cart that is only digital, and off a Bitcoin-only entry', async () => {
    seededCart();
    view.fulfillmentByItem = { 'seller:boots:variant_42': 'digital' };

    const digital = render(<MarketplaceCheckout />);
    expect(await screen.findByTestId('marketplace-checkout-usdt-amount')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-checkout-usdt-finality-note')).not.toBeInTheDocument();
    digital.unmount();

    view.fulfillmentByItem = {};
    vi.mocked(CommerceController.fetchUsdtPaymentsAvailable).mockResolvedValue(false);
    render(<MarketplaceCheckout />);
    expect(await screen.findByTestId('marketplace-checkout-paykit-requirement')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-checkout-paykit-note')).not.toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-checkout-usdt-finality-note')).not.toBeInTheDocument();
  });

  it('keeps the finality note when a digital line rides with a shipped one', async () => {
    view.items = [
      { id: 'seller:boots:variant_42', listingId: listing.id, variantId: 'variant_42', quantity: 1, listing },
      { id: 'seller:boots:variant_43', listingId: listing.id, variantId: 'variant_43', quantity: 1, listing },
    ];
    view.fulfillmentByItem = { 'seller:boots:variant_42': 'digital' };

    render(<MarketplaceCheckout />);

    expect(await screen.findByTestId('marketplace-checkout-usdt-finality-note')).toBeInTheDocument();
  });

  it('says a multi-seller cart needs one approval per seller, and a single-seller cart does not', async () => {
    seededCart();

    const single = render(<MarketplaceCheckout />);
    await screen.findByTestId('marketplace-checkout-paykit-note');
    expect(screen.queryByTestId('marketplace-checkout-usdt-multi-seller-note')).not.toBeInTheDocument();
    single.unmount();

    view.items = twoSellerItems();
    render(<MarketplaceCheckout />);

    expect(await screen.findByTestId('marketplace-checkout-usdt-multi-seller-note')).toHaveTextContent(
      "You'll approve one request per seller in Bitkit.",
    );
  });

  it('keeps the indicative bitcoin estimate while Bitcoin is on offer', async () => {
    seededCart();

    render(<MarketplaceCheckout />);
    await screen.findByTestId('marketplace-checkout-method-paykit');

    expect(screen.getAllByText('≈ ₿137,000').length).toBeGreaterThan(0);
  });

  it('names USDT alone and hides the bitcoin estimate for a seller who takes only USDT', async () => {
    seededCart();
    vi.mocked(CommerceController.getSellerPaymentConfig).mockImplementation(async () => ({
      bitcoinAvailable: false,
      bitcoinOfferAvailable: true,
      paypalAvailable: false,
      usdtAvailable: true,
    }));

    render(<MarketplaceCheckout />);

    expect(await screen.findByTestId('marketplace-checkout-paykit-requirement')).toHaveTextContent(
      'You pay in USDT there.',
    );
    expect(screen.queryByText('≈ ₿137,000')).not.toBeInTheDocument();
  });

  it.each(LISTING_FIAT_CURRENCY_CODES.filter((code) => code !== 'USD'))(
    'shows a %s cart in its own currency and still offers the one Paykit entry',
    async (currency) => {
      const exponent = LISTING_CURRENCY_REGISTRY[currency].exponent;
      const price = { amountMinor: 12 * 10 ** exponent, currency, exponent };
      const priced = {
        ...listing,
        record: { ...listing.record, sale: { format: 'fixed_price', unitPrice: price } },
      };
      view.items = [
        { id: 'seller:boots:variant_42', listingId: priced.id, variantId: 'variant_42', quantity: 1, listing: priced },
      ];

      render(<MarketplaceCheckout />);

      const shown = formatCommerceMoney(price).replace(/\s/g, ' ');
      expect((await screen.findAllByText((text) => text.replace(/\s/g, ' ') === shown)).length).toBeGreaterThan(0);
      expect(await screen.findByTestId('marketplace-checkout-method-paykit')).toHaveTextContent('Pay with Paykit');
      expect(screen.queryByTestId('marketplace-checkout-method-bitcoin')).not.toBeInTheDocument();
      expect(screen.queryByTestId('marketplace-checkout-method-usdt')).not.toBeInTheDocument();
      expect(screen.getByTestId('marketplace-checkout-paykit-requirement')).toHaveTextContent('Bitcoin or USDT');
      expect(screen.queryByTestId('marketplace-checkout-usdt-amount')).not.toBeInTheDocument();
    },
  );

  it('binds the single paykit method for real checkout', async () => {
    const user = userEvent.setup();
    seededCart();

    render(<MarketplaceCheckout />);
    await screen.findByTestId('marketplace-checkout-method-paykit');
    await fillValidDelivery(user);
    const pay = screen.getByTestId('marketplace-checkout-pay');
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    expect(checkoutActions.pay).toHaveBeenCalledWith('paykit', expect.any(Function));
  });
});

const acceptedOffer = {
  id: 'offer-1',
  state: 'accepted',
  buyerPubky: 'b'.repeat(52),
  award: {
    id: 'award-1',
    state: 'active',
    listing: {
      sellerPubky: 's'.repeat(52),
      listingId: 'boots',
      title: 'Vintage boots',
      aggregateId: 'listing:s_boots',
      listingRevision: 3,
      listingRecordSha256: 'a'.repeat(64),
    },
    variant: { id: 'variant_42', options: [{ name: 'Size', value: '42' }] },
    unitPrice: { amountMinor: 600, currency: 'USD', exponent: 2 },
    quantity: 1,
    convertBy: '2026-09-15T12:00:00.000Z',
    subtotal: { amountMinor: 600, currency: 'USD', exponent: 2 },
    shipping: { amountMinor: 100, currency: 'USD', exponent: 2 },
    merchandiseTotal: { amountMinor: 700, currency: 'USD', exponent: 2 },
    fulfillmentMethods: ['shipping'],
  },
};

describe('MarketplaceCheckout accepted-offer path', () => {
  beforeEach(() => {
    resetCheckoutView();
    searchParams.current = new URLSearchParams('offer=offer-1');
    view.awardItems = [{ awardId: 'award-1', listingId: 's:boots', variantId: 'variant_42' }];
    offerState.offers = [acceptedOffer];
    view.addresses = [
      {
        id: 'home',
        label: 'Home',
        city: 'New York',
        is_default: true,
      },
    ];
    window.history.replaceState(null, '', '/marketplace/checkout?offer=offer-1');
  });

  async function fillAndPay(user: ReturnType<typeof userEvent.setup>) {
    await fillValidDelivery(user);
    const pay = screen.getByTestId('marketplace-checkout-pay');
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);
  }

  it('renders server-projected agreed price, shipping, total, and deadline on the one Checkout screen', () => {
    render(<MarketplaceCheckout />);

    expect(screen.getByRole('heading', { name: 'Checkout' })).toBeInTheDocument();
    expect(screen.getByText('Vintage boots')).toBeInTheDocument();
    expect(screen.getByText(/42 · Quantity 1/)).toBeInTheDocument();
    expect(screen.getByText('Items').parentElement).toHaveTextContent('$6.00');
    expect(screen.getByText('Shipping').parentElement).toHaveTextContent('$1.00');
    expect(screen.getByText('Merchandise total').parentElement).toHaveTextContent('$7.00');
    expect(screen.getByText(/Checkout window closes/)).toBeInTheDocument();
    expect(screen.getByTestId('marketplace-checkout-pay')).toBeInTheDocument();
    expect(screen.getByLabelText('Saved addresses')).toBeInTheDocument();
  });

  it('keeps the new-address form when the book is empty instead of gating to settings', () => {
    view.addresses = [];
    render(<MarketplaceCheckout />);

    expect(screen.getByLabelText('Full name')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add delivery address' })).not.toBeInTheDocument();
    expect(screen.getByTestId('marketplace-checkout-pay')).toBeDisabled();
  });

  it('removes the award line and continues checkout after a successful pay', async () => {
    const user = userEvent.setup();
    render(<MarketplaceCheckout />);
    await fillAndPay(user);

    expect(offerState.submit).toHaveBeenCalled();
    expect(offerState.submit.mock.calls[0]?.[1]).toMatchObject({ name: 'Alice Buyer', line1: '1 Market Street' });
    expect(checkoutActions.remove).toHaveBeenCalledWith('s:boots', 'variant_42', 'award-1', false);
    expect(offerState.refresh).toHaveBeenCalledTimes(1);
    expect(checkoutActions.rememberAddress).toHaveBeenCalled();
  });

  it('hands an accepted offer to PayPal through the top window', async () => {
    const paypalUrl = 'https://www.paypal.com/checkoutnow?token=EC-OFFER';
    offerState.submit.mockResolvedValue({
      ok: true,
      orderId: '00000000-0000-4000-8000-000000000803',
      boundOrder: { fiatCheckoutUrl: paypalUrl },
    });
    const user = userEvent.setup();
    render(<MarketplaceCheckout />);
    await fillAndPay(user);

    await waitFor(() => expect(navigation.navigateTop).toHaveBeenCalledWith(paypalUrl));
    expect(navigation.navigateTop).toHaveBeenCalledTimes(1);
  });

  it('checks out a pickup award with the pickup UI: no address, no shipping, merchandise only', async () => {
    view.fulfillmentEffective = { ['s'.repeat(52)]: 'pickup' };
    view.requiresDeliveryAddress = false;
    const user = userEvent.setup();
    render(<MarketplaceCheckout />);

    expect(
      await screen.findByText(/Local pickup — no delivery address or shipping for these items/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
    expect(screen.getByText('Shipping').parentElement).toHaveTextContent('$0.00');
    expect(screen.getByText('Merchandise total').parentElement).toHaveTextContent('$6.00');

    const pay = screen.getByTestId('marketplace-checkout-pay');
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    expect(offerState.submit).toHaveBeenCalledTimes(1);
    expect(offerState.submit.mock.calls[0]?.[1]).toBeNull();
    expect(checkoutActions.rememberAddress).not.toHaveBeenCalled();
  });

  it('says a pickup award has no shipping and is collected in person', async () => {
    view.fulfillmentEffective = { ['s'.repeat(52)]: 'pickup' };
    view.requiresDeliveryAddress = false;
    render(<MarketplaceCheckout />);

    expect(
      await screen.findByText('No shipping — pickup is arranged with the seller after payment.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No delivery address needed. Pickup location is shared once payment is confirmed.'),
    ).toBeInTheDocument();
  });

  it('says a pickup-only award cannot check out while pickup is unavailable', async () => {
    view.fulfillmentOptions = { ['s'.repeat(52)]: [] };
    view.hasFulfillmentConflict = true;
    render(<MarketplaceCheckout />);

    expect(
      await screen.findByText(
        'This listing is local pickup only, and pickup is unavailable on this deployment right now.',
      ),
    ).toHaveAttribute('role', 'alert');
  });

  it('resolves award fulfillment from the accepted snapshot, never the listing as it is now', () => {
    offerState.offers = [{ ...acceptedOffer, award: { ...acceptedOffer.award, fulfillmentMethods: ['pickup'] } }];
    render(<MarketplaceCheckout />);

    expect(checkoutActions.lastAward).toEqual({ sellerPubky: 's'.repeat(52), fulfillmentMethods: ['pickup'] });
    expect(CommerceController.getListing).not.toHaveBeenCalled();
    expect(CommerceController.getOrFetchListing).not.toHaveBeenCalled();
  });

  it('offers the shipping-or-pickup choice for an award on a listing that publishes both', async () => {
    view.fulfillmentOptions = { ['s'.repeat(52)]: ['shipping', 'pickup'] };
    const user = userEvent.setup();
    render(<MarketplaceCheckout />);

    const select = await screen.findByLabelText(`Fulfillment for items from ${'s'.repeat(52)}`);
    await user.click(select);
    await user.click(screen.getByRole('option', { name: 'Local pickup' }));
    expect(checkoutActions.setFulfillmentChoice).toHaveBeenCalledWith('s'.repeat(52), 'pickup');
  });

  it('shows expiry copy, removes the line, refreshes offers, and offers both next actions', async () => {
    offerState.submit.mockResolvedValue({ ok: false, code: 'AWARD_EXPIRED' });
    const user = userEvent.setup();
    render(<MarketplaceCheckout />);
    await fillAndPay(user);

    expect(screen.getByText('This accepted offer expired before checkout. Nothing was reserved.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View offers' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Buy at current price' })).toBeInTheDocument();
    expect(checkoutActions.remove).toHaveBeenCalledTimes(1);
    expect(offerState.refresh).toHaveBeenCalledTimes(1);
  });

  it.each(['AWARD_ALREADY_CONVERTED', 'REVISION_CONFLICT'])('shows the converted state for %s', async (code) => {
    offerState.submit.mockResolvedValue({ ok: false, code });
    const user = userEvent.setup();
    render(<MarketplaceCheckout />);
    await fillAndPay(user);

    expect(screen.getByText('This accepted offer has already been converted.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View orders' })).toBeInTheDocument();
    expect(checkoutActions.remove).toHaveBeenCalledWith('s:boots', 'variant_42', 'award-1', false);
  });

  it('removes the award line and refreshes offers when the award is unavailable', async () => {
    offerState.submit.mockResolvedValue({ ok: false, code: 'AWARD_UNAVAILABLE' });
    const user = userEvent.setup();
    render(<MarketplaceCheckout />);
    await fillAndPay(user);

    expect(screen.getByText('This offer is no longer available.')).toBeInTheDocument();
    expect(checkoutActions.remove).toHaveBeenCalledWith('s:boots', 'variant_42', 'award-1', false);
  });

  it('shows mapped refusal copy and Retry for other checkout refusal codes', async () => {
    offerState.submit.mockResolvedValue({ ok: false, code: 'AWARD_QUANTITY_MISMATCH' });
    const user = userEvent.setup();
    render(<MarketplaceCheckout />);
    await fillAndPay(user);

    expect(screen.getByText('The checkout quantity does not match the accepted offer.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('withholds checkout for a malformed award projection', () => {
    offerState.offers = [{ ...acceptedOffer, award: undefined }];
    render(<MarketplaceCheckout />);
    expect(screen.getByText('Checkout for this offer is unavailable right now.')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-checkout-pay')).not.toBeInTheDocument();
  });

  it.each(['subtotal', 'shipping', 'merchandiseTotal'])('withholds checkout when %s is absent', (field) => {
    const incomplete = { ...acceptedOffer, award: { ...acceptedOffer.award } };
    delete incomplete.award[field as keyof typeof incomplete.award];
    offerState.offers = [incomplete];
    render(<MarketplaceCheckout />);
    expect(screen.getByText('Checkout for this offer is unavailable right now.')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-checkout-pay')).not.toBeInTheDocument();
  });

  it('withholds checkout when award money currencies do not match', () => {
    offerState.offers = [
      {
        ...acceptedOffer,
        award: { ...acceptedOffer.award, shipping: { ...acceptedOffer.award.shipping, currency: 'EUR' } },
      },
    ];
    render(<MarketplaceCheckout />);
    expect(screen.getByText('Checkout for this offer is unavailable right now.')).toBeInTheDocument();
  });

  it('withholds checkout from the seller on the award route', () => {
    offerState.offers = [{ ...acceptedOffer, buyerPubky: 's'.repeat(52) }];
    render(<MarketplaceCheckout />);
    expect(screen.getByText('Checkout for this offer is unavailable right now.')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-checkout-pay')).not.toBeInTheDocument();
  });
});

describe('MarketplaceCheckout drop-claim path', () => {
  beforeEach(() => {
    resetCheckoutView();
    searchParams.current = new URLSearchParams({
      seller: listing.record.ownerPubky,
      drop: 'vol1',
      listing: 'boots',
    });
    window.history.replaceState(
      null,
      '',
      `/marketplace/checkout?seller=${listing.record.ownerPubky}&drop=vol1&listing=boots`,
    );
  });

  it('loads the drop listing as quantity 1 on the one Checkout screen', async () => {
    render(<MarketplaceCheckout />);

    expect(await screen.findByRole('heading', { name: 'Checkout' })).toBeInTheDocument();
    expect(await screen.findByText('Vintage boots')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back to drop' })).not.toBeInTheDocument();
    expect(screen.getByTestId('marketplace-checkout-pay')).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toBeInTheDocument();
  });
});
