import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createOrderFixture } from '@/test/fixtures/commerce/orders';
import { MarketplaceReturnStatus } from './MarketplaceReturnStatus';

describe('MarketplaceReturnStatus', () => {
  it('shows the buyer the status, next step, amount and Cancel return while the seller has not acted', async () => {
    const order = createOrderFixture('return_requested');
    const actOnOrder = vi.fn(async () => true);
    render(<MarketplaceReturnStatus order={order} isBuyer actOnOrder={actOnOrder} />);

    expect(screen.getByTestId('order-return-chip')).toHaveTextContent('Return requested');
    expect(screen.getByTestId('order-return-next')).toHaveTextContent(
      'Waiting for the seller to approve your return. You can cancel it until they do.',
    );
    expect(screen.getByTestId('order-return-status')).toHaveTextContent('$137.00');
    expect(screen.getByTestId('order-return-status')).toHaveTextContent('Item does not match the described condition');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel return' }));
    expect(await screen.findByRole('dialog', { name: 'Cancel this return?' })).toHaveTextContent(
      'You may not be able to request another one after the return window closes.',
    );
    expect(actOnOrder).not.toHaveBeenCalled();

    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel return' }));
    expect(actOnOrder).toHaveBeenCalledWith(order, 'return.cancel', {});
  });

  it('sends nothing when the buyer keeps the return', async () => {
    const actOnOrder = vi.fn(async () => true);
    render(<MarketplaceReturnStatus order={createOrderFixture('return_requested')} isBuyer actOnOrder={actOnOrder} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel return' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Keep return' }));

    expect(actOnOrder).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers no Cancel return once the seller approved', () => {
    render(
      <MarketplaceReturnStatus
        order={createOrderFixture('return_approved')}
        isBuyer
        actOnOrder={vi.fn(async () => true)}
      />,
    );

    expect(screen.getByTestId('order-return-chip')).toHaveTextContent('Return approved');
    expect(screen.queryByRole('button', { name: 'Cancel return' })).not.toBeInTheDocument();
  });

  it('tells the seller what to do and offers them no Cancel return', () => {
    render(
      <MarketplaceReturnStatus
        order={createOrderFixture('return_requested')}
        isBuyer={false}
        actOnOrder={vi.fn(async () => true)}
      />,
    );

    expect(screen.getByTestId('order-return-next')).toHaveTextContent(
      'Approve the return so the buyer can send the item back.',
    );
    expect(screen.queryByRole('button', { name: 'Cancel return' })).not.toBeInTheDocument();
  });

  it('renders nothing without a return', () => {
    const { container } = render(
      <MarketplaceReturnStatus order={createOrderFixture('delivered')} isBuyer actOnOrder={vi.fn(async () => true)} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
