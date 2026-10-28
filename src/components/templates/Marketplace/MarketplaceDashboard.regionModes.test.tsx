import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { COMMERCE_FIXTURE_SELLER, createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { toCommerceListingModel } from '@/test/fixtures/commerce/listing-models';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
import { MarketplaceDashboard } from './MarketplaceDashboard';

const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';

const view = vi.hoisted(() => ({
  shopCountry: 'CH' as string | null,
  listings: [] as unknown[],
  ordersToShip: 0,
  unfinishedDrafts: [] as Array<{ listingId: string; title: string; updatedAt: number; ageLabel: string }>,
}));
const dashboardFns = vi.hoisted(() => ({
  updateListingState: vi.fn(async () => true),
  resumeListingDraft: vi.fn(),
  discardListingDraft: vi.fn(async () => undefined),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/marketplace/dashboard',
}));

vi.mock('@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl', async () => {
  return await import('@/test/mocks/marketplace-media-hooks');
});

vi.mock('@/hooks/useIsMobile/useIsMobile', () => ({ useIsMobile: () => false }));

vi.mock('@/hooks/useMarketplaceSellerDashboard/useMarketplaceSellerDashboard', () => ({
  useMarketplaceSellerDashboard: () => ({
    listings: view.listings,
    nowMs: Date.parse('2026-10-22T12:00:00.000Z'),
    sellerOrders: [],
    offers: [],
    isLoading: false,
    needsSession: false,
    sessionError: null,
    metrics: { activeListings: 1, totalInventory: 4, lowStock: 0, paidOrders: 1, revenue: [], openOffers: 0 },
    actionNeeded: {
      ordersToShip: view.ordersToShip,
      offersAwaitingReply: 0,
      expiringAuctions: 0,
      total: view.ordersToShip,
    },
    updateListingState: dashboardFns.updateListingState,
    duplicateListing: vi.fn(async () => true),
    hasUnsavedListingDraft: vi.fn(async () => null),
    unfinishedDrafts: view.unfinishedDrafts,
    discardListingDraft: dashboardFns.discardListingDraft,
    resumeListingDraft: dashboardFns.resumeListingDraft,
    retryListingRegistration: vi.fn(),
    exportCsv: async () => new TextEncoder().encode('record_uri,seller_pubky\r\n'),
  }),
}));

vi.mock('@/organisms/Marketplace/MarketplaceSectionNav', () => ({ MarketplaceSectionNav: () => null }));

vi.mock('@/organisms/Marketplace/MarketplaceSessionConnectDialog', () => ({
  MarketplaceSessionConnectDialog: () => null,
}));

vi.mock('@/hooks/useSellerPaymentMethodGate/useSellerPaymentMethodGate', () => ({
  useSellerPaymentMethodGate: () => ({ isDurable: false, ready: true, reason: null }),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getShop: vi.fn(async () =>
      view.shopCountry === null
        ? null
        : {
            record: {
              name: 'Satoshi Vintage',
              shippingPolicy: 'Ships within three days.',
              returnPolicy: 'Returns accepted.',
              sellerStatus: 'private',
              location: { countryCode: view.shopCountry },
            },
          },
    ),
    getOrFetchShop: vi.fn(async () => ({ name: 'Satoshi Vintage' })),
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

const STUDIO_LINKS = ['Inventory', 'Payment settings', 'Store connections'] as const;

beforeEach(() => {
  resetRegionState();
  view.shopCountry = 'CH';
  view.listings = [toCommerceListingModel(createCommerceListingFixture({ title: 'Vintage boots' }))];
  view.ordersToShip = 0;
  view.unfinishedDrafts = [];
  dashboardFns.updateListingState.mockClear();
});
afterEach(() => resetRegionState());

async function renderStudio() {
  render(<MarketplaceDashboard />);
  await screen.findByRole('heading', { name: 'My shop' });
}

describe('the seller studio in a blocked region', () => {
  it('stays open and read-only for a seller whose region is blocked, with the selling line', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('GB');
    await renderStudio();

    const notice = await screen.findByTestId('dashboard-selling-unavailable');
    expect(notice).toHaveTextContent("Selling isn't available in your region yet.");
    expect(screen.queryByTestId('selling-unavailable-hint')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'My listings' })).toBeInTheDocument();
    expect(screen.getByText('Vintage boots')).toBeInTheDocument();
  });

  it('turns off everything that publishes or sets up selling, and keeps the rest', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('GB');
    await renderStudio();
    await screen.findByTestId('dashboard-selling-unavailable');

    expect(screen.getByRole('button', { name: /Sell an item/ })).toBeDisabled();
    for (const name of STUDIO_LINKS) {
      expect(screen.queryByRole('link', { name: new RegExp(name) })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeDisabled();
    }
    const row = screen.getByRole('row', { name: /Vintage boots/ });
    expect(within(row).getByRole('button', { name: /Edit/ })).toBeDisabled();
    expect(within(row).getByRole('button', { name: /Duplicate/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Activate/ })).toBeDisabled();

    expect(screen.getByRole('link', { name: /Storefront/ })).toHaveAttribute('href', MARKETPLACE_ROUTES.MY_SHOP);
    expect(screen.getByRole('link', { name: /Shipping presets/ })).toHaveAttribute(
      'href',
      MARKETPLACE_ROUTES.SETTINGS_SHIPPING,
    );
    expect(screen.getByRole('link', { name: /Orders/ })).toHaveAttribute('href', MARKETPLACE_ROUTES.ORDERS);
    expect(screen.getByRole('button', { name: /Export/ })).toBeEnabled();
  });

  it('still takes a listing down: Pause stays available', async () => {
    const user = userEvent.setup();
    setRegionModes(LAUNCH);
    stubClientRegion('GB');
    await renderStudio();
    await screen.findByTestId('dashboard-selling-unavailable');

    await user.click(screen.getByRole('checkbox', { name: /Select Vintage boots/ }));
    const pause = screen.getByRole('button', { name: /Pause/ });
    expect(pause).toBeEnabled();
    await user.click(pause);
    expect(dashboardFns.updateListingState).toHaveBeenCalledWith([expect.any(String)], 'paused');
  });

  it('keeps the way to the orders that need shipping', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('GB');
    view.ordersToShip = 2;
    await renderStudio();
    await screen.findByTestId('dashboard-selling-unavailable');

    expect(screen.getByText(/2 paid orders to ship/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ship orders' })).toHaveAttribute('href', MARKETPLACE_ROUTES.ORDERS);
  });

  it('turns off resuming an unfinished draft but keeps discarding it', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('GB');
    view.unfinishedDrafts = [
      { listingId: 'd1', title: 'Draft one', updatedAt: 1, ageLabel: 'today' },
      { listingId: 'd2', title: 'Draft two', updatedAt: 2, ageLabel: 'today' },
    ];
    await renderStudio();
    await screen.findByTestId('dashboard-selling-unavailable');

    for (const resume of screen.getAllByRole('button', { name: 'Resume' })) expect(resume).toBeDisabled();
    for (const discard of screen.getAllByRole('button', { name: 'Discard' })) expect(discard).toBeEnabled();
  });

  it('tells a seller whose shop country is blocked to update it, with a link to the field, from an open country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    view.shopCountry = 'GB';
    await renderStudio();

    const notice = await screen.findByTestId('dashboard-selling-unavailable');
    expect(notice).toHaveTextContent("Your shop country is United Kingdom, where selling isn't available yet.");
    expect(notice).not.toHaveTextContent('in your region');
    expect(within(notice).getByRole('link', { name: 'update your shop country' })).toHaveAttribute(
      'href',
      '/marketplace/storefront#countryCode',
    );
    expect(screen.getByRole('button', { name: /Sell an item/ })).toBeDisabled();
  });

  it('names a blocked shop country without linking to the locked field when the seller is inside the block too', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('US');
    view.shopCountry = 'GB';
    await renderStudio();

    const notice = await screen.findByTestId('dashboard-selling-unavailable');
    await waitFor(() =>
      expect(notice).toHaveTextContent("Your shop country is United Kingdom, where selling isn't available yet."),
    );
    expect(within(notice).queryByRole('link', { name: 'update your shop country' })).not.toBeInTheDocument();
  });

  it('opens up for a seller from an open country with an open shop country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    await renderStudio();

    await waitFor(() => expect(screen.getByRole('link', { name: /Sell an item/ })).toBeInTheDocument());
    expect(screen.queryByTestId('dashboard-selling-unavailable')).not.toBeInTheDocument();
    for (const name of STUDIO_LINKS) expect(screen.getByRole('link', { name: new RegExp(name) })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Orders$/ })).not.toBeInTheDocument();
  });

  it('is the studio of today, reading no region, while no region is blocked', async () => {
    setRegionModes('EU=nuanced,GB=nuanced');
    const fetchStub = stubClientRegion('US');
    await renderStudio();

    expect(screen.getByRole('link', { name: /Sell an item/ })).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-selling-unavailable')).not.toBeInTheDocument();
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
