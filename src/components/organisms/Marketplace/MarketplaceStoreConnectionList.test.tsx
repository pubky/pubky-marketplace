import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStoreConnectionCatalogRoute } from '@/app/routes';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import type { StoreConnectionRow } from '@/hooks/useStoreConnections/useStoreConnections';
import { connectionHealth, connectorConnectionSchema } from '@/libs/commerce/connectors';
import { MarketplaceStoreConnectionList } from './MarketplaceStoreConnectionList';

vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: { commitReplaceCredentials: vi.fn() },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

function row(
  overrides: Record<string, unknown> = {},
  options: { disconnectedLocally?: boolean } = {},
): StoreConnectionRow {
  const connection = connectorConnectionSchema.parse({
    id: 'c1',
    provider: 'woocommerce',
    domain: 'dezentralshop.ch',
    status: 'connected',
    scopes: ['read_write'],
    connectedAt: '2026-10-15T10:00:00.000Z',
    mappingCount: 7,
    pushes: { pending: 0, sending: 1, created: 3, quarantined: 0 },
    ...overrides,
  });
  return { connection, health: connectionHealth(connection, options) };
}

function renderList(
  rows: StoreConnectionRow[],
  handlers: Partial<Parameters<typeof MarketplaceStoreConnectionList>[0]> = {},
) {
  const props = {
    rows,
    workingId: null,
    onDisconnect: vi.fn().mockResolvedValue(true),
    onReplaced: vi.fn(),
    ...handlers,
  };
  render(<MarketplaceStoreConnectionList {...props} />);
  return props;
}

describe('MarketplaceStoreConnectionList', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a connected store with its counts and the way to choose products', () => {
    renderList([row()]);

    const card = screen.getByTestId('store-connection');
    expect(within(card).getByTestId('store-connection-state')).toHaveTextContent('Connected');
    expect(card).toHaveTextContent('dezentralshop.ch');
    expect(card).toHaveTextContent('WooCommerce, connected Oct 15, 2026');
    expect(screen.getByTestId('store-connection-counts')).toHaveTextContent(
      '7 products linked, 3 orders sent to your store, 1 on the way.',
    );
    expect(screen.getByRole('link', { name: 'Choose products' })).toHaveAttribute(
      'href',
      getStoreConnectionCatalogRoute('c1'),
    );
  });

  it('shows Needs attention with every reason', () => {
    renderList([
      row({
        provider: 'shopify',
        domain: 'a.myshopify.com',
        scopes: ['read_products'],
        pushes: { pending: 0, sending: 0, created: 0, quarantined: 2 },
      }),
    ]);

    expect(screen.getByTestId('store-connection-state')).toHaveTextContent('Needs attention');
    const reasons = screen.getByTestId('store-connection-reasons');
    expect(reasons).toHaveTextContent(
      'Missing permissions: read_inventory, read_locations, read_fulfillments, write_orders',
    );
    expect(reasons).toHaveTextContent('2 orders need your attention in Orders.');
  });

  it('shows a rejected key and still offers Replace credentials', () => {
    renderList([row({ status: 'error', lastError: { message: 'credentials_rejected' } })]);
    expect(screen.getByTestId('store-connection-reasons')).toHaveTextContent('WooCommerce rejected the saved keys.');
    expect(screen.getByRole('button', { name: 'Replace credentials' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Choose products' })).not.toBeInTheDocument();
  });

  it('shows a store that was disconnected with the reminder to revoke it there, and no actions', () => {
    renderList([row({ provider: 'shopify', domain: 'a.myshopify.com' }, { disconnectedLocally: true })]);
    expect(screen.getByTestId('store-connection-state')).toHaveTextContent('Disconnected');
    expect(screen.getByTestId('store-connection-disconnected')).toHaveTextContent(
      'Also uninstall the app in Shopify to revoke it there.',
    );
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Replace credentials' })).not.toBeInTheDocument();
  });

  it('points an unfinished connection back to the guide', () => {
    renderList([row({ provider: 'shopify', status: 'draft', domain: 'a.myshopify.com' })]);
    expect(screen.getByTestId('store-connection-state')).toHaveTextContent('Not finished');
    expect(screen.getByTestId('store-connection')).toHaveTextContent('Use the guide below to complete it.');
  });

  it('asks before it disconnects, then disconnects and closes', async () => {
    const user = userEvent.setup();
    const { onDisconnect } = renderList([row()]);

    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Disconnect dezentralshop.ch?');
    expect(dialog).toHaveTextContent('delete the key in WooCommerce under Settings, Advanced, REST API');
    expect(onDisconnect).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    expect(onDisconnect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps the dialog open when the disconnect fails', async () => {
    const user = userEvent.setup();
    renderList([row()], { onDisconnect: vi.fn().mockResolvedValue(false) });

    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Disconnect' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not disconnect when the seller keeps the connection', async () => {
    const user = userEvent.setup();
    const { onDisconnect } = renderList([row()]);
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep connected' }));
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it('replaces credentials with password fields named for the store type, and clears them', async () => {
    const user = userEvent.setup();
    vi.mocked(ConnectorsController.commitReplaceCredentials).mockResolvedValue({ authorizeUrl: null });
    const { onReplaced } = renderList([row()]);

    await user.click(screen.getByRole('button', { name: 'Replace credentials' }));
    const dialog = await screen.findByRole('dialog');
    const first = within(dialog).getByLabelText('Consumer key');
    const second = within(dialog).getByLabelText('Consumer secret');
    expect(first).toHaveAttribute('type', 'password');
    expect(second).toHaveAttribute('type', 'password');
    expect(first).toHaveAttribute('autocomplete', 'off');

    await user.type(first, 'ck_newkeyvalue1');
    await user.type(second, 'cs_newsecretvalue1');
    await user.click(within(dialog).getByRole('button', { name: 'Replace credentials' }));

    await waitFor(() => expect(ConnectorsController.commitReplaceCredentials).toHaveBeenCalledTimes(1));
    expect(ConnectorsController.commitReplaceCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1', provider: 'woocommerce' }),
      { first: 'ck_newkeyvalue1', second: 'cs_newsecretvalue1' },
    );
    await waitFor(() => expect(onReplaced).toHaveBeenCalledTimes(1));
    expect(localStorage.length).toBe(0);
  });

  it('asks for the Shopify Client ID and secret on a Shopify connection', async () => {
    const user = userEvent.setup();
    renderList([row({ provider: 'shopify', domain: 'a.myshopify.com' })]);
    await user.click(screen.getByRole('button', { name: 'Replace credentials' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Client ID')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Client secret')).toBeInTheDocument();
  });
});
