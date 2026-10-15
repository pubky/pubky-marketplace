import { describe, expect, it } from 'vitest';
import { amountInputText, minorToMajorString, parseAmountInput, parseMajorAmountToMinor } from './money.parse';

describe('parseMajorAmountToMinor', () => {
  it.each([
    ['125', 2, 12_500],
    ['125.00', 2, 12_500],
    ['125.5', 2, 12_550],
    ['0.10', 2, 10],
    ['0.01', 2, 1],
    ['0', 2, 0],
    ['1500', 0, 1_500],
    ['  19.99  ', 2, 1_999],
    ['007.50', 2, 750],
    ['0.1', 2, 10],
  ])('parses %j at exponent %i to %i', (input, exponent, expected) => {
    expect(parseMajorAmountToMinor(input, exponent)).toBe(expected);
  });

  it('is exact where binary floating point is not', () => {
    expect(parseMajorAmountToMinor('1.15', 2)).toBe(115);
    expect(parseMajorAmountToMinor('0.29', 2)).toBe(29);
    expect(parseMajorAmountToMinor('4.35', 2)).toBe(435);
    expect(parseMajorAmountToMinor('8.2', 2)).toBe(820);
  });

  it.each([
    ['125.001', 2],
    ['0.001', 2],
    ['1500.5', 0],
    ['1500.', 0],
    ['.5', 2],
    ['12.', 2],
    ['-5', 2],
    ['+5', 2],
    ['1e3', 2],
    ['1,000', 2],
    ['1 000', 2],
    ['', 2],
    ['  ', 2],
    ['abc', 2],
    ['12.3.4', 2],
    ['0x10', 2],
    ['१२', 2],
  ])('rejects %j at exponent %i instead of rounding or guessing', (input, exponent) => {
    expect(parseMajorAmountToMinor(input, exponent)).toBeNull();
  });

  it('rejects amounts beyond the safe integer range', () => {
    expect(parseMajorAmountToMinor('90071992547409.91', 2)).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseMajorAmountToMinor('90071992547409.92', 2)).toBeNull();
    expect(parseMajorAmountToMinor('9'.repeat(40), 0)).toBeNull();
  });
});

describe('minorToMajorString', () => {
  it.each([
    [12_500, 2, '125.00'],
    [1, 2, '0.01'],
    [10, 2, '0.10'],
    [0, 2, '0.00'],
    [1_999, 2, '19.99'],
    [1_500, 0, '1500'],
    [0, 0, '0'],
    [123_456_789, 2, '1234567.89'],
  ])('renders %i at exponent %i as %j', (amountMinor, exponent, expected) => {
    expect(minorToMajorString(amountMinor, exponent)).toBe(expected);
  });

  it('returns an empty string for amounts that are not non-negative safe integers', () => {
    expect(minorToMajorString(-1, 2)).toBe('');
    expect(minorToMajorString(1.5, 2)).toBe('');
    expect(minorToMajorString(Number.NaN, 2)).toBe('');
    expect(minorToMajorString(Number.MAX_SAFE_INTEGER + 2, 2)).toBe('');
  });

  it('round-trips every exponent used by the listing currencies', () => {
    for (const exponent of [0, 2]) {
      for (const amountMinor of [0, 1, 9, 10, 99, 100, 101, 12_345, 99_999_999]) {
        expect(parseMajorAmountToMinor(minorToMajorString(amountMinor, exponent), exponent)).toBe(amountMinor);
      }
    }
  });
});

describe('parseAmountInput', () => {
  it('parses fiat in major units at the asset exponent', () => {
    expect(parseAmountInput('125.00', { currency: 'USD', exponent: 2 })).toEqual({
      amountMinor: 12_500,
      currency: 'USD',
      exponent: 2,
    });
    expect(parseAmountInput('1500', { currency: 'JPY', exponent: 0 })).toEqual({
      amountMinor: 1_500,
      currency: 'JPY',
      exponent: 0,
    });
    expect(parseAmountInput('19.99', { currency: 'EUR', exponent: 2 })).toEqual({
      amountMinor: 1_999,
      currency: 'EUR',
      exponent: 2,
    });
  });

  it('rejects a fraction the currency cannot hold', () => {
    expect(parseAmountInput('1500.50', { currency: 'JPY', exponent: 0 })).toBeNull();
    expect(parseAmountInput('1.005', { currency: 'CHF', exponent: 2 })).toBeNull();
  });

  it('treats a bitcoin input as base units, with no scaling', () => {
    expect(parseAmountInput('15000', { currency: 'BTC', exponent: 8 })).toEqual({
      amountMinor: 15_000,
      currency: 'BTC',
      exponent: 8,
    });
    expect(parseAmountInput('15000', { currency: 'SAT', exponent: 0 })).toEqual({
      amountMinor: 15_000,
      currency: 'SAT',
      exponent: 0,
    });
  });

  it('rejects fractional or oversize bitcoin input', () => {
    expect(parseAmountInput('150.5', { currency: 'BTC', exponent: 8 })).toBeNull();
    expect(parseAmountInput('0.00015', { currency: 'BTC', exponent: 8 })).toBeNull();
    expect(parseAmountInput('2100000000000000', { currency: 'BTC', exponent: 8 })).not.toBeNull();
    expect(parseAmountInput('2100000000000001', { currency: 'BTC', exponent: 8 })).toBeNull();
  });

  it('reads an asset outside the registry as major units at its own exponent', () => {
    expect(parseAmountInput('1.5', { currency: 'USDT', exponent: 6 })).toEqual({
      amountMinor: 1_500_000,
      currency: 'USDT',
      exponent: 6,
    });
  });
});

describe('amountInputText', () => {
  it('shows fiat in major units and bitcoin as base units', () => {
    expect(amountInputText({ amountMinor: 12_500, currency: 'USD', exponent: 2 })).toBe('125.00');
    expect(amountInputText({ amountMinor: 1_500, currency: 'JPY', exponent: 0 })).toBe('1500');
    expect(amountInputText({ amountMinor: 15_000, currency: 'BTC', exponent: 8 })).toBe('15000');
    expect(amountInputText({ amountMinor: 15_000, currency: 'SAT', exponent: 0 })).toBe('15000');
  });
});
