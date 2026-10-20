import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PAYMENT_WINDOW_ELAPSED_REASON } from '@/libs/commerce/checkout-hold';
import { createOrderFixture, createPaymentFixture } from '@/test/fixtures/commerce/orders';
import { MarketplacePaymentStatusBadge } from './MarketplacePaymentStatusBadge';

describe('MarketplacePaymentStatusBadge', () => {
  it('names a buyer-cancelled checkout as cancelled, not an expired window (#359)', () => {
    const order = createOrderFixture('cancelled', { cancellationReason: 'Changed my mind' });
    render(<MarketplacePaymentStatusBadge order={order} payment={createPaymentFixture('expired')} />);

    expect(screen.getByText('Order cancelled')).toBeInTheDocument();
    expect(screen.queryByText('Payment window expired')).not.toBeInTheDocument();
  });

  it('keeps the expired window for an order that lapsed at Pay by', () => {
    const order = createOrderFixture('cancelled', { cancellationReason: PAYMENT_WINDOW_ELAPSED_REASON });
    render(<MarketplacePaymentStatusBadge order={order} payment={createPaymentFixture('expired')} />);

    expect(screen.getByText('Payment window expired')).toBeInTheDocument();
  });
});
