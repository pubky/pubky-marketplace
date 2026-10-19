/**
 * Listing currency registry: the single source of truth for which currencies a
 * seller can price a listing in, their ISO 4217 minor-unit exponents, and how
 * each one is entered and displayed. Prices are stored as integer minor units
 * of the listing currency (`{ amountMinor, currency, exponent }`).
 *
 * Bitcoin follows the app's BIP-177 convention: `BTC` at exponent 8 where one
 * minor unit is one satoshi, shown as `₿15,000`. `SAT` at exponent 0 is the
 * same unit under its other name and is read, never authored.
 *
 * Rates for converting between these currencies come from Blocktank's
 * `BTC<CCY>` tickers (see `src/core/pipes/money`).
 */

export const LISTING_FIAT_CURRENCY_CODES = ['USD', 'EUR', 'CHF', 'GBP', 'JPY', 'CAD', 'AUD'] as const;

export const BITCOIN_CURRENCY_CODE = 'BTC';

export const LISTING_CURRENCY_CODES = [...LISTING_FIAT_CURRENCY_CODES, BITCOIN_CURRENCY_CODE] as const;

export type ListingFiatCurrencyCode = (typeof LISTING_FIAT_CURRENCY_CODES)[number];
export type ListingCurrencyCode = (typeof LISTING_CURRENCY_CODES)[number];

export const SATOSHI_CURRENCY_CODE = 'SAT';

export const BITCOIN_EXPONENT = 8;
export const SATOSHI_EXPONENT = 0;

export const BASE_UNITS_PER_BITCOIN = 10 ** BITCOIN_EXPONENT;

/** 21 million bitcoin in base units: the honest upper bound for any ₿ amount. */
export const MAX_BITCOIN_BASE_UNITS = 21_000_000 * BASE_UNITS_PER_BITCOIN;

/** Fiat is entered in major units (dollars and cents); bitcoin is entered as whole base units (₿). */
export type CurrencyEntryUnit = 'major' | 'minor';

export interface CurrencyDefinition {
  code: ListingCurrencyCode;
  kind: 'fiat' | 'bitcoin';
  /** ISO 4217 exponent for fiat; 8 for bitcoin. */
  exponent: number;
  /** Plural name used in short labels, e.g. `US dollars`. */
  name: string;
  /** The option text in the seller's currency picker, e.g. `US dollars (USD)`. */
  pickerLabel: string;
  /** Short symbol; ambiguous across currencies (`$`), so labels pair it with the code where it matters. */
  symbol: string;
  entryUnit: CurrencyEntryUnit;
  /** Blocktank ticker quoting one bitcoin in this currency; bitcoin itself has none. */
  rateTicker: string | null;
}

export const LISTING_CURRENCY_REGISTRY: Readonly<Record<ListingCurrencyCode, CurrencyDefinition>> = {
  USD: {
    code: 'USD',
    kind: 'fiat',
    exponent: 2,
    name: 'US dollars',
    pickerLabel: 'US dollars (USD)',
    symbol: '$',
    entryUnit: 'major',
    rateTicker: 'BTCUSD',
  },
  EUR: {
    code: 'EUR',
    kind: 'fiat',
    exponent: 2,
    name: 'Euros',
    pickerLabel: 'Euros (EUR)',
    symbol: '€',
    entryUnit: 'major',
    rateTicker: 'BTCEUR',
  },
  CHF: {
    code: 'CHF',
    kind: 'fiat',
    exponent: 2,
    name: 'Swiss francs',
    pickerLabel: 'Swiss francs (CHF)',
    symbol: 'CHF',
    entryUnit: 'major',
    rateTicker: 'BTCCHF',
  },
  GBP: {
    code: 'GBP',
    kind: 'fiat',
    exponent: 2,
    name: 'British pounds',
    pickerLabel: 'British pounds (GBP)',
    symbol: '£',
    entryUnit: 'major',
    rateTicker: 'BTCGBP',
  },
  JPY: {
    code: 'JPY',
    kind: 'fiat',
    exponent: 0,
    name: 'Japanese yen',
    pickerLabel: 'Japanese yen (JPY)',
    symbol: '¥',
    entryUnit: 'major',
    rateTicker: 'BTCJPY',
  },
  CAD: {
    code: 'CAD',
    kind: 'fiat',
    exponent: 2,
    name: 'Canadian dollars',
    pickerLabel: 'Canadian dollars (CAD)',
    symbol: 'CA$',
    entryUnit: 'major',
    rateTicker: 'BTCCAD',
  },
  AUD: {
    code: 'AUD',
    kind: 'fiat',
    exponent: 2,
    name: 'Australian dollars',
    pickerLabel: 'Australian dollars (AUD)',
    symbol: 'A$',
    entryUnit: 'major',
    rateTicker: 'BTCAUD',
  },
  BTC: {
    code: 'BTC',
    kind: 'bitcoin',
    exponent: BITCOIN_EXPONENT,
    name: 'Bitcoin',
    pickerLabel: 'Bitcoin (₿)',
    symbol: '₿',
    entryUnit: 'minor',
    rateTicker: null,
  },
};

/** The locale every currency is formatted in: the app copy is US English. */
export const CURRENCY_FORMAT_LOCALE = 'en-US';

export function isListingCurrencyCode(value: unknown): value is ListingCurrencyCode {
  return typeof value === 'string' && Object.hasOwn(LISTING_CURRENCY_REGISTRY, value);
}

export function isListingFiatCurrencyCode(value: unknown): value is ListingFiatCurrencyCode {
  return isListingCurrencyCode(value) && LISTING_CURRENCY_REGISTRY[value].kind === 'fiat';
}

/** The registry entry for a stored asset (`SAT` at exponent 0 resolves to bitcoin), or `null` for any other asset. */
export function resolveListingCurrency(asset: { currency: string; exponent: number }): CurrencyDefinition | null {
  if (asset.currency === SATOSHI_CURRENCY_CODE && asset.exponent === SATOSHI_EXPONENT) {
    return LISTING_CURRENCY_REGISTRY[BITCOIN_CURRENCY_CODE];
  }
  if (!isListingCurrencyCode(asset.currency)) return null;
  const definition = LISTING_CURRENCY_REGISTRY[asset.currency];
  return definition.exponent === asset.exponent ? definition : null;
}
