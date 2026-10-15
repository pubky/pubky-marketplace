import { describe, expect, it } from 'vitest';
import { formatCommerceMoney } from './format';

describe('formatCommerceMoney', () => {
  it.each([0, 321, 140_321])('preserves %i bitcoin base units from either wire representation', (amountMinor) => {
    const expected = `₿${amountMinor.toLocaleString('en-US')}`;
    expect(formatCommerceMoney({ amountMinor, currency: 'BTC', exponent: 8 })).toBe(expected);
    expect(formatCommerceMoney({ amountMinor, currency: 'SAT', exponent: 0 })).toBe(expected);
  });

  it('keeps fiat amounts in major units', () => {
    expect(formatCommerceMoney({ amountMinor: 14_321, currency: 'USD', exponent: 2 })).toBe('$143.21');
  });
});
