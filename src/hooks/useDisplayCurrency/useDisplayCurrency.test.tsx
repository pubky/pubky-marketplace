import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMarketplaceDisplayStore } from '@/stores/marketplace-display/marketplace-display.store';
import { marketplaceDisplayInitialState } from '@/stores/marketplace-display/marketplace-display.types';
import { MARKETPLACE_DISPLAY_PERSIST_KEY } from '@/stores/persistedKeys';
import { useDisplayCurrency } from './useDisplayCurrency';

function stubLanguages(languages: string[]) {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages);
}

function Probe() {
  return <span data-testid="currency">{useDisplayCurrency()}</span>;
}

describe('useDisplayCurrency', () => {
  beforeEach(() => {
    useMarketplaceDisplayStore.setState(marketplaceDisplayInitialState);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [['de-CH', 'de', 'en'], 'CHF'],
    [['de-DE', 'de', 'en-US'], 'EUR'],
    [['en-GB'], 'GBP'],
    [['ja'], 'JPY'],
    [['en-CA', 'fr-CA'], 'CAD'],
    [['en-AU'], 'AUD'],
    [['en-US'], 'USD'],
    [['pt-BR'], 'USD'],
    [[], 'USD'],
  ])('follows the browser languages %j with %s while the buyer has not chosen', (languages, expected) => {
    stubLanguages(languages);

    const { result } = renderHook(() => useDisplayCurrency());

    expect(result.current).toBe(expected);
  });

  it('lets an explicit choice win over the browser, including a choice of US dollars', () => {
    stubLanguages(['de-CH']);
    useMarketplaceDisplayStore.getState().setDisplayCurrency('USD');

    const { result } = renderHook(() => useDisplayCurrency());

    expect(result.current).toBe('USD');
  });

  it('keeps an explicit bitcoin choice whatever the browser says', () => {
    stubLanguages(['ja']);
    useMarketplaceDisplayStore.getState().setDisplayCurrency('BTC');

    const { result } = renderHook(() => useDisplayCurrency());

    expect(result.current).toBe('BTC');
  });

  it('follows a change of browser language', () => {
    stubLanguages(['en-US']);
    const { result } = renderHook(() => useDisplayCurrency());
    expect(result.current).toBe('USD');

    stubLanguages(['de-CH']);
    act(() => {
      window.dispatchEvent(new Event('languagechange'));
    });

    expect(result.current).toBe('CHF');
  });

  it('updates when the buyer picks a currency', () => {
    stubLanguages(['de-CH']);
    const { result } = renderHook(() => useDisplayCurrency());
    expect(result.current).toBe('CHF');

    act(() => useMarketplaceDisplayStore.getState().setDisplayCurrency('GBP'));

    expect(result.current).toBe('GBP');
  });

  it('renders US dollars on the server and during hydration, then the browser currency, with no mismatch', async () => {
    stubLanguages(['de-CH']);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const serverHtml = renderToString(<Probe />);
    expect(serverHtml).toContain('USD');

    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    document.body.appendChild(container);
    await act(async () => {
      hydrateRoot(container, <Probe />);
    });

    expect(container.textContent).toBe('CHF');
    expect(errors).not.toHaveBeenCalled();
    container.remove();
  });

  it('hydrates a persisted explicit choice against the US dollar shell without a mismatch', async () => {
    stubLanguages(['de-CH']);
    localStorage.setItem(
      MARKETPLACE_DISPLAY_PERSIST_KEY,
      JSON.stringify({ state: { displayCurrency: 'GBP', showFxEstimate: true, measurementSystem: null }, version: 1 }),
    );
    await useMarketplaceDisplayStore.persist.rehydrate();
    expect(useMarketplaceDisplayStore.getState().displayCurrency).toBe('GBP');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const serverHtml = renderToString(<Probe />);
    expect(serverHtml).toContain('USD');

    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    document.body.appendChild(container);
    await act(async () => {
      hydrateRoot(container, <Probe />);
    });

    expect(container.textContent).toBe('GBP');
    expect(errors).not.toHaveBeenCalled();
    container.remove();
    localStorage.clear();
  });

  it('renders inside a component tree', () => {
    stubLanguages(['en-AU']);
    render(<Probe />);

    expect(screen.getByTestId('currency')).toHaveTextContent('AUD');
  });
});
