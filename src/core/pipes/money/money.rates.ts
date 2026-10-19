import {
  LISTING_CURRENCY_REGISTRY,
  LISTING_FIAT_CURRENCY_CODES,
  type ListingFiatCurrencyCode,
} from '@/config/currencies';
import type { FxRateSnapshot, FxRateTicker } from './money.types';

const QUOTED_PRICE = /^\d+(?:\.\d+)?$/;

/**
 * Reads the listing currencies out of Blocktank's `BTC<CCY>` tickers. Tickers
 * match the registry's symbol exactly (`BTCUSD` is not `BTCUSDT`). A currency
 * whose ticker is absent, non-numeric or not positive is left out of the
 * snapshot, so a hint in it is simply not shown: no fallback rate is invented.
 */
export function buildFxRateSnapshot(tickers: readonly FxRateTicker[]): FxRateSnapshot {
  const priceBySymbol = new Map(tickers.map((ticker) => [ticker.symbol, ticker.lastPrice]));
  const fiatPerBtc: Partial<Record<ListingFiatCurrencyCode, string>> = {};
  for (const code of LISTING_FIAT_CURRENCY_CODES) {
    const symbol = LISTING_CURRENCY_REGISTRY[code].rateTicker;
    const price = symbol === null ? undefined : priceBySymbol.get(symbol)?.trim();
    if (price !== undefined && QUOTED_PRICE.test(price) && Number(price) > 0) fiatPerBtc[code] = price;
  }
  return { fiatPerBtc };
}

/**
 * The snapshot a hint converts with, from a bitcoin rate read by the app. A
 * rate that carries `fiatPerBtc` brings every listing currency; a rate read
 * for USD alone brings just the dollar price, so only conversions between
 * dollars and bitcoin are possible from it.
 */
export function fxRateSnapshotFromBtcRate(rate: {
  btcUsd: number;
  fiatPerBtc?: FxRateSnapshot['fiatPerBtc'];
}): FxRateSnapshot {
  if (rate.fiatPerBtc) return { fiatPerBtc: rate.fiatPerBtc };
  return buildFxRateSnapshot([{ symbol: 'BTCUSD', lastPrice: String(rate.btcUsd) }]);
}
