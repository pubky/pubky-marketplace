import { describe, expect, it } from 'vitest';
import {
  BASE_UNITS_PER_BITCOIN,
  BITCOIN_CURRENCY_CODE,
  CURRENCY_FORMAT_LOCALE,
  isListingCurrencyCode,
  isListingFiatCurrencyCode,
  LISTING_CURRENCY_CODES,
  LISTING_CURRENCY_REGISTRY,
  LISTING_FIAT_CURRENCY_CODES,
  MAX_BITCOIN_BASE_UNITS,
  resolveListingCurrency,
} from './currencies';

describe('listing currency registry', () => {
  it('offers the seven fiat currencies plus bitcoin, in picker order', () => {
    expect(LISTING_FIAT_CURRENCY_CODES).toEqual(['USD', 'EUR', 'CHF', 'GBP', 'JPY', 'CAD', 'AUD']);
    expect(LISTING_CURRENCY_CODES).toEqual(['USD', 'EUR', 'CHF', 'GBP', 'JPY', 'CAD', 'AUD', 'BTC']);
  });

  it('has one entry per code whose key matches its code', () => {
    expect(Object.keys(LISTING_CURRENCY_REGISTRY).sort()).toEqual([...LISTING_CURRENCY_CODES].sort());
    for (const code of LISTING_CURRENCY_CODES) {
      expect(LISTING_CURRENCY_REGISTRY[code].code).toBe(code);
    }
  });

  it.each([
    ['USD', 2],
    ['EUR', 2],
    ['CHF', 2],
    ['GBP', 2],
    ['JPY', 0],
    ['CAD', 2],
    ['AUD', 2],
    ['BTC', 8],
  ] as const)('uses the ISO exponent for %s (%i)', (code, exponent) => {
    expect(LISTING_CURRENCY_REGISTRY[code].exponent).toBe(exponent);
  });

  it('keeps the existing picker labels for dollars and bitcoin', () => {
    expect(LISTING_CURRENCY_REGISTRY.USD.pickerLabel).toBe('US dollars (USD)');
    expect(LISTING_CURRENCY_REGISTRY.BTC.pickerLabel).toBe('Bitcoin (₿)');
  });

  it('enters fiat in major units and bitcoin as whole base units', () => {
    for (const code of LISTING_FIAT_CURRENCY_CODES) {
      expect(LISTING_CURRENCY_REGISTRY[code].entryUnit).toBe('major');
      expect(LISTING_CURRENCY_REGISTRY[code].kind).toBe('fiat');
    }
    expect(LISTING_CURRENCY_REGISTRY.BTC.entryUnit).toBe('minor');
    expect(LISTING_CURRENCY_REGISTRY.BTC.kind).toBe('bitcoin');
    expect(LISTING_CURRENCY_REGISTRY.BTC.symbol).toBe('₿');
  });

  it('names a Blocktank BTC<CCY> ticker for every fiat currency and none for bitcoin', () => {
    for (const code of LISTING_FIAT_CURRENCY_CODES) {
      expect(LISTING_CURRENCY_REGISTRY[code].rateTicker).toBe(`BTC${code}`);
    }
    expect(LISTING_CURRENCY_REGISTRY.BTC.rateTicker).toBeNull();
  });

  it('keeps the bitcoin constants consistent', () => {
    expect(BITCOIN_CURRENCY_CODE).toBe('BTC');
    expect(BASE_UNITS_PER_BITCOIN).toBe(100_000_000);
    expect(MAX_BITCOIN_BASE_UNITS).toBe(2_100_000_000_000_000);
    expect(CURRENCY_FORMAT_LOCALE).toBe('en-US');
  });
});

describe('isListingCurrencyCode', () => {
  it('accepts exactly the registry codes', () => {
    for (const code of LISTING_CURRENCY_CODES) expect(isListingCurrencyCode(code)).toBe(true);
  });

  it.each(['SATS', 'SAT', 'usd', 'SEK', 'USDT', '', 'toString', '__proto__', 'constructor'])('rejects %s', (value) => {
    expect(isListingCurrencyCode(value)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isListingCurrencyCode(undefined)).toBe(false);
    expect(isListingCurrencyCode(null)).toBe(false);
    expect(isListingCurrencyCode(840)).toBe(false);
  });

  it('separates fiat from bitcoin', () => {
    expect(isListingFiatCurrencyCode('EUR')).toBe(true);
    expect(isListingFiatCurrencyCode('BTC')).toBe(false);
    expect(isListingFiatCurrencyCode('SEK')).toBe(false);
  });
});

describe('resolveListingCurrency', () => {
  it('resolves a stored asset with its registry exponent', () => {
    expect(resolveListingCurrency({ currency: 'JPY', exponent: 0 })?.code).toBe('JPY');
    expect(resolveListingCurrency({ currency: 'CHF', exponent: 2 })?.code).toBe('CHF');
    expect(resolveListingCurrency({ currency: 'BTC', exponent: 8 })?.code).toBe('BTC');
  });

  it('reads satoshis as bitcoin', () => {
    expect(resolveListingCurrency({ currency: 'SAT', exponent: 0 })?.code).toBe('BTC');
  });

  it('refuses a registry code at the wrong exponent and any other asset', () => {
    expect(resolveListingCurrency({ currency: 'JPY', exponent: 2 })).toBeNull();
    expect(resolveListingCurrency({ currency: 'EUR', exponent: 3 })).toBeNull();
    expect(resolveListingCurrency({ currency: 'BTC', exponent: 2 })).toBeNull();
    expect(resolveListingCurrency({ currency: 'SAT', exponent: 8 })).toBeNull();
    expect(resolveListingCurrency({ currency: 'SEK', exponent: 2 })).toBeNull();
    expect(resolveListingCurrency({ currency: 'USDT', exponent: 6 })).toBeNull();
  });
});
