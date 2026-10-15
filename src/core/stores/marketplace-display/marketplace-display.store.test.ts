import { beforeEach, describe, expect, it } from 'vitest';
import { MARKETPLACE_DISPLAY_PERSIST_KEY } from '../persistedKeys';
import { useMarketplaceDisplayStore } from './marketplace-display.store';
import { marketplaceDisplayInitialState } from './marketplace-display.types';

async function rehydrateFrom(stored: unknown) {
  localStorage.setItem(MARKETPLACE_DISPLAY_PERSIST_KEY, JSON.stringify({ state: stored, version: 0 }));
  await useMarketplaceDisplayStore.persist.rehydrate();
}

describe('useMarketplaceDisplayStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useMarketplaceDisplayStore.setState(marketplaceDisplayInitialState);
  });

  it('defaults the display currency to US dollars', () => {
    expect(useMarketplaceDisplayStore.getState().displayCurrency).toBe('USD');
  });

  it.each(['USD', 'EUR', 'CHF', 'GBP', 'JPY', 'CAD', 'AUD', 'BTC'] as const)(
    'accepts %s as a display currency',
    (code) => {
      useMarketplaceDisplayStore.getState().setDisplayCurrency(code);

      expect(useMarketplaceDisplayStore.getState().displayCurrency).toBe(code);
    },
  );

  it('restores a stored listing currency', async () => {
    await rehydrateFrom({ displayCurrency: 'CHF', showFxEstimate: false, measurementSystem: 'metric' });

    expect(useMarketplaceDisplayStore.getState()).toMatchObject({
      displayCurrency: 'CHF',
      showFxEstimate: false,
      measurementSystem: 'metric',
    });
  });

  it('keeps a bitcoin or dollar choice stored before more currencies were offered', async () => {
    await rehydrateFrom({ displayCurrency: 'BTC' });

    expect(useMarketplaceDisplayStore.getState().displayCurrency).toBe('BTC');
  });

  it.each(['SEK', 'SATS', 'usd', 42, null])('falls back to the default for the stored value %j', async (stored) => {
    await rehydrateFrom({ displayCurrency: stored, showFxEstimate: false });

    const state = useMarketplaceDisplayStore.getState();
    expect(state.displayCurrency).toBe('USD');
    expect(state.showFxEstimate).toBe(false);
  });

  it('keeps the defaults when nothing usable is stored', async () => {
    await rehydrateFrom(undefined);

    expect(useMarketplaceDisplayStore.getState().displayCurrency).toBe('USD');
    expect(useMarketplaceDisplayStore.getState().showFxEstimate).toBe(true);
  });
});
