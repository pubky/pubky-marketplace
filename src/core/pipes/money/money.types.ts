import type { ListingFiatCurrencyCode } from '@/config/currencies';

/** The shape of every stored price: integer minor units of one currency. */
export interface Money {
  amountMinor: number;
  currency: string;
  exponent: number;
}

/**
 * One consistent set of bitcoin prices in the listing fiat currencies, read
 * from a single Blocktank snapshot. A conversion between any two currencies
 * (fiat to fiat included) uses two entries of the same snapshot, so it never
 * mixes rates from different moments.
 */
export interface FxRateSnapshot {
  /** The price of one bitcoin in each currency, as the decimal strings the feed quotes. */
  fiatPerBtc: Readonly<Partial<Record<ListingFiatCurrencyCode, string>>>;
}

/** The ticker fields the rate snapshot reads; the feed carries more. */
export interface FxRateTicker {
  symbol: string;
  lastPrice: string;
}
