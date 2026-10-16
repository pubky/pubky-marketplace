import { describe, expect, it } from 'vitest';
import { LISTING_CURRENCY_CODES, type ListingCurrencyCode } from '@/config/currencies';
import { convertMoney, hintTargetCurrency, indicativeHintLabel } from './money.convert';
import type { FxRateSnapshot, Money } from './money.types';

const SNAPSHOT: FxRateSnapshot = {
  fiatPerBtc: {
    USD: '100000',
    EUR: '90000',
    CHF: '80000',
    GBP: '75000',
    JPY: '15000000',
    CAD: '135000',
    AUD: '150000',
  },
};

const usd = (amountMinor: number): Money => ({ amountMinor, currency: 'USD', exponent: 2 });
const eur = (amountMinor: number): Money => ({ amountMinor, currency: 'EUR', exponent: 2 });
const jpy = (amountMinor: number): Money => ({ amountMinor, currency: 'JPY', exponent: 0 });
const btc = (amountMinor: number): Money => ({ amountMinor, currency: 'BTC', exponent: 8 });

describe('convertMoney', () => {
  it.each([
    ['USD to bitcoin', usd(12_500), 'BTC', btc(125_000)],
    ['bitcoin to USD', btc(15_000), 'USD', usd(1_500)],
    ['USD to EUR', usd(12_500), 'EUR', eur(11_250)],
    [
      'EUR to CHF (cross rate, rounded half up)',
      eur(10_000),
      'CHF',
      { amountMinor: 8_889, currency: 'CHF', exponent: 2 },
    ],
    ['JPY to USD', jpy(15_000), 'USD', usd(10_000)],
    ['USD to JPY (zero-exponent target)', usd(10_000), 'JPY', jpy(15_000)],
    ['GBP to bitcoin', { amountMinor: 7_500, currency: 'GBP', exponent: 2 }, 'BTC', btc(100_000)],
    [
      'CAD to AUD',
      { amountMinor: 13_500, currency: 'CAD', exponent: 2 },
      'AUD',
      { amountMinor: 15_000, currency: 'AUD', exponent: 2 },
    ],
    ['bitcoin to JPY', btc(100_000), 'JPY', jpy(15_000)],
  ] as Array<[string, Money, ListingCurrencyCode, Money]>)('converts %s', (_label, from, target, expected) => {
    expect(convertMoney(from, target, SNAPSHOT)).toEqual(expected);
  });

  it('reads satoshi-denominated money as bitcoin', () => {
    expect(convertMoney({ amountMinor: 125_000, currency: 'SAT', exponent: 0 }, 'USD', SNAPSHOT)).toEqual(usd(12_500));
    expect(convertMoney({ amountMinor: 125_000, currency: 'SAT', exponent: 0 }, 'BTC', SNAPSHOT)).toEqual(btc(125_000));
  });

  it('returns the same amount in the same currency', () => {
    for (const code of LISTING_CURRENCY_CODES) {
      const exponent = code === 'JPY' ? 0 : code === 'BTC' ? 8 : 2;
      const money = { amountMinor: 12_345, currency: code, exponent };
      expect(convertMoney(money, code, { fiatPerBtc: {} })).toEqual(money);
    }
  });

  it('converts every ordered pair of listing currencies and returns close to the start on the way back', () => {
    const exponents: Record<ListingCurrencyCode, number> = {
      USD: 2,
      EUR: 2,
      CHF: 2,
      GBP: 2,
      JPY: 0,
      CAD: 2,
      AUD: 2,
      BTC: 8,
    };
    for (const from of LISTING_CURRENCY_CODES) {
      for (const to of LISTING_CURRENCY_CODES) {
        const money = { amountMinor: 10_000_000, currency: from, exponent: exponents[from] };
        const converted = convertMoney(money, to, SNAPSHOT);
        expect(converted, `${from} to ${to}`).not.toBeNull();
        expect(converted?.currency).toBe(to);
        expect(converted?.exponent).toBe(exponents[to]);
        const back = convertMoney(converted as Money, from, SNAPSHOT);
        expect(back?.amountMinor, `${from} to ${to} and back`).toBeGreaterThan(money.amountMinor * 0.999999);
        expect(back?.amountMinor, `${from} to ${to} and back`).toBeLessThan(money.amountMinor * 1.000001);
      }
    }
  });

  describe('rounding', () => {
    it('rounds exact halves up', () => {
      // 1 cent = 1e-7 BTC = 1.5 yen; 3 cents = 4.5 yen.
      expect(convertMoney(usd(1), 'JPY', SNAPSHOT)).toEqual(jpy(2));
      expect(convertMoney(usd(3), 'JPY', SNAPSHOT)).toEqual(jpy(5));
    });

    it('rounds below a half down and above a half up', () => {
      const lowYen: FxRateSnapshot = { fiatPerBtc: { ...SNAPSHOT.fiatPerBtc, JPY: '14000000' } };
      expect(convertMoney(usd(1), 'JPY', lowYen)).toEqual(jpy(1)); // 1.4
      const highYen: FxRateSnapshot = { fiatPerBtc: { ...SNAPSHOT.fiatPerBtc, JPY: '16000000' } };
      expect(convertMoney(usd(1), 'JPY', highYen)).toEqual(jpy(2)); // 1.6
    });

    it('returns zero for an amount below the target minor unit', () => {
      // One satoshi is a tenth of a cent at 100,000 per bitcoin.
      expect(convertMoney(btc(1), 'USD', SNAPSHOT)).toEqual(usd(0));
      expect(convertMoney(btc(4), 'USD', SNAPSHOT)).toEqual(usd(0));
      expect(convertMoney(btc(5), 'USD', SNAPSHOT)).toEqual(usd(1));
    });

    it('converts zero to zero', () => {
      expect(convertMoney(usd(0), 'EUR', SNAPSHOT)).toEqual(eur(0));
    });
  });

  describe('exactness', () => {
    it('keeps a decimal quote exact', () => {
      const snapshot: FxRateSnapshot = { fiatPerBtc: { USD: '81248.5' } };
      expect(convertMoney(btc(100_000_000), 'USD', snapshot)).toEqual(usd(8_124_850));
      expect(convertMoney(usd(8_124_850), 'BTC', snapshot)).toEqual(btc(100_000_000));
    });

    it('does not lose precision on amounts above 2^31 minor units', () => {
      const snapshot: FxRateSnapshot = { fiatPerBtc: { USD: '100000' } };
      expect(convertMoney(usd(1_000_000_000_000), 'BTC', snapshot)).toEqual(btc(10_000_000_000_000));
    });
  });

  describe('refusals', () => {
    it('returns null when a needed rate is missing, even if the other side is present', () => {
      const onlyUsd: FxRateSnapshot = { fiatPerBtc: { USD: '100000' } };
      expect(convertMoney(usd(100), 'EUR', onlyUsd)).toBeNull();
      expect(convertMoney(eur(100), 'USD', onlyUsd)).toBeNull();
      expect(convertMoney(eur(100), 'BTC', onlyUsd)).toBeNull();
      expect(convertMoney(btc(100), 'EUR', onlyUsd)).toBeNull();
    });

    it('converts bitcoin to a fiat currency from that one rate alone', () => {
      const onlyUsd: FxRateSnapshot = { fiatPerBtc: { USD: '100000' } };
      expect(convertMoney(btc(100_000), 'USD', onlyUsd)).toEqual(usd(10_000));
    });

    it.each(['0', '-1', 'abc', '', '1e5', '0.0'])('returns null for the unusable rate %j', (rate) => {
      const snapshot: FxRateSnapshot = { fiatPerBtc: { USD: rate } };
      expect(convertMoney(btc(100_000), 'USD', snapshot)).toBeNull();
    });

    it('returns null for a source outside the listing currencies', () => {
      expect(convertMoney({ amountMinor: 100, currency: 'SEK', exponent: 2 }, 'USD', SNAPSHOT)).toBeNull();
      expect(convertMoney({ amountMinor: 100, currency: 'USDT', exponent: 6 }, 'USD', SNAPSHOT)).toBeNull();
      expect(convertMoney({ amountMinor: 100, currency: 'EUR', exponent: 3 }, 'USD', SNAPSHOT)).toBeNull();
    });

    it('returns null for an amount that is not a non-negative safe integer', () => {
      expect(convertMoney(usd(-1), 'EUR', SNAPSHOT)).toBeNull();
      expect(convertMoney(usd(1.5), 'EUR', SNAPSHOT)).toBeNull();
      expect(convertMoney(usd(Number.NaN), 'EUR', SNAPSHOT)).toBeNull();
      expect(convertMoney(usd(Number.MAX_SAFE_INTEGER + 2), 'EUR', SNAPSHOT)).toBeNull();
    });

    it('returns null rather than a wrong number when the result overflows', () => {
      const absurd: FxRateSnapshot = { fiatPerBtc: { JPY: '1000000000000000' } };
      expect(convertMoney(btc(Number.MAX_SAFE_INTEGER), 'JPY', absurd)).toBeNull();
    });
  });
});

describe('hintTargetCurrency', () => {
  it('uses the display currency when it differs from the price currency', () => {
    expect(hintTargetCurrency('EUR', 'USD')).toBe('USD');
    expect(hintTargetCurrency('USD', 'CHF')).toBe('CHF');
    expect(hintTargetCurrency('BTC', 'JPY')).toBe('JPY');
    expect(hintTargetCurrency('JPY', 'BTC')).toBe('BTC');
  });

  it('shows the other side of the fiat and bitcoin pair when the price is already in the display currency', () => {
    expect(hintTargetCurrency('USD', 'USD')).toBe('BTC');
    expect(hintTargetCurrency('EUR', 'EUR')).toBe('BTC');
    expect(hintTargetCurrency('JPY', 'JPY')).toBe('BTC');
    expect(hintTargetCurrency('BTC', 'BTC')).toBe('USD');
  });
});

describe('indicativeHintLabel', () => {
  it('labels the converted amount as approximate, in the display currency', () => {
    expect(indicativeHintLabel(usd(12_500), 'EUR', SNAPSHOT)).toBe('≈ €112.50');
    expect(indicativeHintLabel(btc(15_000), 'EUR', SNAPSHOT)).toBe('≈ €13.50');
    expect(indicativeHintLabel(eur(10_000), 'JPY', SNAPSHOT)).toBe('≈ ¥16,667');
    expect(indicativeHintLabel(jpy(15_000), 'CAD', SNAPSHOT)).toBe('≈ CA$135.00');
  });

  it('shows bitcoin under a fiat price, and dollars under a bitcoin price, when display matches the price', () => {
    expect(indicativeHintLabel(usd(12_500), 'USD', SNAPSHOT)).toBe('≈ ₿125,000');
    expect(indicativeHintLabel(btc(15_000), 'BTC', SNAPSHOT)).toBe('≈ $15.00');
  });

  it('returns null when the estimate is zero in the hint currency', () => {
    expect(indicativeHintLabel(btc(1), 'USD', SNAPSHOT)).toBeNull();
  });

  it('returns null for a free (zero) price', () => {
    expect(indicativeHintLabel(usd(0), 'EUR', SNAPSHOT)).toBeNull();
  });

  it('returns null for an asset with no rate source', () => {
    expect(indicativeHintLabel({ amountMinor: 100, currency: 'SEK', exponent: 2 }, 'USD', SNAPSHOT)).toBeNull();
  });

  it('returns null when the snapshot lacks a needed rate: no rate, no hint', () => {
    expect(indicativeHintLabel(usd(12_500), 'EUR', { fiatPerBtc: {} })).toBeNull();
    expect(indicativeHintLabel(usd(12_500), 'USD', { fiatPerBtc: {} })).toBeNull();
  });

  it('reads satoshi-denominated prices as bitcoin', () => {
    expect(indicativeHintLabel({ amountMinor: 125_000, currency: 'SAT', exponent: 0 }, 'USD', SNAPSHOT)).toBe(
      '≈ $125.00',
    );
  });
});
