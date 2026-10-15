import { describe, expect, it } from 'vitest';
import {
  currencyExponent,
  DEFAULT_IMPORT_SETTINGS,
  majorToMinor,
  rescaleMinor,
  shippingOptionRow,
  shopifyWorkExponent,
} from './import-settings';

describe('currencyExponent', () => {
  it.each([
    ['USD', 2],
    ['EUR', 2],
    ['CHF', 2],
    ['GBP', 2],
    ['CAD', 2],
    ['AUD', 2],
    ['JPY', 0],
    ['BTC', 8],
  ])('%s has exponent %i', (currency, exponent) => {
    expect(currencyExponent(currency)).toBe(exponent);
  });
});

describe('majorToMinor', () => {
  it('converts exactly with the currency exponent', () => {
    expect(majorToMinor('125.00', 2)).toBe(12_500);
    expect(majorToMinor('9.5', 2)).toBe(950);
    expect(majorToMinor('0.05', 2)).toBe(5);
    expect(majorToMinor('19', 2)).toBe(1_900);
    expect(majorToMinor('1500', 0)).toBe(1_500);
    expect(majorToMinor('0.00015000', 8)).toBe(15_000);
  });

  it('never rounds: extra non-zero decimals are not representable', () => {
    expect(majorToMinor('12.345', 2)).toBeNull();
    expect(majorToMinor('1500.50', 0)).toBeNull();
    expect(majorToMinor('1500.00', 0)).toBe(1_500);
  });

  it('rejects text that is not a plain decimal', () => {
    expect(majorToMinor('', 2)).toBeNull();
    expect(majorToMinor('-5', 2)).toBeNull();
    expect(majorToMinor('$5', 2)).toBeNull();
    expect(majorToMinor('1,5', 2)).toBeNull();
    expect(majorToMinor('9007199254740993', 0)).toBeNull();
  });
});

describe('rescaleMinor', () => {
  it('moves between exponents only when no digit is lost', () => {
    expect(rescaleMinor(12_500, 2, 0)).toBe(125);
    expect(rescaleMinor(12_550, 2, 0)).toBeNull();
    expect(rescaleMinor(125, 2, 2)).toBe(125);
    expect(rescaleMinor(125, 2, 8)).toBe(125_000_000);
  });

  it('runs the Shopify SDK at an exponent that keeps JPY prices representable', () => {
    expect(shopifyWorkExponent('JPY')).toBe(2);
    expect(shopifyWorkExponent('USD')).toBe(2);
    expect(shopifyWorkExponent('BTC')).toBe(8);
  });
});

describe('shippingOptionRow', () => {
  it('builds a free option and a flat option in the listing currency', () => {
    expect(shippingOptionRow(DEFAULT_IMPORT_SETTINGS)).toEqual({
      id: 'standard',
      pricing: 'free',
      label: 'Free shipping',
      estimatedMinDays: 3,
      estimatedMaxDays: 10,
    });
    expect(
      shippingOptionRow({
        ...DEFAULT_IMPORT_SETTINGS,
        currency: 'JPY',
        shipping: { mode: 'flat', priceMinor: 800, minDays: 2, maxDays: 5 },
      }),
    ).toEqual({
      id: 'standard',
      pricing: 'flat',
      label: 'Standard shipping',
      price: { amountMinor: 800, currency: 'JPY', exponent: 0 },
      estimatedMinDays: 2,
      estimatedMaxDays: 5,
    });
  });
});
