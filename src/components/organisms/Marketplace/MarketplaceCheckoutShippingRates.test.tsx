import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShippingGroupView } from '@/hooks/useMarketplaceShippingGroups/useMarketplaceShippingGroups';
import { installTranslatorDomGuard, uninstallTranslatorDomGuard } from '@/libs/dom/translator-dom-guard';
import { translateTextNodes } from '@/test-utils/page-translator';
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

  it('locks the rate pick while a checkout is being sent', () => {
    const ready = view({
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
      ],
    });
    const { rerender } = render(<MarketplaceCheckoutShippingRates groups={[ready]} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeEnabled();
    rerender(<MarketplaceCheckoutShippingRates groups={[ready]} onChange={vi.fn()} disabled />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it.each([
    ['loading', 'Loading shipping prices.'],
    ['unreadable', 'This seller’s shipping prices could not be read.'],
    ['asset-mismatch', 'priced in a different currency than the item'],
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

  describe('under a page translator', () => {
    afterEach(() => uninstallTranslatorDomGuard());

    it('replaces the translated destination prompt once prices start loading', () => {
      installTranslatorDomGuard();
      const { rerender } = render(
        <MarketplaceCheckoutShippingRates groups={[view({ status: 'needs-destination' })]} onChange={vi.fn()} />,
      );
      translateTextNodes(screen.getByRole('status'));

      rerender(<MarketplaceCheckoutShippingRates groups={[view({ status: 'loading' })]} onChange={vi.fn()} />);

      expect(screen.getByRole('status')).toHaveTextContent('Loading shipping prices.');
      expect(screen.getByRole('status')).not.toHaveTextContent('Enter your delivery country');
    });
  });
});
