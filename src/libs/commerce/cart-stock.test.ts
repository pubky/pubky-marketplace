import { describe, expect, it } from 'vitest';
import { COMMERCE_CART_STOCK_MIN_INTERVAL_MS, COMMERCE_CART_STOCK_READS_PER_MINUTE } from '@/config/commerce';
import { cartLineStock, cartLineStockLabel, cartStockPollIntervalMs } from './cart-stock';

const sizes = [
  { id: 'size_s', quantity: 2, enabled: true },
  { id: 'size_m', quantity: 3, enabled: true },
];

describe('cartLineStock', () => {
  it('never reads a made-to-order line sold out, though its record shows none left', () => {
    const record = [
      { id: 'size_s', quantity: 0, enabled: true },
      { id: 'size_m', quantity: 0, enabled: true },
    ];
    const availability = {
      state: 'available',
      madeToOrder: true,
      variants: [
        { variantId: 'size_s', soldOut: true },
        { variantId: 'size_m', soldOut: false, madeToOrder: true },
      ],
    };
    expect(cartLineStock(record, 'size_m', availability)).toBeNull();
    expect(cartLineStock(record, 'size_s', availability)).toBe('variant_sold_out');
    expect(
      cartLineStock([{ id: 'only', quantity: 0, enabled: true }], 'only', { state: 'available', madeToOrder: true }),
    ).toBeNull();
  });

  it('reads the whole listing sold out when the service says sold', () => {
    expect(cartLineStock(sizes, 'size_s', { state: 'sold' })).toBe('listing_sold_out');
  });

  it('reads the whole listing sold out when the service reports every size sold out', () => {
    expect(
      cartLineStock(sizes, 'size_m', {
        state: 'available',
        variants: [
          { variantId: 'size_s', soldOut: true },
          { variantId: 'size_m', soldOut: true },
        ],
      }),
    ).toBe('listing_sold_out');
  });

  it('reads only the size sold out when another size is in stock', () => {
    const availability = {
      state: 'available',
      variants: [
        { variantId: 'size_s', soldOut: true },
        { variantId: 'size_m', soldOut: false },
      ],
    };

    expect(cartLineStock(sizes, 'size_s', availability)).toBe('variant_sold_out');
    expect(cartLineStock(sizes, 'size_m', availability)).toBeNull();
  });

  it('reads a size the seller set to zero as sold out before the service answers', () => {
    const record = [{ ...sizes[0], quantity: 0 }, sizes[1]];

    expect(cartLineStock(record, 'size_s', null)).toBe('variant_sold_out');
  });

  it('reads a listing without sizes as sold out as a whole', () => {
    expect(cartLineStock([{ id: 'only', quantity: 0, enabled: true }], 'only', null)).toBe('listing_sold_out');
  });

  it('keeps a held listing buyable from the cart', () => {
    expect(cartLineStock(sizes, 'size_s', { state: 'reserved' })).toBeNull();
  });

  it('keeps a held listing buyable when the service flags its held sizes', () => {
    const held = {
      state: 'reserved',
      variants: [
        { variantId: 'size_s', soldOut: true },
        { variantId: 'size_m', soldOut: false },
      ],
    };

    expect(cartLineStock(sizes, 'size_s', held)).toBeNull();
    expect(
      cartLineStock(sizes, 'size_m', { ...held, variants: held.variants.map((row) => ({ ...row, soldOut: true })) }),
    ).toBeNull();
  });

  it('still reads a size the seller set to zero as sold out while the listing is held', () => {
    const record = [{ ...sizes[0], quantity: 0 }, sizes[1]];

    expect(cartLineStock(record, 'size_s', { state: 'reserved' })).toBe('variant_sold_out');
  });

  it('is null for a line whose size left the record', () => {
    expect(cartLineStock(sizes, 'size_gone', { state: 'available' })).toBeNull();
  });
});

describe('cartStockPollIntervalMs', () => {
  it('waits the minimum interval for a small cart', () => {
    expect(cartStockPollIntervalMs(1)).toBe(COMMERCE_CART_STOCK_MIN_INTERVAL_MS);
  });

  it('keeps any cart within the per-minute read budget', () => {
    for (const listings of [1, 4, 5, 6, 12, 40]) {
      expect((listings * 60_000) / cartStockPollIntervalMs(listings)).toBeLessThanOrEqual(
        COMMERCE_CART_STOCK_READS_PER_MINUTE,
      );
    }
  });
});

describe('cartLineStockLabel', () => {
  it('names the listing or the size', () => {
    expect(cartLineStockLabel('listing_sold_out')).toBe('Sold out');
    expect(cartLineStockLabel('variant_sold_out')).toBe('This size is sold out');
  });
});
