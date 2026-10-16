import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceOrderTrackingController } from '@/controllers/commerce/order-tracking';
import { createOrderFixture } from '@/test/fixtures/commerce/orders';
import { MarketplaceTrackingDialog } from './MarketplaceTrackingDialog';

vi.mock('@/controllers/commerce/order-tracking', () => ({
  CommerceOrderTrackingController: { commitUpdateOrderTracking: vi.fn() },
}));

const commit = vi.mocked(CommerceOrderTrackingController.commitUpdateOrderTracking);

const shipmentOf = (carrier: string, trackingNumber: string) => ({
  carrier,
  trackingNumber,
  state: 'shipped' as const,
  shippedAt: '2026-08-14T10:00:00.000Z',
  deliveredAt: null,
});

beforeEach(() => {
  commit.mockReset().mockResolvedValue({ ok: true, result: { kind: 'order' } } as never);
});

describe('MarketplaceTrackingDialog', () => {
  it('offers Add tracking on a shipment with no number and saves the entered one', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const order = createOrderFixture('shipped', { shipment: shipmentOf('Other', '') });
    render(<MarketplaceTrackingDialog order={order} onChanged={onChanged} />);

    await user.click(screen.getByRole('button', { name: 'Add tracking' }));
    await user.type(screen.getByLabelText('Carrier name'), 'Correio da Aldeia');
    await user.type(screen.getByLabelText('Tracking number'), 'CA-0001');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(commit).toHaveBeenCalledWith(order.id, order.revision, 'Correio da Aldeia', 'CA-0001'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('offers Edit tracking with the current values when a number exists', async () => {
    const user = userEvent.setup();
    const order = createOrderFixture('shipped', { shipment: shipmentOf('UPS', '1Z999AA10123456784') });
    render(<MarketplaceTrackingDialog order={order} onChanged={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Edit tracking' }));

    expect(screen.getByLabelText('Tracking number')).toHaveValue('1Z999AA10123456784');
    expect(screen.getByRole('combobox', { name: 'Carrier' })).toHaveTextContent('UPS');
  });

  it('keeps the dialog open and does not send an empty number', async () => {
    const user = userEvent.setup();
    const order = createOrderFixture('shipped', { shipment: shipmentOf('Other', '') });
    render(<MarketplaceTrackingDialog order={order} onChanged={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Add tracking' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter the tracking number.')).toBeInTheDocument();
    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders nothing for the buyer or once the order is delivered', () => {
    const shipped = createOrderFixture('shipped', { shipment: shipmentOf('Other', '') });
    const { rerender, container } = render(<MarketplaceTrackingDialog order={shipped} isBuyer onChanged={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();

    const delivered = createOrderFixture('delivered', {
      shipment: { ...shipmentOf('UPS', 'X-1234'), state: 'delivered', deliveredAt: '2026-08-16T10:00:00.000Z' },
    });
    rerender(<MarketplaceTrackingDialog order={delivered} onChanged={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
