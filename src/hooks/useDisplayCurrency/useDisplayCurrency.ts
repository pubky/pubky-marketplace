'use client';

import { useSyncExternalStore } from 'react';
import type { ListingCurrencyCode } from '@/config/currencies';
import { DEFAULT_DISPLAY_CURRENCY, displayCurrencyForLocales } from '@/pipes/money/money.locale';
import { useMarketplaceDisplayStore } from '@/stores/marketplace-display/marketplace-display.store';

function subscribeToLanguageChange(onChange: () => void): () => void {
  window.addEventListener('languagechange', onChange);
  return () => window.removeEventListener('languagechange', onChange);
}

function browserCurrency(): ListingCurrencyCode {
  return displayCurrencyForLocales(navigator.languages);
}

/**
 * The buyer's display currency for the converted price hint: their explicit
 * choice when they made one, otherwise the currency their browser languages
 * suggest. The server and the hydration pass render USD (the store's server
 * snapshot is its initial state, so a persisted choice is not read yet); the
 * client then switches to the stored choice or the browser's currency in the
 * first re-render after hydration, so a USD shell can show for one frame.
 */
export function useDisplayCurrency(): ListingCurrencyCode {
  const chosen = useMarketplaceDisplayStore((state) => state.displayCurrency);
  const fromBrowser = useSyncExternalStore(subscribeToLanguageChange, browserCurrency, () => DEFAULT_DISPLAY_CURRENCY);
  return chosen ?? fromBrowser;
}
