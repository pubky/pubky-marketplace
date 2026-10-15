import { describe, expect, it } from 'vitest';
import {
  AMOUNT_EXAMPLES,
  amountInputExample,
  amountInputFromMoney,
  amountInputSchemaForAsset,
  amountInputToMoney,
  amountInputUnitLabel,
  assetForListingCurrency,
  BTC_ASSET,
  hasSameAsset,
  isBitcoinAsset,
  listingCurrencyChoiceForAsset,
  sumMoneyByAsset,
  USD_ASSET,
} from './pricing';

describe('asset identification', () => {
  it('recognizes base-unit-denominated bitcoin and nothing else', () => {
    expect(isBitcoinAsset({ currency: 'BTC', exponent: 8 })).toBe(true);
    expect(isBitcoinAsset({ currency: 'BTC', exponent: 2 })).toBe(false);
    expect(isBitcoinAsset({ currency: 'USD', exponent: 8 })).toBe(false);
  });

  it('labels the input unit per asset', () => {
    expect(amountInputUnitLabel(USD_ASSET)).toBe('USD');
    expect(amountInputUnitLabel(BTC_ASSET)).toBe('₿');
    expect(amountInputUnitLabel({ currency: 'EUR', exponent: 2 })).toBe('EUR');
  });
});

describe('listing currency choice', () => {
  it.each([
    ['USD', 2],
    ['EUR', 2],
    ['CHF', 2],
    ['GBP', 2],
    ['JPY', 0],
    ['CAD', 2],
    ['AUD', 2],
    ['BTC', 8],
  ] as const)('maps %s to its asset at exponent %i and back', (code, exponent) => {
    const asset = assetForListingCurrency(code);
    expect(asset).toEqual({ currency: code, exponent });
    expect(listingCurrencyChoiceForAsset(asset)).toBe(code);
  });

  it('does not map assets the studio cannot author back to a choice', () => {
    expect(listingCurrencyChoiceForAsset({ currency: 'SAT', exponent: 0 })).toBeNull();
    expect(listingCurrencyChoiceForAsset({ currency: 'EUR', exponent: 3 })).toBeNull();
    expect(listingCurrencyChoiceForAsset({ currency: 'SEK', exponent: 2 })).toBeNull();
    expect(listingCurrencyChoiceForAsset({ currency: 'USDT', exponent: 6 })).toBeNull();
  });

  it('compares assets by currency and exponent', () => {
    expect(hasSameAsset(USD_ASSET, assetForListingCurrency('USD'))).toBe(true);
    expect(hasSameAsset(USD_ASSET, assetForListingCurrency('EUR'))).toBe(false);
  });
});

describe('input examples', () => {
  it('shows an example valid in each currency own unit', () => {
    expect(amountInputExample(USD_ASSET, AMOUNT_EXAMPLES.price)).toBe('125.00');
    expect(amountInputExample(assetForListingCurrency('CHF'), AMOUNT_EXAMPLES.price)).toBe('125.00');
    expect(amountInputExample(assetForListingCurrency('JPY'), AMOUNT_EXAMPLES.price)).toBe('12500');
    expect(amountInputExample(BTC_ASSET, AMOUNT_EXAMPLES.price)).toBe('150000');
    expect(amountInputExample(USD_ASSET, AMOUNT_EXAMPLES.shipping)).toBe('12.00');
    expect(amountInputExample(assetForListingCurrency('JPY'), AMOUNT_EXAMPLES.shipping)).toBe('1200');
    expect(amountInputExample(BTC_ASSET, AMOUNT_EXAMPLES.shipping)).toBe('15000');
    expect(amountInputExample(USD_ASSET, AMOUNT_EXAMPLES.offer)).toBe('100.00');
    expect(amountInputExample(BTC_ASSET, AMOUNT_EXAMPLES.offer)).toBe('100000');
    expect(amountInputExample(USD_ASSET, AMOUNT_EXAMPLES.counterOffer)).toBe('110.00');
    expect(amountInputExample(BTC_ASSET, AMOUNT_EXAMPLES.counterOffer)).toBe('110000');
  });

  it.each(['USD', 'EUR', 'CHF', 'GBP', 'JPY', 'CAD', 'AUD', 'BTC'] as const)(
    'gives %s examples that pass its own validation',
    (code) => {
      const asset = assetForListingCurrency(code);
      const schema = amountInputSchemaForAsset(asset);
      for (const example of Object.values(AMOUNT_EXAMPLES)) {
        expect(schema.safeParse(amountInputExample(asset, example)).success).toBe(true);
      }
    },
  );
});

describe('amount input validation', () => {
  it('accepts USD amounts with at most two decimals', () => {
    const schema = amountInputSchemaForAsset(USD_ASSET);
    expect(schema.safeParse('125.00').success).toBe(true);
    expect(schema.safeParse('125').success).toBe(true);
    expect(schema.safeParse('125.001').success).toBe(false);
    expect(schema.safeParse('0').success).toBe(false);
    expect(schema.safeParse('-5').success).toBe(false);
  });

  it('accepts whole yen only', () => {
    const schema = amountInputSchemaForAsset(assetForListingCurrency('JPY'));
    expect(schema.safeParse('1500').success).toBe(true);
    expect(schema.safeParse('1500.5').success).toBe(false);
    expect(schema.safeParse('0').success).toBe(false);
  });

  it('accepts euro, franc, pound, and dollar variants with at most two decimals', () => {
    for (const code of ['EUR', 'CHF', 'GBP', 'CAD', 'AUD'] as const) {
      const schema = amountInputSchemaForAsset(assetForListingCurrency(code));
      expect(schema.safeParse('9.99').success).toBe(true);
      expect(schema.safeParse('9.999').success).toBe(false);
    }
  });

  it('accepts only whole positive base units within the total supply', () => {
    const schema = amountInputSchemaForAsset(BTC_ASSET);
    expect(schema.safeParse('15000').success).toBe(true);
    expect(schema.safeParse('1').success).toBe(true);
    expect(schema.safeParse('0').success).toBe(false);
    expect(schema.safeParse('150.5').success).toBe(false);
    expect(schema.safeParse('2100000000000001').success).toBe(false);
  });
});

describe('amount input to money and back', () => {
  it('converts USD input to cents without conversion drift', () => {
    expect(amountInputToMoney('125.00', USD_ASSET)).toEqual({ amountMinor: 12_500, currency: 'USD', exponent: 2 });
    expect(amountInputToMoney('0.10', USD_ASSET)).toEqual({ amountMinor: 10, currency: 'USD', exponent: 2 });
  });

  it('converts yen input without a fraction and euro input to cents', () => {
    expect(amountInputToMoney('1500', assetForListingCurrency('JPY'))).toEqual({
      amountMinor: 1_500,
      currency: 'JPY',
      exponent: 0,
    });
    expect(amountInputToMoney('19.99', assetForListingCurrency('EUR'))).toEqual({
      amountMinor: 1_999,
      currency: 'EUR',
      exponent: 2,
    });
  });

  it('throws a validation error for text that skipped validation', () => {
    expect(() => amountInputToMoney('1.005', USD_ASSET)).toThrow('Not a valid USD amount');
  });

  it('treats a bitcoin input as the minor unit itself', () => {
    expect(amountInputToMoney('15000', BTC_ASSET)).toEqual({ amountMinor: 15_000, currency: 'BTC', exponent: 8 });
  });

  it('round-trips money back to its input string', () => {
    expect(amountInputFromMoney({ amountMinor: 12_500, currency: 'USD', exponent: 2 })).toBe('125.00');
    expect(amountInputFromMoney({ amountMinor: 15_000, currency: 'BTC', exponent: 8 })).toBe('15000');
    expect(amountInputFromMoney({ amountMinor: 1_500, currency: 'JPY', exponent: 0 })).toBe('1500');
    expect(amountInputFromMoney({ amountMinor: 1_999, currency: 'EUR', exponent: 2 })).toBe('19.99');
  });
});

describe('sumMoneyByAsset', () => {
  it('sums quantities within one asset', () => {
    const totals = sumMoneyByAsset([
      { money: { amountMinor: 1_000, currency: 'USD', exponent: 2 }, quantity: 2 },
      { money: { amountMinor: 500, currency: 'USD', exponent: 2 }, quantity: 1 },
    ]);
    expect(totals).toEqual([{ amountMinor: 2_500, currency: 'USD', exponent: 2 }]);
  });

  it('never adds minor units of different assets together', () => {
    const totals = sumMoneyByAsset([
      { money: { amountMinor: 3_000, currency: 'USD', exponent: 2 }, quantity: 1 },
      { money: { amountMinor: 25_000, currency: 'BTC', exponent: 8 }, quantity: 1 },
    ]);
    expect(totals).toEqual([
      { amountMinor: 3_000, currency: 'USD', exponent: 2 },
      { amountMinor: 25_000, currency: 'BTC', exponent: 8 },
    ]);
  });

  it('returns an empty list for an empty cart', () => {
    expect(sumMoneyByAsset([])).toEqual([]);
  });
});
