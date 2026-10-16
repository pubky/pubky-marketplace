import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { connectorCatalogProductSchema } from '@/libs/commerce/connectors';
import { connectorRefusal } from '@/test-utils/connector-errors';
import { connectionFixture } from '@/test-utils/connector-fixtures';
import { MarketplaceConnectorCatalog } from './MarketplaceConnectorCatalog';

const mode = vi.hoisted(() => ({ value: 'transaction-service' as string }));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => mode.value };
});

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: 'y'.repeat(52) }),
}));

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/organisms/Marketplace/MarketplaceSectionNav', () => ({ MarketplaceSectionNav: () => null }));

vi.mock('@/organisms/Marketplace/MarketplaceSessionRequiredCard', () => ({
  MarketplaceSessionRequiredCard: () => <div data-testid="session-required" />,
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { inventoryImportDefaults: vi.fn() },
}));

vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: {
    fetchConnections: vi.fn(),
    fetchSelectedProducts: vi.fn(),
    fetchAlerts: vi.fn(async () => []),
    fetchSelection: vi.fn(),
    fetchMappings: vi.fn(),
    fetchCatalogPage: vi.fn(),
    commitSelection: vi.fn(),
  },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

const CONNECTION = connectionFixture({
  id: 'c1',
  provider: 'woocommerce',
  domain: 'dezentralshop.ch',
  status: 'connected',
  scopes: ['read_write'],
});

const PRODUCTS = [
  connectorCatalogProductSchema.parse({
    providerProductId: '1',
    title: 'Socks bundle',
    variants: [{ providerVariantId: '11', price: { amountMinor: 2500, currency: 'USD', exponent: 2 } }],
  }),
  connectorCatalogProductSchema.parse({
    providerProductId: '2',
    title: 'Notebook',
    variants: [{ providerVariantId: '21', price: { amountMinor: 1800, currency: 'USD', exponent: 2 } }],
  }),
];

describe('MarketplaceConnectorCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mode.value = 'transaction-service';
    vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([CONNECTION]);
    vi.mocked(ConnectorsController.fetchSelection).mockResolvedValue([]);
    vi.mocked(ConnectorsController.fetchMappings).mockResolvedValue([]);
    vi.mocked(ConnectorsController.fetchCatalogPage).mockResolvedValue({
      kind: 'connector_catalog',
      connectionId: 'c1',
      products: PRODUCTS,
      nextPage: null,
    });
  });

  it('names the store and lists its products', async () => {
    render(<MarketplaceConnectorCatalog connectionId="c1" />);

    expect(await screen.findByTestId('connector-catalog')).toBeInTheDocument();
    expect(screen.getByText(/Choose which products of dezentralshop.ch \(WooCommerce\)/)).toBeInTheDocument();
    expect(screen.getAllByTestId('connector-product')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Store connections' })).toHaveAttribute(
      'href',
      MARKETPLACE_ROUTES.SETTINGS_STORE_CONNECTIONS,
    );
  });

  it('saves the products the seller ticks', async () => {
    const user = userEvent.setup();
    vi.mocked(ConnectorsController.commitSelection).mockResolvedValue(['2']);
    render(<MarketplaceConnectorCatalog connectionId="c1" />);
    await screen.findByTestId('connector-catalog');

    await user.click(screen.getByRole('checkbox', { name: 'Also publish Notebook on Pubky' }));
    await user.click(screen.getByRole('button', { name: 'Save choice' }));

    await waitFor(() => expect(ConnectorsController.commitSelection).toHaveBeenCalledWith('c1', ['2']));
  });

  describe('publishing the chosen products', () => {
    it('keeps Publish off until the choice is saved, and says so', async () => {
      const user = userEvent.setup();
      render(<MarketplaceConnectorCatalog connectionId="c1" />);
      await screen.findByTestId('connector-catalog');
      expect(screen.getByRole('button', { name: 'Publish chosen products' })).toBeDisabled();

      await user.click(screen.getByRole('checkbox', { name: 'Also publish Notebook on Pubky' }));

      expect(screen.getByTestId('connector-import-save-first')).toHaveTextContent('Save your choice to publish it.');
      expect(screen.getByRole('button', { name: 'Publish chosen products' })).toBeDisabled();
    });

    it('reads the saved choice from the store and opens the settings, filled in from the shop', async () => {
      const user = userEvent.setup();
      vi.mocked(ConnectorsController.fetchSelection).mockResolvedValue(['2']);
      vi.mocked(ConnectorsController.fetchSelectedProducts).mockResolvedValue([
        connectorCatalogProductSchema.parse({ ...PRODUCTS[1], selected: true }),
      ]);
      vi.mocked(CommerceController.inventoryImportDefaults).mockResolvedValue({
        countryCode: 'US',
        shipping: null,
        currency: null,
      });
      render(<MarketplaceConnectorCatalog connectionId="c1" />);
      await screen.findByTestId('connector-catalog');

      await user.click(screen.getByRole('button', { name: 'Publish chosen products' }));

      expect(await screen.findByTestId('connector-import-settings')).toHaveTextContent(
        '1 product from dezentralshop.ch',
      );
      expect(screen.getByLabelText('Ships from (country code)')).toHaveValue('US');
      expect(screen.getByRole('combobox', { name: 'Shipping' })).toHaveTextContent('Choose shipping');

      await user.click(screen.getByRole('button', { name: 'Back to products' }));
      expect(await screen.findByTestId('connector-catalog')).toBeInTheDocument();
    });

    it('says to choose products first when nothing is saved', async () => {
      vi.mocked(ConnectorsController.fetchSelection).mockResolvedValue(['2']);
      vi.mocked(ConnectorsController.fetchSelectedProducts).mockResolvedValue([]);
      render(<MarketplaceConnectorCatalog connectionId="c1" />);
      await screen.findByTestId('connector-catalog');

      await userEvent.setup().click(screen.getByRole('button', { name: 'Publish chosen products' }));

      expect(await screen.findByTestId('connector-import-message')).toHaveTextContent(
        'Choose at least one product and save your choice first.',
      );
    });
  });

  it('says so when the connection is not one of the seller connections', async () => {
    render(<MarketplaceConnectorCatalog connectionId="other" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This store connection was not found.');
  });

  it('shows the catalog failure instead of an empty list', async () => {
    vi.mocked(ConnectorsController.fetchCatalogPage).mockRejectedValue(connectorRefusal('provider_unavailable', 502));
    render(<MarketplaceConnectorCatalog connectionId="c1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The store catalog could not be loaded');
  });
});
