import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import type { OrderPushRow } from '@/application/connectors/connectors';
import { useConnectorPushStatus } from '@/hooks/useConnectorPushStatus/useConnectorPushStatus';
import { connectorAlertSchema, connectorConnectionSchema, connectorPushSchema } from '@/libs/commerce/connectors';
import { asOpaque } from '@/test-utils/type-assertions';
import { MarketplaceConnectorPushStatus } from './MarketplaceConnectorPushStatus';

vi.mock('@/hooks/useConnectorPushStatus/useConnectorPushStatus', () => ({ useConnectorPushStatus: vi.fn() }));

const connection = connectorConnectionSchema.parse({
  id: 'c1',
  provider: 'woocommerce',
  domain: 'dezentralshop.ch',
  status: 'connected',
  scopes: ['read_write'],
});

function row(id: string, overrides: Record<string, unknown> = {}): OrderPushRow {
  return {
    connection,
    push: connectorPushSchema.parse({
      id: `push-${id}`,
      pubkyOrderId: `order-${id}-aaaaaaaa`,
      provider: 'woocommerce',
      state: 'created',
      externalId: '501',
      createdAt: '2026-10-15T12:00:00.000Z',
      updatedAt: '2026-10-15T12:00:00.000Z',
      ...overrides,
    }),
  };
}

function status(overrides: Partial<ReturnType<typeof useConnectorPushStatus>> = {}) {
  const value = {
    visible: true,
    connections: [connection],
    pushes: [] as OrderPushRow[],
    needsAttention: [] as OrderPushRow[],
    alerts: [],
    retryingOrderId: null,
    retry: vi.fn().mockResolvedValue(true),
    dismissAlert: vi.fn().mockResolvedValue(true),
    refresh: vi.fn(),
    ...overrides,
  };
  vi.mocked(useConnectorPushStatus).mockReturnValue(asOpaque<ReturnType<typeof useConnectorPushStatus>>(value));
  return value;
}

describe('MarketplaceConnectorPushStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing for a seller without a connected store', () => {
    status({ visible: false });
    const { container } = render(<MarketplaceConnectorPushStatus />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says paid orders will show up once any reaches the store', () => {
    status();
    render(<MarketplaceConnectorPushStatus />);
    expect(screen.getByTestId('store-push-empty')).toHaveTextContent('Paid Pubky orders will appear here');
    expect(screen.getByRole('link', { name: 'Store connections' })).toHaveAttribute(
      'href',
      MARKETPLACE_ROUTES.SETTINGS_STORE_CONNECTIONS,
    );
  });

  it('lists each order with its push state and the store order number', () => {
    const sent = row('1');
    const waiting = row('2', { state: 'sending', externalId: null });
    status({ pushes: [sent, waiting] });
    render(<MarketplaceConnectorPushStatus />);

    const rows = screen.getAllByTestId('store-push-row');
    expect(rows[0]).toHaveTextContent('Order order-1-');
    expect(rows[0]).toHaveTextContent('in dezentralshop.ch (WooCommerce, #501)');
    expect(within(rows[0] as HTMLElement).getByTestId('store-push-state')).toHaveTextContent('In your store');
    expect(within(rows[1] as HTMLElement).getByTestId('store-push-state')).toHaveTextContent('Sending');
    expect(within(rows[0] as HTMLElement).getByRole('link')).toHaveAttribute('href', '#order-order-1-aaaaaaaa');
  });

  it('shows a quarantined order with why, and Retry sends it again', async () => {
    const stuck = row('3', {
      state: 'quarantined',
      quarantineReason: 'unmapped_variant',
      quarantineSeverity: 'action_required',
    });
    const value = status({ pushes: [stuck], needsAttention: [stuck] });
    render(<MarketplaceConnectorPushStatus />);

    const item = screen.getByTestId('store-push-quarantined');
    expect(item).toHaveTextContent('was not sent to dezentralshop.ch');
    expect(item).toHaveTextContent('An item in this order is not linked to a product in your store.');
    expect(screen.queryByTestId('store-push-recent')).not.toBeInTheDocument();

    await userEvent.setup().click(within(item).getByRole('button', { name: 'Retry' }));
    expect(value.retry).toHaveBeenCalledWith(stuck);
  });

  it('disables Retry for the order being retried', () => {
    const stuck = row('3', {
      state: 'quarantined',
      quarantineReason: 'provider_rejected',
      quarantineSeverity: 'action_required',
    });
    status({ pushes: [stuck], needsAttention: [stuck], retryingOrderId: stuck.push.pubkyOrderId });
    render(<MarketplaceConnectorPushStatus />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
  });

  it('labels an order cancelled before the push as Not sent, with nothing to retry', () => {
    const info = row('4', {
      state: 'quarantined',
      quarantineReason: 'order_cancelled_before_push',
      quarantineSeverity: 'info',
    });
    status({ pushes: [info], needsAttention: [] });
    render(<MarketplaceConnectorPushStatus />);
    expect(screen.getByTestId('store-push-state')).toHaveTextContent('Not sent');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('shows a store-side cancel as a request to cancel and refund in Pubky, and can dismiss it', async () => {
    const alert = connectorAlertSchema.parse({
      id: 'a1',
      connectionId: 'c1',
      kind: 'merchant_cancelled',
      pubkyOrderId: 'order-9-aaaaaaaa',
      createdAt: '2026-10-15T12:00:00.000Z',
    });
    const value = status({ alerts: [alert] });
    render(<MarketplaceConnectorPushStatus />);

    const item = screen.getByTestId('store-push-alert');
    expect(item).toHaveTextContent(
      'Cancel it in Pubky too, and send the refund yourself: nothing is refunded automatically.',
    );
    await userEvent.setup().click(within(item).getByRole('button', { name: 'Dismiss' }));
    expect(value.dismissAlert).toHaveBeenCalledWith('a1');
  });
});
