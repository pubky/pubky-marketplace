import { describe, expect, it } from 'vitest';
import { formatBitcoinBaseUnits, formatMoney } from './money.format';

describe('formatMoney', () => {
  it.each([
    [{ amountMinor: 12_500, currency: 'USD', exponent: 2 }, '$125.00'],
    [{ amountMinor: 1_250, currency: 'EUR', exponent: 2 }, '€12.50'],
    [{ amountMinor: 1_250, currency: 'CHF', exponent: 2 }, 'CHF\u00a012.50'],
    [{ amountMinor: 1_250, currency: 'GBP', exponent: 2 }, '£12.50'],
    [{ amountMinor: 1_500, currency: 'JPY', exponent: 0 }, '¥1,500'],
    [{ amountMinor: 999, currency: 'CAD', exponent: 2 }, 'CA$9.99'],
    [{ amountMinor: 999, currency: 'AUD', exponent: 2 }, 'A$9.99'],
    [{ amountMinor: 15_000, currency: 'BTC', exponent: 8 }, '₿15,000'],
    [{ amountMinor: 15_000, currency: 'SAT', exponent: 0 }, '₿15,000'],
  ])('renders %j as %s', (money, expected) => {
    expect(formatMoney(money)).toBe(expected);
  });

  it('tells the dollar currencies apart', () => {
    const usd = formatMoney({ amountMinor: 1_000, currency: 'USD', exponent: 2 });
    const cad = formatMoney({ amountMinor: 1_000, currency: 'CAD', exponent: 2 });
    const aud = formatMoney({ amountMinor: 1_000, currency: 'AUD', exponent: 2 });
    expect(new Set([usd, cad, aud]).size).toBe(3);
  });

  it('shows exactly the currency exponent in fraction digits', () => {
    expect(formatMoney({ amountMinor: 0, currency: 'USD', exponent: 2 })).toBe('$0.00');
    expect(formatMoney({ amountMinor: 0, currency: 'JPY', exponent: 0 })).toBe('¥0');
    expect(formatMoney({ amountMinor: 5, currency: 'EUR', exponent: 2 })).toBe('€0.05');
  });

  it('groups large amounts', () => {
    expect(formatMoney({ amountMinor: 123_456_789, currency: 'USD', exponent: 2 })).toBe('$1,234,567.89');
    expect(formatMoney({ amountMinor: 2_100_000_000_000_000, currency: 'BTC', exponent: 8 })).toBe(
      '₿2,100,000,000,000,000',
    );
  });

  it('states a bitcoin price in its own minor unit, never as a fraction of a coin', () => {
    expect(formatMoney({ amountMinor: 1, currency: 'BTC', exponent: 8 })).toBe('₿1');
  });

  it('falls back to a deterministic asset-code form outside the registry', () => {
    expect(formatMoney({ amountMinor: 1_234_500, currency: 'USDT', exponent: 6 })).toBe('1.234500 USDT');
    expect(formatMoney({ amountMinor: 1_000, currency: 'XYZ', exponent: 2 })).toMatch(/10\.00/);
  });

  it('renders a foreign ISO currency through Intl at its stored exponent', () => {
    expect(formatMoney({ amountMinor: 1_250, currency: 'SEK', exponent: 2 })).toContain('12.50');
  });
});

describe('formatBitcoinBaseUnits', () => {
  it('prefixes the bitcoin symbol and groups integer base units', () => {
    expect(formatBitcoinBaseUnits(0)).toBe('₿0');
    expect(formatBitcoinBaseUnits(999)).toBe('₿999');
    expect(formatBitcoinBaseUnits(1_000)).toBe('₿1,000');
    expect(formatBitcoinBaseUnits(125_000)).toBe('₿125,000');
  });

  it('rounds a fractional base-unit estimate to a whole unit', () => {
    expect(formatBitcoinBaseUnits(1_000.4)).toBe('₿1,000');
    expect(formatBitcoinBaseUnits(1_000.5)).toBe('₿1,001');
  });
});
