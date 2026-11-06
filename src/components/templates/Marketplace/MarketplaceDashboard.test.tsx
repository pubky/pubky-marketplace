import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import * as commerceConfig from '@/config/commerce';
import { COMMERCE_LISTING_MAX_QUANTITY } from '@/config/commerce';
import { AUCTION_UNLIST_BLOCKED_NOTE } from '@/libs/commerce/auction-removal';
import { toast } from '@/molecules/Toaster/use-toast';
import { COMMERCE_FIXTURE_SELLER, createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { toCommerceListingModel } from '@/test/fixtures/commerce/listing-models';
import { MarketplaceDashboard } from './MarketplaceDashboard';

const viewport = vi.hoisted(() => ({ isMobile: false }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const urlState = vi.hoisted(() => ({ params: new URLSearchParams() }));
const dashboardFns = vi.hoisted(() => ({
  duplicateListing: vi.fn(async () => true),
  hasUnsavedListingDraft: vi.fn(async (): Promise<string | null> => null),
  discardListingDraft: vi.fn(async () => undefined),
  resumeListingDraft: vi.fn(),
  updateListingState: vi.fn(async (_ids: string[], _state: string) => true),
}));
const dashboardState = vi.hoisted(() => ({
  listings: [] as unknown[],
  nowMs: Date.parse('2026-09-21T12:00:00.000Z'),
  metrics: {
    activeListings: 0,
    totalInventory: 0,
    lowStock: 0,
    paidOrders: 0,
    revenue: [] as unknown[],
    openOffers: 0,
  },
  actionNeeded: {
    ordersToShip: 0,
    offersAwaitingReply: 0,
    expiringAuctions: 0,
    total: 0,
  },
  unfinishedDrafts: [] as Array<{ listingId: string; title: string; updatedAt: number; ageLabel: string }>,
  needsSession: false,
  sessionError: null as string | null,
  registrationOffered: true,
  stockUnknown: false,
  sourcesReady: false,
  registering: null as { done: number; total: number } | null,
  sources: {} as Record<string, string[]>,
}));
const registerFlow = vi.hoisted(() => ({
  registerListings: vi.fn(async (_ids: string[]) => ({ registered: 0, failed: [] as string[] })),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => MARKETPLACE_ROUTES.DASHBOARD,
  useSearchParams: () => urlState.params,
}));

vi.mock('@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl', async () => {
  return await import('@/test/mocks/marketplace-media-hooks');
});

vi.mock('@/hooks/useSellingAvailability/useSellingAvailability', async () => {
  const { INERT_COMMERCE_AVAILABILITY } = await import('@/libs/commerce/commerce-availability');
  return { useSellingAvailability: () => INERT_COMMERCE_AVAILABILITY };
});

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

vi.mock('@/hooks/useIsMobile/useIsMobile', () => ({
  useIsMobile: () => viewport.isMobile,
}));

vi.mock('@/hooks/useMarketplaceSellerDashboard/useMarketplaceSellerDashboard', async () => {
  const { formatListingStock } = await vi.importActual<typeof import('@/libs/commerce/unlimited-stock')>(
    '@/libs/commerce/unlimited-stock',
  );
  const { toListingTableRow } = await vi.importActual<typeof import('@/libs/commerce/listing-table')>(
    '@/libs/commerce/listing-table',
  );
  return {
    useMarketplaceSellerDashboard: () => ({
      listings: dashboardState.listings,
      tableRows: (dashboardState.listings as Array<Parameters<typeof toListingTableRow>[0]>).map((listing) =>
        toListingTableRow(listing, {
          nowMs: dashboardState.nowMs,
          needsRegistration: (row) =>
            (row as { registeredWithService?: boolean }).registeredWithService === false &&
            dashboardState.registrationOffered,
          stockKnown: () => !dashboardState.stockUnknown,
          sourcesOf: (listingId) => (dashboardState.sources[listingId] ?? []) as ['shopify'],
        }),
      ),
      needsRegistration: (row: { registeredWithService?: boolean }) =>
        row.registeredWithService === false && dashboardState.registrationOffered,
      registerListings: registerFlow.registerListings,
      registering: dashboardState.registering,
      sourcesReady: dashboardState.sourcesReady,
      nowMs: dashboardState.nowMs,
      sellerOrders: [],
      offers: [],
      isLoading: false,
      needsSession: dashboardState.needsSession,
      sessionError: dashboardState.sessionError,
      metrics: dashboardState.metrics,
      actionNeeded: dashboardState.actionNeeded,
      updateListingState: dashboardFns.updateListingState,
      duplicateListing: dashboardFns.duplicateListing,
      hasUnsavedListingDraft: dashboardFns.hasUnsavedListingDraft,
      unfinishedDrafts: dashboardState.unfinishedDrafts,
      discardListingDraft: dashboardFns.discardListingDraft,
      resumeListingDraft: dashboardFns.resumeListingDraft,
      canOfferRegistration: () => dashboardState.registrationOffered,
      listingStockLabel: (listing: {
        record: Parameters<typeof formatListingStock>[0];
        purchasableQuantity?: number | null;
      }) =>
        dashboardState.stockUnknown ? '—' : formatListingStock(listing.record, listing.purchasableQuantity ?? null),
      exportCsv: async () => new TextEncoder().encode('record_uri,seller_pubky\r\n'),
    }),
  };
});

vi.mock('@/organisms/Marketplace/MarketplaceSessionConnectDialog', () => ({
  MarketplaceSessionConnectDialog: ({ triggerLabel, autoOpen }: { triggerLabel?: string; autoOpen?: boolean }) => (
    <button data-testid={autoOpen ? 'session-connect-auto-open' : undefined}>{triggerLabel}</button>
  ),
}));

const SHOP_WITH_POLICIES = {
  record: { name: 'Satoshi Vintage', shippingPolicy: 'Ships within three days.', returnPolicy: '' },
};
const shopState = vi.hoisted(() => ({ shop: null as unknown }));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => shopState.shop,
}));

const paymentGate = vi.hoisted(() => ({
  isDurable: false,
  ready: true,
  reason: null as 'unsigned' | 'no-method' | 'unverified' | null,
}));

vi.mock('@/hooks/useSellerPaymentMethodGate/useSellerPaymentMethodGate', () => ({
  useSellerPaymentMethodGate: () => paymentGate,
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getShop: () => Promise.resolve({ record: { name: 'Satoshi Vintage' } }),
    getOrFetchShop: () => Promise.resolve({ name: 'Satoshi Vintage' }),
  },
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: Object.assign(
    (selector: (state: { currentUserPubky: string }) => unknown) =>
      selector({ currentUserPubky: COMMERCE_FIXTURE_SELLER }),
    {
      getState: () => ({
        currentUserPubky: COMMERCE_FIXTURE_SELLER,
        selectCurrentUserPubky: () => COMMERCE_FIXTURE_SELLER,
      }),
      setState: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    },
  ),
}));

const deleteFlow = vi.hoisted(() => ({
  request: vi.fn(async (_targets: unknown[]) => {}),
  onDeleted: undefined as undefined | ((keys: string[]) => void),
}));

vi.mock('@/hooks/useDeleteMarketplaceListings/useDeleteMarketplaceListings', () => ({
  useDeleteMarketplaceListings: ({ onDeleted }: { onDeleted?: (keys: string[]) => void } = {}) => {
    deleteFlow.onDeleted = onDeleted;
    return {
      open: false,
      plan: null,
      isDeleting: false,
      hasHomeserverSession: true,
      request: deleteFlow.request,
      confirm: vi.fn(),
      cancel: vi.fn(),
    };
  },
}));

vi.mock('@/organisms/Marketplace/MarketplaceContentLayout', () => ({
  MarketplaceContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

describe('MarketplaceDashboard', () => {
  beforeEach(() => {
    shopState.shop = SHOP_WITH_POLICIES;
    dashboardState.unfinishedDrafts = [];
    dashboardState.needsSession = false;
    dashboardState.sessionError = null;
    dashboardFns.discardListingDraft.mockClear();
    dashboardFns.resumeListingDraft.mockClear();
    router.push.mockClear();
    paymentGate.isDurable = false;
    paymentGate.ready = true;
    paymentGate.reason = null;
  });

  describe('store connections entry', () => {
    const entry = () => screen.getByRole('link', { name: /Store connections/ });

    it('always shows the Store connections button next to Payment settings', () => {
      render(<MarketplaceDashboard />);
      expect(entry()).toHaveAttribute('href', MARKETPLACE_ROUTES.SETTINGS_STORE_CONNECTIONS);
      expect(screen.getByRole('link', { name: /Payment settings/ })).toBeInTheDocument();
    });

    it.each(['unavailable', 'sandbox', 'transaction-service'] as const)(
      'shows it in the %s commerce mode too, because it is not hidden behind a setting',
      (mode) => {
        vi.spyOn(commerceConfig, 'getCommerceAdapterMode').mockReturnValue(mode);
        render(<MarketplaceDashboard />);
        expect(entry()).toBeInTheDocument();
      },
    );
  });

  describe('storefront prompt', () => {
    it('asks a seller with listings and no shop to set up their storefront', async () => {
      shopState.shop = null;
      dashboardState.listings = [listing()];

      render(<MarketplaceDashboard />);

      expect(await screen.findByRole('heading', { name: 'Your storefront is not set up' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Set up your storefront' })).toHaveAttribute(
        'href',
        MARKETPLACE_ROUTES.MY_SHOP,
      );
    });

    it('asks for policies while the default storefront has neither policy', async () => {
      shopState.shop = { record: { name: 'Satoshi', shippingPolicy: '', returnPolicy: ' ' } };
      dashboardState.listings = [listing()];

      render(<MarketplaceDashboard />);

      expect(await screen.findByRole('heading', { name: 'Add your shipping and return policies' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Add policies' })).toHaveAttribute('href', MARKETPLACE_ROUTES.MY_SHOP);
      expect(screen.queryByText('Your storefront is not set up')).not.toBeInTheDocument();
    });

    it('stays away once the seller wrote a policy', async () => {
      dashboardState.listings = [listing()];

      render(<MarketplaceDashboard />);

      await waitFor(() => expect(screen.getByRole('heading', { name: 'My shop' })).toBeInTheDocument());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(screen.queryByText('Add your shipping and return policies')).not.toBeInTheDocument();
      expect(screen.queryByText('Your storefront is not set up')).not.toBeInTheDocument();
    });
  });

  it('keeps the seller entry point available without an inline approval card', () => {
    dashboardState.needsSession = true;
    dashboardState.sessionError = 'A marketplace session is required.';

    render(<MarketplaceDashboard />);

    expect(screen.getByRole('heading', { name: 'My shop' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders KPI metrics as a horizontal chip strip on mobile', () => {
    viewport.isMobile = true;
    dashboardState.listings = [listing()];
    dashboardState.metrics = {
      activeListings: 1,
      totalInventory: 4,
      lowStock: 0,
      paidOrders: 2,
      revenue: [{ amountMinor: 12_500, currency: 'USD', exponent: 2 }],
      openOffers: 1,
    };
    dashboardState.actionNeeded = {
      ordersToShip: 1,
      offersAwaitingReply: 0,
      expiringAuctions: 0,
      total: 1,
    };

    render(<MarketplaceDashboard />);

    expect(screen.getByRole('heading', { name: 'My shop' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Inventory/ })).toHaveAttribute('href', MARKETPLACE_ROUTES.INVENTORY);
    const chips = screen.getByTestId('marketplace-dashboard-kpi-chips');
    expect(chips).toHaveAttribute('role', 'region');
    expect(chips).toHaveAttribute('aria-label', 'Dashboard metrics');
    expect(chips).toHaveAttribute('tabindex', '0');
    expect(chips).toHaveTextContent('Active listings');
    expect(chips).toHaveTextContent('1');
    expect(chips).toHaveTextContent('$125.00');
    expect(screen.getByText('Action needed')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'My listings' })).toBeInTheDocument();
  });

  it('keeps KPI cards on desktop', () => {
    viewport.isMobile = false;
    dashboardState.listings = [listing()];

    render(<MarketplaceDashboard />);

    expect(screen.queryByTestId('marketplace-dashboard-kpi-chips')).not.toBeInTheDocument();
    expect(screen.getByText('Active listings')).toBeInTheDocument();
  });

  it('seeds a sell draft from Duplicate and navigates to the sell studio', async () => {
    viewport.isMobile = false;
    dashboardFns.duplicateListing.mockClear();
    dashboardFns.hasUnsavedListingDraft.mockResolvedValue(null);
    router.push.mockClear();
    const rowListing = listing({ listingId: 'no_media', title: 'No media listing', media: [] });
    dashboardState.listings = [rowListing];

    render(<MarketplaceDashboard />);

    const row = screen.getByRole('row', { name: /No media listing/ });
    expect(within(row).getByLabelText('No thumbnail for No media listing')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: /Duplicate/ }));

    await vi.waitFor(() => {
      expect(dashboardFns.duplicateListing).toHaveBeenCalledWith('no_media', { replaceUnsavedDraft: false });
    });
    await vi.waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(MARKETPLACE_ROUTES.SELL);
    });
  });

  it('asks before replacing an unsaved draft and keeps it when Keep is chosen', async () => {
    viewport.isMobile = false;
    dashboardFns.duplicateListing.mockClear();
    dashboardFns.hasUnsavedListingDraft.mockResolvedValue('existingdraft');
    router.push.mockClear();
    dashboardState.listings = [listing({ listingId: 'no_media', title: 'No media listing', media: [] })];

    render(<MarketplaceDashboard />);

    fireEvent.click(
      within(screen.getByRole('row', { name: /No media listing/ })).getByRole('button', { name: /Duplicate/ }),
    );

    expect(await screen.findByTestId('dialog-title')).toHaveTextContent('Replace your unsaved draft?');
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));

    expect(dashboardFns.duplicateListing).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('replaces an unsaved draft when Replace is confirmed', async () => {
    viewport.isMobile = false;
    dashboardFns.duplicateListing.mockClear();
    dashboardFns.hasUnsavedListingDraft.mockResolvedValue('existingdraft');
    router.push.mockClear();
    dashboardState.listings = [listing({ listingId: 'no_media', title: 'No media listing', media: [] })];

    render(<MarketplaceDashboard />);

    fireEvent.click(
      within(screen.getByRole('row', { name: /No media listing/ })).getByRole('button', { name: /Duplicate/ }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Replace' }));

    await vi.waitFor(() => {
      expect(dashboardFns.duplicateListing).toHaveBeenCalledWith('no_media', {
        replaceUnsavedDraft: true,
        unsavedDraftId: 'existingdraft',
      });
    });
    await vi.waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(MARKETPLACE_ROUTES.SELL);
    });
  });

  it('asks before replacing an unsaved photos-only draft', async () => {
    viewport.isMobile = false;
    dashboardFns.duplicateListing.mockClear();
    dashboardFns.hasUnsavedListingDraft.mockResolvedValue('photosonly');
    router.push.mockClear();
    dashboardState.listings = [listing({ listingId: 'no_media', title: 'No media listing', media: [] })];

    render(<MarketplaceDashboard />);

    fireEvent.click(
      within(screen.getByRole('row', { name: /No media listing/ })).getByRole('button', { name: /Duplicate/ }),
    );

    expect(await screen.findByTestId('dialog-title')).toHaveTextContent('Replace your unsaved draft?');
    expect(dashboardFns.duplicateListing).not.toHaveBeenCalled();
  });

  it('badges ended auctions from the dashboard clock, not wall time', () => {
    viewport.isMobile = false;
    const endsAt = '2026-09-21T12:00:00.000Z';
    const rowListing = listing({
      listingId: 'ended_auction',
      title: 'Ended rangefinder',
      sale: {
        format: 'auction',
        startingPrice: { amountMinor: 4_500, currency: 'USD', exponent: 2 },
        minimumIncrement: { amountMinor: 500, currency: 'USD', exponent: 2 },
        startsAt: '2026-09-21T10:00:00.000Z',
        endsAt,
        antiSnipingWindowSeconds: 120,
        antiSnipingExtensionSeconds: 120,
      },
    });
    dashboardState.listings = [rowListing];
    dashboardState.nowMs = Date.parse(endsAt) - 1;

    const { rerender } = render(<MarketplaceDashboard />);
    expect(within(screen.getByRole('row', { name: /Ended rangefinder/ })).getByText('active')).toBeInTheDocument();

    dashboardState.nowMs = Date.parse(endsAt);
    rerender(<MarketplaceDashboard />);
    expect(within(screen.getByRole('row', { name: /Ended rangefinder/ })).getByText('ended')).toBeInTheDocument();
  });

  it('lists unfinished drafts when more than one is saved on this device', () => {
    viewport.isMobile = false;
    dashboardState.listings = [listing()];
    dashboardState.unfinishedDrafts = [
      { listingId: 'draft_a', title: 'Vintage boots', updatedAt: 1, ageLabel: '3 min ago' },
      { listingId: 'draft_b', title: 'Untitled listing', updatedAt: 2, ageLabel: '1 hour ago' },
    ];

    render(<MarketplaceDashboard />);

    expect(screen.getByRole('heading', { name: 'Unfinished drafts' })).toBeInTheDocument();
    expect(document.querySelector('[data-surface="listing-drafts-list"]')).not.toBeNull();
    expect(screen.getByText('Vintage boots')).toBeInTheDocument();
    expect(screen.getByText('Untitled listing')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Resume' })[0]);
    expect(dashboardFns.resumeListingDraft).toHaveBeenCalledWith('draft_a');
    expect(router.push).toHaveBeenCalledWith(MARKETPLACE_ROUTES.SELL);

    fireEvent.click(screen.getAllByRole('button', { name: 'Discard' })[1]);
    expect(dashboardFns.discardListingDraft).toHaveBeenCalledWith('draft_b');
  });

  it('offers payment setup and selling actions without a duplicate setup notice', () => {
    viewport.isMobile = false;
    paymentGate.isDurable = true;
    paymentGate.ready = true;
    paymentGate.reason = 'no-method';
    dashboardState.listings = [];
    dashboardState.metrics = {
      activeListings: 0,
      totalInventory: 0,
      lowStock: 0,
      paidOrders: 0,
      revenue: [],
      openOffers: 0,
    };

    render(<MarketplaceDashboard />);

    expect(screen.queryByTestId('create-listing-payment-precondition')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Shop actions' })).getByRole('link', { name: 'Payment settings' }),
    ).toHaveAttribute('href', MARKETPLACE_ROUTES.SETTINGS);
    expect(screen.getByRole('button', { name: 'Sell an item' })).toBeEnabled();
  });

  it('uses secondary buttons consistently for shop management actions', () => {
    viewport.isMobile = false;
    paymentGate.isDurable = true;
    paymentGate.ready = true;
    paymentGate.reason = 'no-method';
    dashboardState.listings = [];
    dashboardState.metrics = {
      activeListings: 0,
      totalInventory: 0,
      lowStock: 0,
      paidOrders: 0,
      revenue: [],
      openOffers: 0,
    };

    render(<MarketplaceDashboard />);

    const actions = within(screen.getByRole('navigation', { name: 'Shop actions' }));
    for (const name of ['Payment settings', 'Storefront', 'Inventory', 'Shipping presets']) {
      expect(actions.getByRole('link', { name })).toHaveClass('bg-secondary');
    }
    expect(screen.queryByTestId('create-listing-payment-precondition')).not.toBeInTheDocument();
  });

  it('downloads the canonical import CSV from Export', async () => {
    viewport.isMobile = false;
    paymentGate.isDurable = true;
    paymentGate.ready = true;
    dashboardState.listings = [listing({ listingId: 'boots', title: 'Boots' })];
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:csv');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(<MarketplaceDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const blob = createObjectURL.mock.calls[0]![0];
    expect(await blob.text()).toBe('record_uri,seller_pubky\r\n');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv');
    click.mockRestore();
  });

  it('shows Unlimited for a listing with an unlimited variant and a number for the rest', () => {
    viewport.isMobile = false;
    dashboardState.listings = [
      listing({
        listingId: 'guide',
        title: 'Printable field guide',
        fulfillmentMethods: ['digital'],
        package: undefined,
        shippingOptions: [],
        variants: [
          {
            id: 'file',
            options: { size: 'pdf' },
            quantity: COMMERCE_LISTING_MAX_QUANTITY,
            mediaIds: ['image_01'],
            enabled: true,
          },
          {
            id: 'sample',
            options: { size: 'sample' },
            quantity: 2,
            mediaIds: ['image_01'],
            enabled: true,
          },
        ],
      }),
      listing(),
    ];

    render(<MarketplaceDashboard />);

    const guide = screen.getByRole('row', { name: /Printable field guide/ });
    expect(within(guide).getByText('Unlimited')).toBeInTheDocument();
    expect(within(guide).queryByText(String(COMMERCE_LISTING_MAX_QUANTITY))).not.toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Vintage leather boots/ })).getByText('1')).toBeInTheDocument();
  });
});

describe('MarketplaceDashboard state changes without a marketplace session', () => {
  beforeEach(() => {
    vi.spyOn(commerceConfig, 'getCommerceAdapterMode').mockReturnValue('transaction-service');
    dashboardFns.updateListingState.mockClear();
    vi.mocked(toast).mockClear();
    viewport.isMobile = false;
  });

  const selectAndClick = (title: string, action: 'Pause' | 'Activate') => {
    fireEvent.click(screen.getByRole('checkbox', { name: `Select ${title}` }));
    fireEvent.click(screen.getByRole('button', { name: action }));
  };

  it('pauses a fixed-price listing without asking to enable selling', () => {
    const fixedPrice = listing({ title: 'Boots' });
    dashboardState.listings = [fixedPrice];

    render(<MarketplaceDashboard />);
    selectAndClick('Boots', 'Pause');

    expect(dashboardFns.updateListingState).toHaveBeenCalledWith([fixedPrice.id], 'paused');
    expect(screen.queryByTestId('session-connect-auto-open')).not.toBeInTheDocument();
  });

  it('asks to enable selling before activating', () => {
    dashboardState.listings = [listing({ title: 'Boots', state: 'paused' })];

    render(<MarketplaceDashboard />);
    selectAndClick('Boots', 'Activate');

    expect(dashboardFns.updateListingState).not.toHaveBeenCalled();
    expect(screen.getByTestId('session-connect-auto-open')).toBeInTheDocument();
  });

  it('asks to enable selling before pausing an auction that has ended', () => {
    const record = createCommerceListingFixture({ title: 'Lamp' });
    record.sale = {
      format: 'auction',
      startingPrice: { amountMinor: 4_500, currency: 'USD', exponent: 2 },
      minimumIncrement: { amountMinor: 500, currency: 'USD', exponent: 2 },
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-08-01T00:00:00.000Z',
      antiSnipingWindowSeconds: 120,
      antiSnipingExtensionSeconds: 120,
    };
    dashboardState.listings = [toCommerceListingModel(record)];

    render(<MarketplaceDashboard />);
    selectAndClick('Lamp', 'Pause');

    expect(dashboardFns.updateListingState).not.toHaveBeenCalled();
    expect(screen.getByTestId('session-connect-auto-open')).toBeInTheDocument();
  });

  const liveAuction = (title: string) => {
    const record = createCommerceListingFixture({ title, listingId: `${title.toLowerCase()}_01` });
    record.sale = {
      format: 'auction',
      startingPrice: { amountMinor: 4_500, currency: 'USD', exponent: 2 },
      minimumIncrement: { amountMinor: 500, currency: 'USD', exponent: 2 },
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2099-01-01T00:00:00.000Z',
      antiSnipingWindowSeconds: 120,
      antiSnipingExtensionSeconds: 120,
    };
    return toCommerceListingModel(record);
  };

  it('refuses to pause an auction that has not ended, and says why', () => {
    dashboardState.listings = [liveAuction('Lamp')];

    render(<MarketplaceDashboard />);
    selectAndClick('Lamp', 'Pause');

    expect(dashboardFns.updateListingState).not.toHaveBeenCalled();
    expect(screen.queryByTestId('session-connect-auto-open')).not.toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Auctions stay live', description: AUCTION_UNLIST_BLOCKED_NOTE }),
    );
  });

  it('pauses the fixed-price listings of a selection and leaves its live auction alone', () => {
    const boots = listing({ title: 'Boots' });
    dashboardState.listings = [boots, liveAuction('Lamp')];

    render(<MarketplaceDashboard />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Boots' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Lamp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    expect(dashboardFns.updateListingState).toHaveBeenCalledWith([boots.id], 'paused');
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: AUCTION_UNLIST_BLOCKED_NOTE }));
  });

  it('still activates an auction the seller paused earlier', () => {
    const paused = { ...liveAuction('Lamp'), state: 'paused' as const };
    dashboardState.listings = [paused];

    render(<MarketplaceDashboard />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Lamp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

    expect(toast).not.toHaveBeenCalled();
  });
});

describe('MarketplaceDashboard registration for checkout', () => {
  beforeEach(() => {
    viewport.isMobile = false;
    dashboardState.registrationOffered = true;
    dashboardState.stockUnknown = false;
  });

  it("shows the listing's stock as a dash while the service has not answered for it", () => {
    dashboardState.listings = [{ ...listing({ title: 'Boots' }), registeredWithService: false }];
    dashboardState.stockUnknown = true;

    render(<MarketplaceDashboard />);

    const cells = within(screen.getByRole('row', { name: /Boots/ })).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toContain('—');
  });

  it('offers nothing until the service has answered for the listing', () => {
    dashboardState.listings = [{ ...listing({ title: 'Boots' }), registeredWithService: false }];
    dashboardState.registrationOffered = false;

    render(<MarketplaceDashboard />);

    expect(screen.getByRole('row', { name: /Boots/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register for checkout' })).not.toBeInTheDocument();
  });

  it('offers Register for checkout for a listing the service does not hold', () => {
    dashboardState.listings = [{ ...listing({ title: 'Boots' }), registeredWithService: false }];

    render(<MarketplaceDashboard />);

    expect(
      within(screen.getByRole('row', { name: /Boots/ })).getByRole('button', { name: 'Register for checkout' }),
    ).toBeInTheDocument();
  });

  it('offers none for a listing the service holds, sold ones included', () => {
    dashboardState.listings = [{ ...listing({ title: 'Boots' }), registeredWithService: true }];

    render(<MarketplaceDashboard />);

    expect(screen.queryByRole('button', { name: 'Register for checkout' })).not.toBeInTheDocument();
  });
});

describe('MarketplaceDashboard delete', () => {
  beforeEach(() => {
    deleteFlow.request.mockClear();
    viewport.isMobile = false;
  });

  it('offers Delete on every listing row and requests that one listing', () => {
    const boots = listing({ listingId: 'boots', title: 'Boots' });
    const lamp = listing({ listingId: 'lamp', title: 'Lamp' });
    dashboardState.listings = [boots, lamp];

    render(<MarketplaceDashboard />);
    fireEvent.click(within(screen.getByRole('row', { name: /Lamp/ })).getByRole('button', { name: 'Delete Lamp' }));

    expect(deleteFlow.request).toHaveBeenCalledWith([
      { ownerPubky: lamp.seller_id, listingId: 'lamp', title: 'Lamp', record: lamp.record },
    ]);
  });

  it('keeps Delete reachable while selling is held, because removing a listing adds no exposure', () => {
    dashboardState.listings = [listing({ listingId: 'boots', title: 'Boots' })];

    render(<MarketplaceDashboard />);

    expect(screen.getByRole('button', { name: 'Delete Boots' })).toBeEnabled();
  });

  it('deletes the selected listings together and clears the ones that were deleted from the selection', () => {
    const boots = listing({ listingId: 'boots', title: 'Boots' });
    const lamp = listing({ listingId: 'lamp', title: 'Lamp' });
    dashboardState.listings = [boots, lamp];

    render(<MarketplaceDashboard />);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Boots' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Lamp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(deleteFlow.request).toHaveBeenCalledWith([
      expect.objectContaining({ listingId: 'boots', title: 'Boots' }),
      expect.objectContaining({ listingId: 'lamp', title: 'Lamp' }),
    ]);

    act(() => deleteFlow.onDeleted?.([boots.id, lamp.id]));
    expect(screen.getByRole('checkbox', { name: 'Select Boots' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});

describe('MarketplaceDashboard listing table filters, sorts and bulk actions', () => {
  beforeEach(() => {
    vi.spyOn(commerceConfig, 'getCommerceAdapterMode').mockReturnValue('sandbox');
    viewport.isMobile = false;
    shopState.shop = SHOP_WITH_POLICIES;
    router.replace.mockClear();
    dashboardFns.updateListingState.mockClear();
    registerFlow.registerListings.mockClear();
    urlState.params = new URLSearchParams();
    dashboardState.sourcesReady = false;
    dashboardState.registering = null;
    dashboardState.sources = {};
    dashboardState.registrationOffered = true;
    dashboardState.stockUnknown = false;
  });

  const many = (count: number, make: (index: number) => Parameters<typeof listing>[0] = () => ({})) =>
    Array.from({ length: count }, (_, index) => {
      const label = String(index + 1).padStart(3, '0');
      return listing({
        listingId: `item_${label}`,
        title: `Item ${label}`,
        createdAt: new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString(),
        ...make(index),
      });
    });
  const needsRegistration = (row: ReturnType<typeof listing>) => ({ ...row, registeredWithService: false });
  const renderedTitles = () =>
    screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('link')[0].textContent);

  it('pages 120 listings, newest first, 50 at a time', () => {
    dashboardState.listings = many(120);

    render(<MarketplaceDashboard />);

    expect(screen.getAllByRole('row')).toHaveLength(51);
    expect(screen.getByText('Showing 1–50 of 120')).toBeInTheDocument();
    expect(renderedTitles()[0]).toBe('Item 120');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(router.replace).toHaveBeenCalledWith(`${MARKETPLACE_ROUTES.DASHBOARD}?page=2`, { scroll: false });
  }, 30_000);

  it('shows the page the URL names', () => {
    dashboardState.listings = many(120);
    urlState.params = new URLSearchParams('page=3');

    render(<MarketplaceDashboard />);

    expect(screen.getAllByRole('row')).toHaveLength(21);
    expect(screen.getByText('Showing 101–120 of 120')).toBeInTheDocument();
  }, 30_000);

  it('filters by the state the URL names', () => {
    dashboardState.listings = many(6, (index) => ({ state: index % 3 === 0 ? 'paused' : 'active' }));
    urlState.params = new URLSearchParams('state=paused');

    render(<MarketplaceDashboard />);

    expect(renderedTitles().sort()).toEqual(['Item 001', 'Item 004']);
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('searches title and SKU', () => {
    dashboardState.listings = [
      listing({ listingId: 'boots', title: 'Vintage boots' }),
      listing({ listingId: 'lamp', title: 'Brass lamp' }),
    ];
    urlState.params = new URLSearchParams('q=lamp');

    render(<MarketplaceDashboard />);

    expect(renderedTitles()).toEqual(['Brass lamp']);
    expect(screen.getByRole('searchbox', { name: 'Search listings by title or SKU' })).toHaveValue('lamp');
  });

  it('filters by store source once the stores were read', () => {
    dashboardState.listings = many(3);
    dashboardState.sourcesReady = true;
    dashboardState.sources = { item_001: ['shopify'], item_003: ['shopify'] };
    urlState.params = new URLSearchParams('source=shopify');

    render(<MarketplaceDashboard />);

    expect(renderedTitles().sort()).toEqual(['Item 001', 'Item 003']);
    expect(screen.getByRole('combobox', { name: 'Source' })).toBeInTheDocument();
  });

  it('filters to listings that still need registering, and out-of-stock ones', () => {
    dashboardState.listings = [
      needsRegistration(listing({ listingId: 'a', title: 'Alpha' })),
      { ...listing({ listingId: 'b', title: 'Bravo' }), registeredWithService: true },
    ];
    urlState.params = new URLSearchParams('checkout=needs');

    render(<MarketplaceDashboard />);

    expect(renderedTitles()).toEqual(['Alpha']);
  });

  it('says so, and offers to clear, when the filters match nothing', () => {
    dashboardState.listings = many(3);
    urlState.params = new URLSearchParams('q=zzz');

    render(<MarketplaceDashboard />);

    const empty = screen.getByTestId('listing-filter-empty');
    expect(empty).toHaveTextContent('No listings match these filters.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(within(empty).getByRole('button', { name: 'Clear filters' }));
    expect(router.replace).toHaveBeenCalledWith(MARKETPLACE_ROUTES.DASHBOARD, { scroll: false });
  });

  it('sorts by the column header, and reverses the active column', () => {
    dashboardState.listings = many(3);

    const { unmount } = render(<MarketplaceDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'Listing' }));
    expect(router.replace).toHaveBeenLastCalledWith(`${MARKETPLACE_ROUTES.DASHBOARD}?sort=title`, { scroll: false });
    unmount();

    urlState.params = new URLSearchParams('sort=price');
    render(<MarketplaceDashboard />);
    expect(screen.getByRole('columnheader', { name: 'Price' })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(screen.getByRole('button', { name: 'Price' }));
    expect(router.replace).toHaveBeenLastCalledWith(`${MARKETPLACE_ROUTES.DASHBOARD}?sort=price&dir=desc`, {
      scroll: false,
    });
  });

  it('orders the rows by the sort in the URL', () => {
    dashboardState.listings = [
      listing({ listingId: 'c', title: 'Cherry' }),
      listing({ listingId: 'a', title: 'apple' }),
      listing({ listingId: 'b', title: 'Banana' }),
    ];
    urlState.params = new URLSearchParams('sort=title');

    render(<MarketplaceDashboard />);

    expect(renderedTitles()).toEqual(['apple', 'Banana', 'Cherry']);
  });

  it('selects the whole page, then every listing that matches, and acts on all of them', () => {
    dashboardState.listings = many(120);

    render(<MarketplaceDashboard />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all listings on this page' }));
    expect(screen.getByTestId('listing-selection-banner')).toHaveTextContent('50 listings selected.');

    fireEvent.click(screen.getByRole('button', { name: 'Select all 120 matching' }));
    expect(screen.getByTestId('listing-selection-banner')).toHaveTextContent('All 120 matching listings are selected.');
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    const [ids] = dashboardFns.updateListingState.mock.calls[0];
    expect(ids).toHaveLength(120);
  }, 30_000);

  it('starts a new selection when a filter changes, so hidden rows are never acted on', () => {
    dashboardState.listings = many(4, (index) => ({ state: index < 2 ? 'paused' : 'active' }));

    const { rerender } = render(<MarketplaceDashboard />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Item 001' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Item 004' }));
    expect(screen.getByTestId('listing-selection-banner')).toHaveTextContent('2 listings selected.');

    urlState.params = new URLSearchParams('state=paused');
    rerender(<MarketplaceDashboard />);

    expect(screen.queryByTestId('listing-selection-banner')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Item 001' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    const [ids] = dashboardFns.updateListingState.mock.calls[0];
    expect(ids).toEqual([expect.stringContaining('item_001')]);
  });

  it('registers only the selected listings that need it, in one action', () => {
    dashboardState.listings = [
      needsRegistration(listing({ listingId: 'a', title: 'Alpha' })),
      needsRegistration(listing({ listingId: 'b', title: 'Bravo' })),
      { ...listing({ listingId: 'c', title: 'Charlie' }), registeredWithService: true },
    ];

    render(<MarketplaceDashboard />);
    const register = screen.getByRole('button', { name: 'Register selected' });
    expect(register).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all listings on this page' }));
    fireEvent.click(register);

    const [ids] = registerFlow.registerListings.mock.calls[0];
    expect(ids).toHaveLength(2);
    expect(ids.join()).not.toContain('c');
  });

  it('offers select-all-matching from a partly filled last page', () => {
    dashboardState.listings = many(183);
    urlState.params = new URLSearchParams('page=4');

    render(<MarketplaceDashboard />);
    expect(screen.getAllByRole('row')).toHaveLength(34);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all listings on this page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all 183 matching' }));

    expect(screen.getByTestId('listing-selection-banner')).toHaveTextContent('All 183 matching listings are selected.');
  }, 30_000);

  it('does not bring a hidden selection back when the filter is cleared', () => {
    dashboardState.listings = many(4, (index) => ({ state: index < 2 ? 'paused' : 'active' }));

    const { rerender } = render(<MarketplaceDashboard />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Item 004' }));
    urlState.params = new URLSearchParams('state=paused');
    rerender(<MarketplaceDashboard />);
    urlState.params = new URLSearchParams();
    rerender(<MarketplaceDashboard />);

    expect(screen.queryByTestId('listing-selection-banner')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Item 004' })).not.toBeChecked();
  });

  it('keeps the selection when only the sort or the page changes', () => {
    dashboardState.listings = many(3);

    const { rerender } = render(<MarketplaceDashboard />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Item 002' }));
    urlState.params = new URLSearchParams('sort=title');
    rerender(<MarketplaceDashboard />);

    expect(screen.getByRole('checkbox', { name: 'Select Item 002' })).toBeChecked();
  });

  it('does not apply a store source filter before the stores were read', () => {
    dashboardState.listings = many(3);
    dashboardState.sourcesReady = false;

    urlState.params = new URLSearchParams('source=manual');
    const { rerender } = render(<MarketplaceDashboard />);
    expect(renderedTitles()).toHaveLength(3);

    urlState.params = new URLSearchParams('source=shopify');
    rerender(<MarketplaceDashboard />);
    expect(renderedTitles()).toHaveLength(3);
    expect(screen.queryByRole('combobox', { name: 'Source' })).not.toBeInTheDocument();
  });

  it('turns the per-row registration button off while a bulk registration runs', () => {
    dashboardState.listings = [needsRegistration(listing({ listingId: 'a', title: 'Alpha' }))];
    dashboardState.registering = { done: 1, total: 5 };

    render(<MarketplaceDashboard />);

    expect(
      within(screen.getByRole('row', { name: /Alpha/ })).getByRole('button', { name: 'Register for checkout' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Registering 1/5' })).toBeDisabled();
  });

  it('offers no bulk registration when every listing is already registered', () => {
    dashboardState.listings = [{ ...listing({ listingId: 'c', title: 'Charlie' }), registeredWithService: true }];

    render(<MarketplaceDashboard />);

    expect(screen.queryByRole('button', { name: 'Register selected' })).not.toBeInTheDocument();
  });
});

function listing(overrides: Partial<Parameters<typeof createCommerceListingFixture>[0]> = {}) {
  return toCommerceListingModel(createCommerceListingFixture(overrides));
}
