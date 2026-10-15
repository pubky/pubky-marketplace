import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import type { OrderPushRow } from '@/application/connectors/connectors';
import { useConnectorPushStatus } from '@/hooks/useConnectorPushStatus/useConnectorPushStatus';
import { connectorAlertSchema, connectorPushSchema } from '@/libs/commerce/connectors';
import { connectionFixture } from '@/test-utils/connector-fixtures';
import { asOpaque } from '@/test-utils/type-assertions';
import { MarketplaceConnectorPushStatus } from './MarketplaceConnectorPushStatus';

vi.mock('@/hooks/useConnectorPushStatus/useConnectorPushStatus', () => ({ useConnectorPushStatus: vi.fn() }));

const connection = connectionFixture({
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

  it.each([
    ['refund_reversed_after_mirror', 'order-4-aaaaaaaa', 'Correct it in your store'],
    ['push_total_mismatch', 'order-5-aaaaaaaa', 'different total than the buyer paid'],
    ['listings_unmapped', null, 'Import each variant again'],
  ])(
    'shows a %s alert in plain words with no action and no retry, and can dismiss it',
    async (kind, orderId, phrase) => {
      const alert = connectorAlertSchema.parse({
        id: 'n1',
        connectionId: 'c1',
        kind,
        pubkyOrderId: orderId,
        detail: 'Service detail the seller does not need to read.',
        createdAt: '2026-10-15T12:00:00.000Z',
      });
      const value = status({ alerts: [alert] });
      render(<MarketplaceConnectorPushStatus />);

      const item = screen.getByTestId('store-push-alert');
      expect(item).toHaveTextContent(phrase);
      expect(item).not.toHaveTextContent('Something needs your attention');
      expect(screen.queryByTestId('store-push-alert-action')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
      if (orderId) expect(within(item).getByRole('link')).toBeInTheDocument();
      else expect(within(item).queryByRole('link')).not.toBeInTheDocument();
      await userEvent.setup().click(within(item).getByRole('button', { name: 'Dismiss' }));
      expect(value.dismissAlert).toHaveBeenCalledWith('n1');
    },
  );

  it('offers a one-click entry into the order for a store-side cancel the buyer asked for', () => {
    const alert = connectorAlertSchema.parse({
      id: 'a3',
      connectionId: 'c1',
      kind: 'merchant_cancelled',
      pubkyOrderId: 'order-5',
      orderState: 'cancel_requested',
      action: {
        kind: 'approve_cancellation',
        command: 'order.cancel_approve',
        orderId: 'order-5',
        label: 'Approve the buyer’s cancellation request',
      },
      createdAt: '2026-10-15T12:00:00.000Z',
    });
    status({ alerts: [alert] });
    render(<MarketplaceConnectorPushStatus />);

    const action = screen.getByTestId('store-push-alert-action');
    expect(action).toHaveTextContent("Approve the buyer's cancellation request");
    expect(action).toHaveAttribute('href', '#order-order-5');
  });

  it('offers recording the refund for a store-side refund of a cancelled order', () => {
    const alert = connectorAlertSchema.parse({
      id: 'a4',
      connectionId: 'c1',
      kind: 'merchant_refunded',
      pubkyOrderId: 'order-6',
      orderState: 'cancelled',
      action: { kind: 'record_refund', command: 'refund.record_external', orderId: 'order-6', label: 'x' },
      createdAt: '2026-10-15T12:00:00.000Z',
    });
    status({ alerts: [alert] });
    render(<MarketplaceConnectorPushStatus />);
    expect(screen.getByTestId('store-push-alert-action')).toHaveTextContent('Record the refund you sent the buyer');
  });

  it('shows no entry when no Pubky flow applies, and none for a command the Shop does not know', () => {
    const informs = connectorAlertSchema.parse({
      id: 'a5',
      connectionId: 'c1',
      kind: 'merchant_cancelled',
      pubkyOrderId: 'order-7',
      orderState: 'paid',
      action: null,
      createdAt: '2026-10-15T12:00:00.000Z',
    });
    const unknown = connectorAlertSchema.parse({
      id: 'a6',
      connectionId: 'c1',
      kind: 'merchant_cancelled',
      pubkyOrderId: 'order-8',
      action: { kind: 'cancel_it_all', command: 'order.cancel', orderId: 'order-8', label: 'Cancel everything' },
      createdAt: '2026-10-15T12:00:00.000Z',
    });
    status({ alerts: [informs, unknown] });
    render(<MarketplaceConnectorPushStatus />);
    expect(screen.queryByTestId('store-push-alert-action')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(2);
  });
});
