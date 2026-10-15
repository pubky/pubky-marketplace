import { beforeEach, describe, expect, it } from 'vitest';
import { MARKETPLACE_DISPLAY_PERSIST_KEY } from '../persistedKeys';
import { useMarketplaceDisplayStore } from './marketplace-display.store';
import { marketplaceDisplayInitialState } from './marketplace-display.types';

async function rehydrateFrom(stored: unknown, version = 1) {
  localStorage.setItem(MARKETPLACE_DISPLAY_PERSIST_KEY, JSON.stringify({ state: stored, version }));
  await useMarketplaceDisplayStore.persist.rehydrate();
}

describe('useMarketplaceDisplayStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useMarketplaceDisplayStore.setState(marketplaceDisplayInitialState);
  });

  it('starts without a chosen display currency, so the browser decides', () => {
    expect(useMarketplaceDisplayStore.getState().displayCurrency).toBeNull();
  });

  it.each(['USD', 'EUR', 'CHF', 'GBP', 'JPY', 'CAD', 'AUD', 'BTC'] as const)(
    'accepts %s as a display currency',
    (code) => {
      useMarketplaceDisplayStore.getState().setDisplayCurrency(code);

      expect(useMarketplaceDisplayStore.getState().displayCurrency).toBe(code);
    },
  );

  it('persists an explicit US dollar choice as a choice', async () => {
    useMarketplaceDisplayStore.getState().setDisplayCurrency('USD');
    const stored = JSON.parse(localStorage.getItem(MARKETPLACE_DISPLAY_PERSIST_KEY) ?? '{}');
    expect(stored.state.displayCurrency).toBe('USD');
    expect(stored.version).toBe(1);

    const persisted = localStorage.getItem(MARKETPLACE_DISPLAY_PERSIST_KEY) ?? '';
    useMarketplaceDisplayStore.setState(marketplaceDisplayInitialState);
    localStorage.setItem(MARKETPLACE_DISPLAY_PERSIST_KEY, persisted);
    await useMarketplaceDisplayStore.persist.rehydrate();

    expect(useMarketplaceDisplayStore.getState().displayCurrency).toBe('USD');
  });

  it('restores a stored listing currency', async () => {
    await rehydrateFrom({ displayCurrency: 'CHF', showFxEstimate: false, measurementSystem: 'metric' });

    expect(useMarketplaceDisplayStore.getState()).toMatchObject({
      displayCurrency: 'CHF',
      showFxEstimate: false,
      measurementSystem: 'metric',
    });
  });

  it('keeps a bitcoin choice stored before the browser default existed', async () => {
    await rehydrateFrom({ displayCurrency: 'BTC', showFxEstimate: true, measurementSystem: null }, 0);

    expect(useMarketplaceDisplayStore.getState().displayCurrency).toBe('BTC');
  });

  it('reads the old default USD as no choice, because version 0 stored it for everyone', async () => {
    await rehydrateFrom({ displayCurrency: 'USD', showFxEstimate: false, measurementSystem: 'imperial' }, 0);

    expect(useMarketplaceDisplayStore.getState()).toMatchObject({
      displayCurrency: null,
      showFxEstimate: false,
      measurementSystem: 'imperial',
    });
  });

  it.each(['SEK', 'SATS', 'usd', 42, null])('treats the stored value %j as no choice', async (stored) => {
    await rehydrateFrom({ displayCurrency: stored, showFxEstimate: false });

    const state = useMarketplaceDisplayStore.getState();
    expect(state.displayCurrency).toBeNull();
    expect(state.showFxEstimate).toBe(false);
  });

  it('keeps the defaults when nothing usable is stored', async () => {
    await rehydrateFrom(undefined);

    expect(useMarketplaceDisplayStore.getState().displayCurrency).toBeNull();
    expect(useMarketplaceDisplayStore.getState().showFxEstimate).toBe(true);
  });
});
