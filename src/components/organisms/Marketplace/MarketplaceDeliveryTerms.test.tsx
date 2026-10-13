import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarketplaceDeliveryTerms } from './MarketplaceDeliveryTerms';

const entry = (sellerPubky: string, shopName: string | null, deliveryAssumeDays: number, autoCompleteDays: number) => ({
  sellerPubky,
  shopName,
  terms: { deliveryAssumeDays, autoCompleteDays },
});

describe('MarketplaceDeliveryTerms', () => {
  it('renders nothing without sellers', () => {
    const { container } = render(<MarketplaceDeliveryTerms entries={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('states the periods once when every seller agrees', () => {
    render(
      <MarketplaceDeliveryTerms
        entries={[entry('a'.repeat(52), 'Shop A', 7, 21), entry('b'.repeat(52), null, 7, 21)]}
      />,
    );

    expect(screen.getByTestId('marketplace-delivery-terms')).toHaveTextContent(
      'Delivery is assumed after 7 days (counted from payment for items the seller emails or sends in messages); the order completes 21 days after delivery unless you open a return.',
    );
  });

  it('names each seller when the periods differ', () => {
    render(
      <MarketplaceDeliveryTerms
        entries={[entry('a'.repeat(52), 'Shop A', 3, 5), entry('b'.repeat(52), null, 14, 14)]}
      />,
    );

    const terms = within(screen.getByTestId('marketplace-delivery-terms'));
    expect(
      terms.getByText(
        /^Shop A: Delivery is assumed after 3 days \(counted from payment for items the seller emails or sends in messages\); the order completes 5 days after delivery/,
      ),
    ).toBeInTheDocument();
    expect(
      terms.getByText(
        /^bbbbbbbbbb…: Delivery is assumed after 14 days \(counted from payment for items the seller emails or sends in messages\); the order completes 14 days after delivery/,
      ),
    ).toBeInTheDocument();
  });
});
