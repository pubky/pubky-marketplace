import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { SELLING_BLOCKED_MESSAGE } from '@/libs/commerce/region-modes';
import { useAuthStore } from '@/stores/auth/auth.store';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
import { asOpaque } from '@/test-utils/type-assertions';
import AutomationsPage from './dashboard/inventory/automations/page';
import InventoryPage from './dashboard/inventory/page';
import DashboardPage from './dashboard/page';
import EditListingPage from './listing/[sellerPubky]/[listingId]/edit/page';
import DropMissionControlPage from './sell/drops/[dropId]/page';
import DropStudioPage from './sell/drops/page';
import SellPage from './sell/page';
import PaymentSettingsPage from './settings/page';
import ConnectorCatalogPage from './settings/store-connections/[connectionId]/page';
import StoreConnectionsPage from './settings/store-connections/page';
import StorefrontPage from './storefront/page';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { getShop: vi.fn(async () => null) },
}));

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/templates/Marketplace/MarketplaceSell', () => ({ MarketplaceSell: () => <p>page: sell</p> }));
vi.mock('@/templates/Marketplace/MarketplaceMyShop', () => ({ MarketplaceMyShop: () => <p>page: storefront</p> }));
vi.mock('@/templates/Marketplace/MarketplaceDashboard', () => ({ MarketplaceDashboard: () => <p>page: studio</p> }));
vi.mock('@/templates/Marketplace/MarketplaceInventory', () => ({ MarketplaceInventory: () => <p>page: inventory</p> }));
vi.mock('@/templates/Marketplace/MarketplaceInventoryAutomations', () => ({
  MarketplaceInventoryAutomations: () => <p>page: automations</p>,
}));
vi.mock('@/templates/Marketplace/MarketplacePaymentSettings', () => ({
  MarketplacePaymentSettings: () => <p>page: get paid</p>,
}));
vi.mock('@/templates/Marketplace/MarketplaceStoreConnections', () => ({
  MarketplaceStoreConnections: () => <p>page: store connections</p>,
}));
vi.mock('@/templates/Marketplace/MarketplaceConnectorCatalog', () => ({
  MarketplaceConnectorCatalog: () => <p>page: store catalog</p>,
}));
vi.mock('@/templates/Marketplace/MarketplaceEditListing', () => ({
  MarketplaceEditListing: () => <p>page: edit listing</p>,
}));
vi.mock('@/organisms/Marketplace/DropStudioHome', () => ({ DropStudioHome: () => <p>page: drops studio</p> }));
vi.mock('@/organisms/Marketplace/DropMissionControl', () => ({
  DropMissionControl: () => <p>page: drop mission control</p>,
}));

const SELLER = 's'.repeat(52);
const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';

const sellingPages: Array<[string, () => Promise<React.ReactElement> | React.ReactElement, string]> = [
  ['Sell', () => <SellPage />, 'page: sell'],
  ['the seller studio', () => <DashboardPage />, 'page: studio'],
  ['My storefront', () => <StorefrontPage />, 'page: storefront'],
  ['inventory', () => <InventoryPage />, 'page: inventory'],
  ['inventory automations', () => <AutomationsPage />, 'page: automations'],
  ['Get paid settings', () => <PaymentSettingsPage />, 'page: get paid'],
  ['store connections', () => <StoreConnectionsPage />, 'page: store connections'],
  [
    'a store catalog',
    () => ConnectorCatalogPage({ params: Promise.resolve({ connectionId: 'c1' }) }),
    'page: store catalog',
  ],
  ['the drops studio', () => <DropStudioPage />, 'page: drops studio'],
  [
    'drop mission control',
    () => DropMissionControlPage({ params: Promise.resolve({ dropId: 'vol1' }) }),
    'page: drop mission control',
  ],
  [
    'the listing editor',
    () => EditListingPage({ params: Promise.resolve({ sellerPubky: SELLER, listingId: 'boots_01' }) }),
    'page: edit listing',
  ],
];

beforeEach(() => {
  resetRegionState();
  useAuthStore.setState({ currentUserPubky: SELLER });
});
afterEach(() => {
  resetRegionState();
  useAuthStore.setState({ currentUserPubky: null });
});

describe('the seller pages of the Market', () => {
  it('opens My storefront to a seller in an open country whose shop is in a blocked one, to change the country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    vi.mocked(CommerceController.getShop).mockResolvedValue(asOpaque({ record: { location: { countryCode: 'US' } } }));
    render(<StorefrontPage />);

    expect(await screen.findByText('page: storefront')).toBeInTheDocument();
    expect(screen.queryByTestId('selling-unavailable')).not.toBeInTheDocument();
    vi.mocked(CommerceController.getShop).mockResolvedValue(null);
  });

  describe.each(sellingPages)('%s', (_name, page, marker) => {
    it('shows the selling line and a way back to the Market in a blocked region, not the page', async () => {
      setRegionModes(LAUNCH);
      stubClientRegion('US');
      render(await page());

      expect(await screen.findByTestId('selling-unavailable')).toHaveTextContent(SELLING_BLOCKED_MESSAGE);
      expect(screen.getByRole('link', { name: 'Back to the Market' })).toHaveAttribute('href', '/marketplace');
      expect(screen.queryByText(marker)).not.toBeInTheDocument();
    });

    it('renders the page for a seller from an open country', async () => {
      setRegionModes(LAUNCH);
      stubClientRegion('CH');
      render(await page());

      expect(await screen.findByText(marker)).toBeInTheDocument();
      expect(screen.queryByTestId('selling-unavailable')).not.toBeInTheDocument();
    });

    it('renders the page, and reads no region, while no region is blocked', async () => {
      setRegionModes('EU=nuanced,GB=nuanced');
      const fetchStub = stubClientRegion('US');
      render(await page());

      expect(screen.getByText(marker)).toBeInTheDocument();
      expect(fetchStub).not.toHaveBeenCalled();
    });
  });
});
