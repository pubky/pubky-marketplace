import { describe, expect, it } from 'vitest';
import {
  filterBySellerSet,
  paymentFilterUnavailableCopy,
  paymentMethodSellersPageSchema,
} from '@/libs/commerce/payment-method-filter';
import { toCamelCaseWire } from '@/libs/commerce/wire-casing';

const SELLER_A = 'a'.repeat(52);
const SELLER_B = 'b'.repeat(52);

describe('paymentMethodSellersPageSchema', () => {
  it('reads the service page, cursor included', () => {
    expect(
      paymentMethodSellersPageSchema.parse(
        toCamelCaseWire({ method: 'paypal', sellers: [SELLER_A, SELLER_B], next_after: SELLER_B }),
      ),
    ).toEqual({ method: 'paypal', sellers: [SELLER_A, SELLER_B], nextAfter: SELLER_B });
    expect(paymentMethodSellersPageSchema.parse({ method: 'usdt', sellers: [], nextAfter: null }).nextAfter).toBeNull();
  });

  it('refuses anything that is not a seller key or a known method', () => {
    expect(paymentMethodSellersPageSchema.safeParse({ method: 'stripe', sellers: [], nextAfter: null }).success).toBe(
      false,
    );
    expect(
      paymentMethodSellersPageSchema.safeParse({ method: 'paypal', sellers: ['not-a-key'], nextAfter: null }).success,
    ).toBe(false);
    expect(
      paymentMethodSellersPageSchema.safeParse({ method: 'paypal', sellers: [], nextAfter: 'not-a-key' }).success,
    ).toBe(false);
  });
});

describe('filterBySellerSet', () => {
  it('keeps only items from sellers in the set, in their order', () => {
    const items = [
      { id: 1, seller: SELLER_B },
      { id: 2, seller: SELLER_A },
      { id: 3, seller: SELLER_B },
    ];
    expect(filterBySellerSet(items, new Set([SELLER_B]), (item) => item.seller).map(({ id }) => id)).toEqual([1, 3]);
    expect(filterBySellerSet(items, new Set(), (item) => item.seller)).toEqual([]);
  });
});

describe('paymentFilterUnavailableCopy', () => {
  it('names the rail', () => {
    expect(paymentFilterUnavailableCopy('paypal')).toContain('accept PayPal');
    expect(paymentFilterUnavailableCopy('usdt')).toContain('accept USDT');
  });
});
