import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarketplacePaymentMethodBadges } from './MarketplacePaymentMethodBadges';

describe('MarketplacePaymentMethodBadges', () => {
  it('renders nothing for an empty set', () => {
    const { container } = render(<MarketplacePaymentMethodBadges methods={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists every method as a labelled badge, in the given order', () => {
    render(<MarketplacePaymentMethodBadges methods={['bitcoin', 'usdt', 'paypal']} testId="payment-badges" />);

    const list = screen.getByRole('list', { name: 'Accepted payment methods' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['Bitcoin', 'USDT', 'PayPal']);
    for (const item of items) {
      expect(item.firstElementChild).toHaveAttribute('data-slot', 'badge');
      expect(item.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
    expect(screen.getByTestId('payment-badges')).toBeInTheDocument();
  });

  it('renders only the methods it is given', () => {
    render(<MarketplacePaymentMethodBadges methods={['paypal']} />);

    const items = within(screen.getByRole('list', { name: 'Accepted payment methods' })).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('PayPal');
    expect(items[0].querySelector('[data-payment-method="paypal"]')).not.toBeNull();
  });
});
