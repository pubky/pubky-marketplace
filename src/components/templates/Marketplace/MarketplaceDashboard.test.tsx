import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const router = vi.hoisted(() => ({ push: vi.fn() }));
const dashboardFns = vi.hoisted(() => ({
  duplicateListing: vi.fn(async () => true),
  hasUnsavedListingDraft: vi.fn(async (): Promise<string | null> => null),
  discardListingDraft: vi.fn(async () => undefined),
  resumeListingDraft: vi.fn(),
  updateListingState: vi.fn(async () => true),
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
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => MARKETPLACE_ROUTES.DASHBOARD,
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

vi.mock('@/hooks/useMarketplaceSellerDashboard/useMarketplaceSellerDashboard', () => ({
  useMarketplaceSellerDashboard: () => ({
    listings: dashboardState.listings,
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
    exportCsv: async () => new TextEncoder().encode('record_uri,seller_pubky\r\n'),
  }),
}));

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

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
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

function listing(overrides: Partial<Parameters<typeof createCommerceListingFixture>[0]> = {}) {
  return toCommerceListingModel(createCommerceListingFixture(overrides));
}
