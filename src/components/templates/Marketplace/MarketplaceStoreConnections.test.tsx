import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { connectorAlertSchema, SHOPIFY_REQUIRED_SCOPES } from '@/libs/commerce/connectors';
import { connectorRefusal } from '@/test-utils/connector-errors';
import { connectionFixture } from '@/test-utils/connector-fixtures';
import { MarketplaceStoreConnections } from './MarketplaceStoreConnections';

const nav = vi.hoisted(() => ({ query: '', replace: vi.fn() }));
const mode = vi.hoisted(() => ({ value: 'transaction-service' as string, enabled: true }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => '/marketplace/settings/store-connections',
  useSearchParams: () => new URLSearchParams(nav.query),
}));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => mode.value, getStoreConnectionsEnabled: () => mode.enabled };
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

vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: {
    fetchConnections: vi.fn(),
    fetchAlerts: vi.fn(async () => []),
    commitResolveAlert: vi.fn(),
    commitVariantMode: vi.fn(),
    fetchConnectionCheck: vi.fn(),
    commitDisconnect: vi.fn(),
    commitConnectWooCommerce: vi.fn(),
    commitConnectWooCommerceWithKeys: vi.fn(),
    commitCreateShopifyDraft: vi.fn(),
    commitShopifyCredentials: vi.fn(),
    commitReplaceCredentials: vi.fn(),
  },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

function connection(id: string, overrides: Record<string, unknown> = {}) {
  return connectionFixture({
    id,
    provider: 'woocommerce',
    domain: `${id}.example.com`,
    status: 'connected',
    scopes: ['read_write'],
    ...overrides,
  });
}

describe('MarketplaceStoreConnections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nav.query = '';
    mode.value = 'transaction-service';
    mode.enabled = true;
    vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([]);
  });

  it('shows the empty state and the WooCommerce connect flow first', async () => {
    render(<MarketplaceStoreConnections />);

    expect(await screen.findByTestId('store-connections-empty')).toHaveTextContent('No store connected yet');
    expect(screen.getByRole('heading', { name: 'Store connections' })).toBeInTheDocument();
    expect(screen.getByTestId('connect-woocommerce')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'WooCommerce' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('store-access-notes')).toHaveTextContent('Create an order in your WooCommerce store');
  });

  it('switches to the Shopify guide', async () => {
    const user = userEvent.setup();
    render(<MarketplaceStoreConnections />);
    await screen.findByTestId('connect-woocommerce');

    await user.click(screen.getByRole('tab', { name: 'Shopify' }));

    expect(screen.getByTestId('connect-shopify')).toBeInTheDocument();
    expect(screen.getByTestId('store-access-notes')).toHaveTextContent('Create an order in your Shopify store');
  });

  it('lists the connections with their status', async () => {
    vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([
      connection('a'),
      connection('b', { status: 'error', lastError: { message: 'credentials_rejected' } }),
    ]);
    render(<MarketplaceStoreConnections />);

    const cards = await screen.findAllByTestId('store-connection');
    expect(cards.map((card) => card.getAttribute('data-state'))).toEqual(['connected', 'needs_attention']);
  });

  it('resumes an unfinished Shopify draft in the guide', async () => {
    vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([
      connection('d', { provider: 'shopify', domain: 'd.myshopify.com', status: 'draft' }),
    ]);
    const user = userEvent.setup();
    render(<MarketplaceStoreConnections />);
    await screen.findByTestId('store-connection');

    await user.click(screen.getByRole('tab', { name: 'Shopify' }));

    expect(screen.getByTestId('shopify-step-4')).toHaveAttribute('data-locked', 'false');
    expect(within(screen.getByTestId('shopify-step-1')).getByText('d.myshopify.com')).toBeInTheDocument();
  });

  it('says a store that uninstalled the app is gone, and dismisses the alert', async () => {
    const alert = connectorAlertSchema.parse({
      id: 'a1',
      connectionId: 'gone',
      kind: 'store_uninstalled',
      createdAt: '2026-10-15T12:00:00.000Z',
    });
    vi.mocked(ConnectorsController.fetchAlerts).mockResolvedValue([alert]);
    vi.mocked(ConnectorsController.commitResolveAlert).mockResolvedValue();
    const user = userEvent.setup();
    render(<MarketplaceStoreConnections />);

    const notice = await screen.findByTestId('store-connections-lost');
    expect(notice).toHaveTextContent('The app was removed from your store, so the connection is closed.');
    await user.click(within(notice).getByRole('button', { name: 'Dismiss' }));

    expect(ConnectorsController.commitResolveAlert).toHaveBeenCalledWith('a1');
    await waitFor(() => expect(screen.queryByTestId('store-connections-lost')).not.toBeInTheDocument());
  });

  it('switches a connection to one listing per variant and shows the saved setting', async () => {
    vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([connection('a')]);
    vi.mocked(ConnectorsController.commitVariantMode).mockResolvedValue({
      connection: connection('a', { variantMode: 'split' }),
      unmappedListings: [],
    });
    const user = userEvent.setup();
    render(<MarketplaceStoreConnections />);

    const toggle = await screen.findByRole('switch', { name: 'One listing per size or variant' });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);

    expect(ConnectorsController.commitVariantMode).toHaveBeenCalledWith('a', 'split');
    await waitFor(() => expect(screen.getByRole('switch', { name: 'One listing per size or variant' })).toBeChecked());
    expect(screen.queryByTestId('store-connections-unmapped')).not.toBeInTheDocument();
  });

  it('shows the listings the switch to split unlinked, each as a link, with the catalog and Dismiss', async () => {
    vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([connection('a')]);
    vi.mocked(ConnectorsController.commitVariantMode).mockResolvedValue({
      connection: connection('a', { variantMode: 'split' }),
      unmappedListings: [
        { listingId: 'boots_01', mappingsRemoved: 2 },
        { listingId: 'woo-9', mappingsRemoved: 3 },
      ],
    });
    const user = userEvent.setup();
    render(<MarketplaceStoreConnections />);

    await user.click(await screen.findByRole('switch', { name: 'One listing per size or variant' }));

    const notice = await screen.findByTestId('store-connections-unmapped');
    expect(notice).toHaveTextContent(
      "These listings were combined, so they're no longer linked. Re-import them from the catalog or end them.",
    );
    const seller = 'y'.repeat(52);
    expect(within(notice).getByRole('link', { name: 'boots_01' })).toHaveAttribute(
      'href',
      `/marketplace/listing/${seller}/boots_01`,
    );
    expect(within(notice).getByRole('link', { name: 'woo-9' })).toHaveAttribute(
      'href',
      `/marketplace/listing/${seller}/woo-9`,
    );
    expect(within(notice).getByRole('link', { name: 'Open the catalog' })).toHaveAttribute(
      'href',
      '/marketplace/settings/store-connections/a',
    );
    await user.click(within(notice).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('store-connections-unmapped')).not.toBeInTheDocument();
  });

  it('asks for a marketplace session when the service wants one', async () => {
    const expired = connectorRefusal('x', 401);
    Object.assign(expired, { code: 'SESSION_EXPIRED' });
    vi.mocked(ConnectorsController.fetchConnections).mockRejectedValue(expired);
    render(<MarketplaceStoreConnections />);
    expect(await screen.findByTestId('session-required')).toBeInTheDocument();
  });

  it('says store connections are not switched on when the service has them off', async () => {
    vi.mocked(ConnectorsController.fetchConnections).mockRejectedValue(connectorRefusal('connectors_disabled', 404));
    render(<MarketplaceStoreConnections />);
    expect(await screen.findByTestId('store-connections-unavailable')).toHaveTextContent(
      'Store connections are not switched on for this shop yet.',
    );
    expect(screen.queryByTestId('connect-woocommerce')).not.toBeInTheDocument();
  });

  it('stops offering new connections at the limit of five', async () => {
    vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue(
      ['a', 'b', 'c', 'd', 'e'].map((id) => connection(id)),
    );
    render(<MarketplaceStoreConnections />);
    await screen.findAllByTestId('store-connection');
    expect(screen.queryByTestId('connect-woocommerce')).not.toBeInTheDocument();
    expect(screen.getByText(/You have 5 store connections/)).toBeInTheDocument();
  });

  describe('coming back from the store', () => {
    it('checks a Shopify install the service reports as connected, then clears the query', async () => {
      nav.query = 'status=connected&connector=s1';
      const shop = connection('s1', {
        provider: 'shopify',
        domain: 's1.myshopify.com',
        scopes: [...SHOPIFY_REQUIRED_SCOPES],
      });
      vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([shop]);
      vi.mocked(ConnectorsController.fetchConnectionCheck).mockResolvedValue({
        connection: shop,
        health: { state: 'connected', reasons: [], missingScopes: [] },
        productCount: 9,
        catalogReadable: true,
        store: { shopName: 'S One', grantedScopes: [...SHOPIFY_REQUIRED_SCOPES], locationCount: 1 },
      });
      render(<MarketplaceStoreConnections />);

      const card = await screen.findByTestId('store-connections-return-check');
      await waitFor(() => expect(within(card).getByTestId('status-check')).toHaveAttribute('data-phase', 'connected'));
      expect(card).toHaveTextContent('Connected to S One');
      expect(card).toHaveTextContent('9 products are ready to import.');
      expect(ConnectorsController.fetchConnectionCheck).toHaveBeenCalledWith('s1');
      expect(nav.replace).toHaveBeenCalledWith('/marketplace/settings/store-connections');
    });

    it('explains a Shopify install error', async () => {
      nav.query = 'status=error&code=shop_in_use';
      render(<MarketplaceStoreConnections />);
      expect(await screen.findByTestId('store-connections-notice')).toHaveTextContent(
        'That store is already connected to another Pubky shop.',
      );
      expect(await screen.findByTestId('connect-shopify')).toBeInTheDocument();
    });

    it('checks an install that finished with a permission missing and names it', async () => {
      nav.query = 'status=needs_attention&connector=s2';
      const shop = connection('s2', {
        provider: 'shopify',
        domain: 's2.myshopify.com',
        status: 'needs_attention',
        scopes: ['read_products'],
        missingScopes: ['write_orders'],
      });
      vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([shop]);
      vi.mocked(ConnectorsController.fetchConnectionCheck).mockResolvedValue({
        connection: shop,
        health: {
          state: 'needs_attention',
          reasons: ['Missing permissions: write_orders. Add them.'],
          missingScopes: ['write_orders'],
        },
        productCount: null,
        catalogReadable: true,
        store: null,
      });
      render(<MarketplaceStoreConnections />);

      const card = await screen.findByTestId('store-connections-return-check');
      await waitFor(() => expect(within(card).getByTestId('status-check')).toHaveAttribute('data-phase', 'attention'));
      expect(card).toHaveTextContent('Missing permissions: write_orders');
    });

    it('explains the launch errors the service sends back', async () => {
      nav.query = 'status=error&code=invalid_launch&connector=s3';
      render(<MarketplaceStoreConnections />);
      expect(await screen.findByTestId('store-connections-notice')).toHaveTextContent(
        "Shopify's install request could not be verified",
      );
    });

    it('runs the status check after a WooCommerce approval', async () => {
      nav.query = 'success=1&user_id=nonce';
      const woo = connection('w1', { domain: 'dezentralshop.ch' });
      vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([woo]);
      vi.mocked(ConnectorsController.fetchConnectionCheck).mockResolvedValue({
        connection: woo,
        health: { state: 'connected', reasons: [], missingScopes: [] },
        productCount: 3,
        catalogReadable: true,
        store: null,
      });
      render(<MarketplaceStoreConnections />);

      await waitFor(() => expect(ConnectorsController.fetchConnectionCheck).toHaveBeenCalledWith('w1'));
      await waitFor(() => expect(screen.getByTestId('status-check')).toHaveAttribute('data-phase', 'connected'));
    });

    it('says nothing was connected after WooCommerce declined', async () => {
      nav.query = 'success=0&user_id=nonce';
      render(<MarketplaceStoreConnections />);
      expect(await screen.findByTestId('woo-declined')).toBeInTheDocument();
      expect(ConnectorsController.fetchConnectionCheck).not.toHaveBeenCalled();
    });
  });
});
