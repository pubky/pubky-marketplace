import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DELIVERY_KEY_COPY } from '@/libs/commerce/delivery-key-copy';
import { DeliveryKeyBlockedNotice } from './DeliveryKeyBlockedNotice';

const SELLER = 's'.repeat(52);

describe('DeliveryKeyBlockedNotice', () => {
  it('renders nothing when checkout is not blocked', () => {
    const { container } = render(<DeliveryKeyBlockedNotice block={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('tells the buyer the seller has not finished delivery setup, as an alert that stays on screen', () => {
    render(
      <DeliveryKeyBlockedNotice block={{ kind: 'no_key', sellerPubky: SELLER, message: DELIVERY_KEY_COPY.noKey }} />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-surface', 'delivery-key-blocked');
    expect(alert).toHaveTextContent(DELIVERY_KEY_COPY.blockedTitle);
    expect(alert).toHaveTextContent("This seller hasn't finished setting up delivery yet");
    expect(alert).toHaveTextContent('Nothing was reserved');
    expect(screen.getByTestId('delivery-key-blocked-seller')).toHaveTextContent(/^Seller s+\.\.\.s+$/);
  });

  it('omits the seller line when no seller was reached', () => {
    render(
      <DeliveryKeyBlockedNotice
        block={{ kind: 'unreachable', sellerPubky: null, message: DELIVERY_KEY_COPY.unreachable }}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(DELIVERY_KEY_COPY.unreachable);
    expect(screen.queryByTestId('delivery-key-blocked-seller')).not.toBeInTheDocument();
  });
});
