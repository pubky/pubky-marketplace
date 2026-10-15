import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/atoms/Tooltip/Tooltip';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { BtcRate } from '@/services/exchangerate/exchangerate.types';
import { useMarketplaceDisplayStore } from '@/stores/marketplace-display/marketplace-display.store';
import { MarketplaceIndicativePrice } from './MarketplaceIndicativePrice';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getIndicativeBtcRate: vi.fn(),
  },
}));

const USD_PRICE = { amountMinor: 12_500, currency: 'USD', exponent: 2 };
const BTC_PRICE = { amountMinor: 15_000, currency: 'BTC', exponent: 8 };
const JPY_PRICE = { amountMinor: 15_000, currency: 'JPY', exponent: 0 };
const AT = new Date('2026-10-15T09:40:00Z');
const RATES: BtcRate = {
  satUsd: 0.001,
  btcUsd: 100_000,
  lastUpdatedAt: AT,
  fiatPerBtc: {
    USD: '100000',
    EUR: '90000',
    CHF: '80000',
    GBP: '75000',
    JPY: '15000000',
    CAD: '135000',
    AUD: '150000',
  },
};
const USD_ONLY_RATE: BtcRate = { satUsd: 0.001, btcUsd: 100_000, lastUpdatedAt: AT };

function renderPrice(money: { amountMinor: number; currency: string; exponent: number }) {
  return render(
    <TooltipProvider>
      <MarketplaceIndicativePrice money={money} />
    </TooltipProvider>,
  );
}

describe('MarketplaceIndicativePrice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMarketplaceDisplayStore.setState({ displayCurrency: 'USD', showFxEstimate: true, measurementSystem: null });
  });

  it('shows a bitcoin hint for a USD price when the buyer displays in dollars', async () => {
    vi.mocked(CommerceController.getIndicativeBtcRate).mockResolvedValue(RATES);
    renderPrice(USD_PRICE);

    expect(await screen.findByText('≈ ₿125,000')).toBeInTheDocument();
  });

  it('shows a USD hint for a bitcoin price once the rate arrives', async () => {
    vi.mocked(CommerceController.getIndicativeBtcRate).mockResolvedValue(RATES);
    renderPrice(BTC_PRICE);

    expect(await screen.findByText('≈ $15.00')).toBeInTheDocument();
  });

  it('converts into the buyer display currency', async () => {
    useMarketplaceDisplayStore.setState({ displayCurrency: 'EUR' });
    vi.mocked(CommerceController.getIndicativeBtcRate).mockResolvedValue(RATES);
    renderPrice(USD_PRICE);

    expect(await screen.findByText('≈ €112.50')).toBeInTheDocument();
  });

  it('converts into the currency the browser language suggests until the buyer chooses', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['de-CH']);
    useMarketplaceDisplayStore.setState({ displayCurrency: null });
    vi.mocked(CommerceController.getIndicativeBtcRate).mockResolvedValue(RATES);
    renderPrice(USD_PRICE);

    expect(await screen.findByText('≈ CHF 100.00')).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('converts a zero-exponent price such as yen', async () => {
    vi.mocked(CommerceController.getIndicativeBtcRate).mockResolvedValue(RATES);
    renderPrice(JPY_PRICE);

    expect(await screen.findByText('≈ $100.00')).toBeInTheDocument();
  });

  it('converts a rate read for USD alone between dollars and bitcoin', async () => {
    vi.mocked(CommerceController.getIndicativeBtcRate).mockResolvedValue(USD_ONLY_RATE);
    renderPrice(USD_PRICE);

    expect(await screen.findByText('≈ ₿125,000')).toBeInTheDocument();
  });

  it('renders nothing for a euro hint when the rate was read for USD alone', async () => {
    useMarketplaceDisplayStore.setState({ displayCurrency: 'EUR' });
    vi.mocked(CommerceController.getIndicativeBtcRate).mockResolvedValue(USD_ONLY_RATE);
    const { container } = renderPrice(USD_PRICE);

    await waitFor(() => expect(CommerceController.getIndicativeBtcRate).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the snapshot has no rate for the display currency', async () => {
    useMarketplaceDisplayStore.setState({ displayCurrency: 'EUR' });
    vi.mocked(CommerceController.getIndicativeBtcRate).mockResolvedValue({
      ...USD_ONLY_RATE,
      fiatPerBtc: { USD: '100000' },
    });
    const { container } = renderPrice(USD_PRICE);

    await waitFor(() => expect(CommerceController.getIndicativeBtcRate).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the rate fetch fails — no estimate, no error state', async () => {
    vi.mocked(CommerceController.getIndicativeBtcRate).mockRejectedValue(new Error('rate unavailable'));
    const { container } = renderPrice(USD_PRICE);

    await waitFor(() => expect(CommerceController.getIndicativeBtcRate).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing and never fetches while the estimate toggle is off', async () => {
    useMarketplaceDisplayStore.setState({ showFxEstimate: false });
    vi.mocked(CommerceController.getIndicativeBtcRate).mockResolvedValue(RATES);
    const { container } = renderPrice(USD_PRICE);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(CommerceController.getIndicativeBtcRate).not.toHaveBeenCalled();
  });

  it('renders nothing and never fetches for an asset with no rate source', async () => {
    vi.mocked(CommerceController.getIndicativeBtcRate).mockResolvedValue(RATES);
    const { container } = renderPrice({ amountMinor: 12_500, currency: 'SEK', exponent: 2 });

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(CommerceController.getIndicativeBtcRate).not.toHaveBeenCalled();
  });

  it('drops the approximation marker when asked', async () => {
    vi.mocked(CommerceController.getIndicativeBtcRate).mockResolvedValue(RATES);
    render(
      <TooltipProvider>
        <MarketplaceIndicativePrice money={USD_PRICE} showApproximation={false} />
      </TooltipProvider>,
    );

    expect(await screen.findByText('₿125,000')).toBeInTheDocument();
  });
});
