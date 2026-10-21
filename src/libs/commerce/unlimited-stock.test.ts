import { describe, expect, it } from 'vitest';
import { COMMERCE_LISTING_MAX_QUANTITY } from '@/config/commerce';
import {
  countableStockQuantity,
  formatListingStock,
  formatStockQuantity,
  isUnlimitedStock,
  listingStockRefusal,
  UNLIMITED_STOCK_LABEL,
  UNLIMITED_STOCK_RESERVED_MESSAGE,
} from './unlimited-stock';

const digital = { fulfillmentMethods: ['digital' as const] };
const cap = COMMERCE_LISTING_MAX_QUANTITY;

describe('unlimited stock', () => {
  it('is unlimited only for a digital-only listing at the quantity cap', () => {
    expect(isUnlimitedStock(digital, cap)).toBe(true);
    expect(formatStockQuantity(digital, cap)).toBe(UNLIMITED_STOCK_LABEL);
    expect(isUnlimitedStock(digital, 4)).toBe(false);
    expect(formatStockQuantity(digital, 4)).toBe('4');
    expect(isUnlimitedStock({ fulfillmentMethods: ['physical'] }, cap)).toBe(false);
    expect(isUnlimitedStock({ fulfillmentMethods: ['physical', 'shipping', 'digital'] }, cap)).toBe(false);
    expect(isUnlimitedStock({ fulfillmentMethods: ['pickup', 'digital'] }, cap)).toBe(false);
    // `physical` is not a service method, so this record sells as digital-only.
    expect(isUnlimitedStock({ fulfillmentMethods: ['physical', 'digital'] }, cap)).toBe(true);
  });

  it('labels a listing Unlimited when any variant is at the cap', () => {
    const record = {
      ...digital,
      variants: [{ quantity: cap }, { quantity: 2 }],
    };
    expect(formatListingStock(record)).toBe(UNLIMITED_STOCK_LABEL);
    expect(
      countableStockQuantity({
        ...record,
        variants: [
          { quantity: cap, enabled: true },
          { quantity: 2, enabled: true },
        ],
      }),
    ).toBe(2);
    expect(countableStockQuantity({ ...digital, variants: [{ quantity: cap, enabled: false }] })).toBe(0);
    expect(
      formatListingStock({
        fulfillmentMethods: ['physical'],
        variants: [{ quantity: 3 }, { quantity: 4 }],
      }),
    ).toBe('7');
  });

  it("shows the service's count once known: a sale never changes the record's quantity", () => {
    const record = { ...digital, variants: [{ quantity: 5 }] };
    expect(formatListingStock(record, 4)).toBe('4');
    expect(formatListingStock(record, null)).toBe('5');
    expect(formatListingStock({ ...digital, variants: [{ quantity: cap }] }, 3)).toBe(UNLIMITED_STOCK_LABEL);
  });

  it('refuses the cap on any listing that ships or offers pickup, and nowhere else', () => {
    const variants = (...quantities: number[]) => quantities.map((quantity) => ({ quantity }));
    for (const fulfillmentMethods of [
      ['physical'],
      ['shipping'],
      ['pickup'],
      ['physical', 'shipping', 'pickup'],
      ['physical', 'shipping', 'digital'],
      ['pickup', 'digital'],
    ] as const) {
      expect(listingStockRefusal({ fulfillmentMethods, variants: variants(3, cap) })).toBe(
        UNLIMITED_STOCK_RESERVED_MESSAGE,
      );
      expect(listingStockRefusal({ fulfillmentMethods, variants: variants(cap - 1) })).toBeNull();
    }
    expect(listingStockRefusal({ fulfillmentMethods: ['digital'], variants: variants(cap) })).toBeNull();
    // `['physical', 'digital']` without `shipping` derives to digital-only.
    expect(listingStockRefusal({ fulfillmentMethods: ['physical', 'digital'], variants: variants(cap) })).toBeNull();
  });
});
