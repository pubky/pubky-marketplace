import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { isListingCurrencyCode } from '@/config/currencies';
import { MARKETPLACE_DISPLAY_PERSIST_KEY } from '../persistedKeys';
import {
  MarketplaceDisplayActionTypes,
  marketplaceDisplayInitialState,
  type MarketplaceDisplayStore,
} from './marketplace-display.types';

/**
 * Device-level marketplace display preferences: the display currency for the
 * approximate-conversion hint, its toggle, and the measurement system.
 * Display-only state — nothing transactional reads it — persisted in
 * localStorage like the app's other display settings.
 */
export const useMarketplaceDisplayStore = create<MarketplaceDisplayStore>()(
  devtools(
    persist(
      (set) => ({
        ...marketplaceDisplayInitialState,
        setDisplayCurrency: (displayCurrency) => set({ displayCurrency }),
        setShowFxEstimate: (showFxEstimate) =>
          set({ showFxEstimate }, false, MarketplaceDisplayActionTypes.SET_SHOW_FX_ESTIMATE),
        setMeasurementSystem: (measurementSystem) =>
          set({ measurementSystem }, false, MarketplaceDisplayActionTypes.SET_MEASUREMENT_SYSTEM),
      }),
      {
        name: MARKETPLACE_DISPLAY_PERSIST_KEY,
        version: 1,
        // Version 0 stored 'USD' for everyone, chosen or not, so it carries no
        // choice: it becomes "follow the browser". Any other stored currency
        // was picked by the buyer and stays.
        migrate: (persisted) => {
          const stored = (persisted ?? {}) as Partial<MarketplaceDisplayStore>;
          return {
            displayCurrency: stored.displayCurrency === 'USD' ? null : (stored.displayCurrency ?? null),
            showFxEstimate: stored.showFxEstimate ?? marketplaceDisplayInitialState.showFxEstimate,
            measurementSystem: stored.measurementSystem ?? marketplaceDisplayInitialState.measurementSystem,
          };
        },
        // A stored currency this build no longer lists must not reach the converter.
        merge: (persisted, current) => {
          const stored = (persisted ?? {}) as Partial<MarketplaceDisplayStore>;
          return {
            ...current,
            ...stored,
            displayCurrency: isListingCurrencyCode(stored.displayCurrency)
              ? stored.displayCurrency
              : current.displayCurrency,
          };
        },
        partialize: (state) => ({
          displayCurrency: state.displayCurrency,
          showFxEstimate: state.showFxEstimate,
          measurementSystem: state.measurementSystem,
        }),
      },
    ),
    {
      name: 'marketplace-display-store',
      enabled: process.env.NODE_ENV === 'development',
    },
  ),
);
