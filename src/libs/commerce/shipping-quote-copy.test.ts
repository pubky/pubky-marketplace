import { describe, expect, it } from 'vitest';
import { groupQuoteRefusalCopy, orderQuoteRefusalCopy } from './shipping-quote-copy';
import type { ShippingQuoteErrorCode } from './shipping-zones';

const CODES: ShippingQuoteErrorCode[] = [
  'INVALID_DESTINATION',
  'INVALID_QUANTITY',
  'SHIPPING_UNAVAILABLE_TO_COUNTRY',
  'UNKNOWN_SHIPPING_RATE',
  'SHIPPING_OVERFLOW',
];

describe('quote refusal copy', () => {
  it('names a country refusal as a country refusal and nothing else', () => {
    expect(groupQuoteRefusalCopy('SHIPPING_UNAVAILABLE_TO_COUNTRY')).toMatch(/does not ship to your country/);
    for (const code of CODES.filter((entry) => entry !== 'SHIPPING_UNAVAILABLE_TO_COUNTRY')) {
      expect(groupQuoteRefusalCopy(code)).not.toMatch(/does not ship to your country/);
      expect(orderQuoteRefusalCopy(code)).not.toMatch(/does not ship to that country/);
    }
  });

  it('gives every code its own message', () => {
    expect(new Set(CODES.map(groupQuoteRefusalCopy)).size).toBe(CODES.length);
    expect(orderQuoteRefusalCopy('SHIPPING_UNAVAILABLE_TO_COUNTRY')).toMatch(/does not ship to that country/);
  });
});
