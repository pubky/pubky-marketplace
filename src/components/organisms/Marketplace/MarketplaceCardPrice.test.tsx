import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/atoms/Tooltip/Tooltip';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { BtcRate } from '@/services/exchangerate/exchangerate.types';
import { useMarketplaceDisplayStore } from '@/stores/marketplace-display/marketplace-display.store';
import { MarketplaceCardPrice } from './MarketplaceCardPrice';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getIndicativeBtcRate: vi.fn(),
  },
}));

const USD_PRICE = { amountMinor: 12_500, currency: 'USD', exponent: 2 };
const EUR_PRICE = { amountMinor: 11_250, currency: 'EUR', exponent: 2 };
const RATES: BtcRate = {
  satUsd: 0.001,
  btcUsd: 100_000,
  lastUpdatedAt: new Date('2026-10-15T09:40:00Z'),
  fiatPerBtc: { USD: '100000', EUR: '90000', CHF: '80000' },
};

function renderPrice(money: { amountMinor: number; currency: string; exponent: number }) {
  return render(
    <TooltipProvider>
      <MarketplaceCardPrice money={money} />
    </TooltipProvider>,
  );
}

describe('MarketplaceCardPrice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMarketplaceDisplayStore.setState({ displayCurrency: 'USD', showFxEstimate: true });
  });

  it('shows the price in the listing currency with a bitcoin hint when the display currency matches', async () => {
    vi.mocked(CommerceController.getIndicativeBtcRate).mockResolvedValue(RATES);

    renderPrice(USD_PRICE);

    expect(screen.getByText('$125.00', { exact: false })).toBeInTheDocument();
    expect(await screen.findByText('≈ ₿125,000')).toBeInTheDocument();
  });

  it('keeps the listing currency as the price and adds the hint in the display currency', async () => {
    useMarketplaceDisplayStore.setState({ displayCurrency: 'CHF' });
    vi.mocked(CommerceController.getIndicativeBtcRate).mockResolvedValue(RATES);

    const { container } = renderPrice(EUR_PRICE);

    expect(await screen.findByText('≈ CHF 100.00')).toBeInTheDocument();
    expect(container).toHaveTextContent('€112.50');
  });

  it('shows only the listing price when the rate is unavailable', async () => {
    vi.mocked(CommerceController.getIndicativeBtcRate).mockRejectedValue(new Error('rate unavailable'));

    const { container } = renderPrice(EUR_PRICE);

    expect(container).toHaveTextContent('€112.50');
    await vi.waitFor(() => expect(CommerceController.getIndicativeBtcRate).toHaveBeenCalled());
    expect(container).not.toHaveTextContent('≈');
  });

  it('shows only the listing price and never fetches while the hint toggle is off', () => {
    useMarketplaceDisplayStore.setState({ showFxEstimate: false });

    const { container } = renderPrice(EUR_PRICE);

    expect(container).toHaveTextContent('€112.50');
    expect(CommerceController.getIndicativeBtcRate).not.toHaveBeenCalled();
  });
});
