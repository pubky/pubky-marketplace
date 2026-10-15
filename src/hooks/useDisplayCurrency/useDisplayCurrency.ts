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
 * suggest. The server and the hydration pass render USD, so markup matches;
 * the client then switches to the browser's currency in a normal re-render.
 */
export function useDisplayCurrency(): ListingCurrencyCode {
  const chosen = useMarketplaceDisplayStore((state) => state.displayCurrency);
  const fromBrowser = useSyncExternalStore(subscribeToLanguageChange, browserCurrency, () => DEFAULT_DISPLAY_CURRENCY);
  return chosen ?? fromBrowser;
}
