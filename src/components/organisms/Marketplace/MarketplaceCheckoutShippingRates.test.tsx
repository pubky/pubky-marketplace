import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ShippingGroupView } from '@/hooks/useMarketplaceShippingGroups/useMarketplaceShippingGroups';
import { MarketplaceCheckoutShippingRates } from './MarketplaceCheckoutShippingRates';

const base = { key: 'profile:s:worldwide', sellerPubky: 's'.repeat(52), label: 'Worldwide', units: 2 };
const asset = { currency: 'USD', exponent: 2 };

function view(state: ShippingGroupView['state']): ShippingGroupView {
  return { ...base, asset, state };
}

describe('MarketplaceCheckoutShippingRates', () => {
  it('renders nothing without a zone-priced group', () => {
    const { container } = render(<MarketplaceCheckoutShippingRates groups={[]} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the selected rate with its price and delivery estimate', () => {
    render(
      <MarketplaceCheckoutShippingRates
        groups={[
          view({
            status: 'ready',
            selectedRateId: 'std',
            amount: { amountMinor: 1349, ...asset },
            quotes: [
              {
                zoneId: 'eu',
                rateId: 'std',
                label: 'Standard',
                amountMinor: 1349,
                estimatedMinDays: 6,
                estimatedMaxDays: 12,
              },
              {
                zoneId: 'eu',
                rateId: 'exp',
                label: 'Express',
                amountMinor: 2500,
                estimatedMinDays: 2,
                estimatedMaxDays: 2,
              },
            ],
          }),
        ]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Shipping for Worldwide')).toBeInTheDocument();
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('Standard');
    expect(trigger).toHaveTextContent('$13.49');
    expect(trigger).toHaveTextContent('6-12 days');
  });

  it.each([
    ['loading', 'Loading shipping prices.'],
    ['unreadable', 'This seller’s shipping prices could not be read.'],
    ['needs-destination', 'Enter your delivery country to see shipping prices.'],
  ] as const)('explains the %s state instead of offering rates', (status, copy) => {
    render(<MarketplaceCheckoutShippingRates groups={[view({ status })]} onChange={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(copy);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('says the seller does not ship to a refused country', () => {
    render(
      <MarketplaceCheckoutShippingRates
        groups={[view({ status: 'refused', code: 'SHIPPING_UNAVAILABLE_TO_COUNTRY' })]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('does not ship to your country');
  });
});
