import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createOrderFixture } from '@/test/fixtures/commerce/orders';
import { MarketplaceCheckoutItem } from './MarketplaceCheckoutItem';

vi.mock('@/hooks/useMarketplaceOrderItemMedia/useMarketplaceOrderItemMedia', () => ({
  useMarketplaceOrderItemMedia: () => null,
}));

const line = createOrderFixture('pending_payment').lines[0];

describe('MarketplaceCheckoutItem', () => {
  it('links the item to its listing by default', () => {
    render(<MarketplaceCheckoutItem line={line} />);

    expect(screen.getByRole('link', { name: line.title })).toHaveAttribute(
      'href',
      expect.stringContaining('/marketplace/'),
    );
    expect(screen.queryByText('View listing')).toBeNull();
  });

  it('opens the order once it exists and keeps a small link to the listing (#363)', () => {
    render(<MarketplaceCheckoutItem line={line} orderHref="/marketplace/orders?order=o-1&view=order" />);

    expect(screen.getByRole('link', { name: line.title })).toHaveAttribute(
      'href',
      '/marketplace/orders?order=o-1&view=order',
    );
    expect(screen.getByText('View listing').closest('a')).not.toHaveAttribute(
      'href',
      '/marketplace/orders?order=o-1&view=order',
    );
    expect(screen.getByRole('link', { name: 'View order', hidden: true })).toHaveAttribute(
      'href',
      '/marketplace/orders?order=o-1&view=order',
    );
  });
});
