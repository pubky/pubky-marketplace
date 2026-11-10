import { describe, expect, it } from 'vitest';
import { marketplaceOfferSchema } from './useMarketplaceOffer.types';

describe('marketplaceOfferSchema message', () => {
  const base = { amount: '10', quantity: '1' };

  it('counts code points, like the service: 500 emoji pass and 501 are refused', () => {
    expect(marketplaceOfferSchema.safeParse({ ...base, message: '\u{1F600}'.repeat(500) }).success).toBe(true);
    const refused = marketplaceOfferSchema.safeParse({ ...base, message: '\u{1F600}'.repeat(501) });
    expect(refused.success ? '' : refused.error.issues[0].message).toBe('Message must be 500 characters or fewer.');
  });

  it('trims before counting', () => {
    expect(marketplaceOfferSchema.safeParse({ ...base, message: `  ${'a'.repeat(500)}  ` }).success).toBe(true);
  });
});
