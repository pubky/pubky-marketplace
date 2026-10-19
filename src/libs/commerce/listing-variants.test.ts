import { describe, expect, it } from 'vitest';
import {
  buildRegisterVariants,
  everyOfferedVariantSoldOut,
  firstAvailableVariantId,
  isVariantSoldOut,
  listingSoldOutVariantIds,
  madeToOrderVariantIds,
  projectionReadsSoldOut,
  soldOutVariantIds,
  tracksVariantStock,
} from './listing-variants';

const USD = (amountMinor: number) => ({ amountMinor, currency: 'USD', exponent: 2 });

const variant = (
  id: string,
  quantity: number,
  extra: { enabled?: boolean; sku?: string; priceOverride?: ReturnType<typeof USD> } = {},
) => ({
  id,
  quantity,
  enabled: extra.enabled ?? true,
  ...(extra.sku ? { sku: extra.sku } : {}),
  ...(extra.priceOverride ? { priceOverride: extra.priceOverride } : {}),
});

describe('buildRegisterVariants', () => {
  it('lists the enabled variants in record order with optional skus', () => {
    expect(
      buildRegisterVariants([
        variant('size_s', 1, { sku: 'SHIRT-S' }),
        variant('size_x', 9, { enabled: false }),
        variant('size_m', 4),
      ]),
    ).toEqual([
      { id: 'size_s', quantity: 1, sku: 'SHIRT-S' },
      { id: 'size_m', quantity: 4 },
    ]);
  });

  it('returns nothing for fewer than two enabled variants', () => {
    expect(buildRegisterVariants([])).toBeUndefined();
    expect(buildRegisterVariants([variant('size_m', 4)])).toBeUndefined();
    expect(buildRegisterVariants([variant('size_s', 1, { enabled: false }), variant('size_m', 4)])).toBeUndefined();
  });

  it('keeps an enabled variant with no stock', () => {
    expect(buildRegisterVariants([variant('size_s', 0), variant('size_m', 4)])).toEqual([
      { id: 'size_s', quantity: 0 },
      { id: 'size_m', quantity: 4 },
    ]);
  });

  it("carries each priced variant's own price and none for the others", () => {
    expect(
      buildRegisterVariants([
        variant('size_s', 3),
        variant('size_l', 2, { priceOverride: USD(150) }),
        variant('size_x', 9, { enabled: false, priceOverride: USD(999) }),
      ]),
    ).toEqual([
      { id: 'size_s', quantity: 3 },
      { id: 'size_l', quantity: 2, unitPrice: USD(150) },
    ]);
  });

  it('registers a sole enabled variant that sells at its own price, so the service charges it', () => {
    expect(buildRegisterVariants([variant('only', 4, { priceOverride: USD(4_500) })])).toEqual([
      { id: 'only', quantity: 4, unitPrice: USD(4_500) },
    ]);
    expect(
      buildRegisterVariants([variant('a', 1, { enabled: false, priceOverride: USD(1) }), variant('b', 4)]),
    ).toBeUndefined();
  });
});

describe('tracksVariantStock', () => {
  it('needs two enabled variants', () => {
    expect(tracksVariantStock([variant('size_s', 1), variant('size_m', 1)])).toBe(true);
    expect(tracksVariantStock([variant('size_s', 1), variant('size_m', 1, { enabled: false })])).toBe(false);
    expect(tracksVariantStock([])).toBe(false);
  });
});

describe('sold-out reading', () => {
  const rows = [
    { variantId: 'size_s', soldOut: true },
    { variantId: 'size_m', soldOut: false },
  ];

  it('collects the sizes the service reports sold out', () => {
    expect([...soldOutVariantIds(rows)]).toEqual(['size_s']);
    expect(soldOutVariantIds(undefined).size).toBe(0);
    expect(soldOutVariantIds(null).size).toBe(0);
  });

  it('takes no size as sold out from a held listing, whose flags count held units', () => {
    expect([...listingSoldOutVariantIds({ state: 'available', variants: rows })]).toEqual(['size_s']);
    expect([...listingSoldOutVariantIds({ state: 'sold', variants: rows })]).toEqual(['size_s']);
    expect(listingSoldOutVariantIds({ state: 'reserved', variants: rows }).size).toBe(0);
    expect(listingSoldOutVariantIds(null).size).toBe(0);
  });

  it('treats a size as sold out from the service or from a zero record quantity', () => {
    const sold = soldOutVariantIds(rows);
    expect(isVariantSoldOut(variant('size_s', 3), sold)).toBe(true);
    expect(isVariantSoldOut(variant('size_m', 3), sold)).toBe(false);
    expect(isVariantSoldOut(variant('size_m', 0), sold)).toBe(true);
  });

  it('reads the listing sold out only when every offered size is', () => {
    const variants = [variant('size_s', 3), variant('size_m', 3), variant('size_x', 3, { enabled: false })];
    expect(everyOfferedVariantSoldOut(variants, new Set(['size_s']))).toBe(false);
    expect(everyOfferedVariantSoldOut(variants, new Set(['size_s', 'size_m']))).toBe(true);
    expect(everyOfferedVariantSoldOut([], new Set())).toBe(false);
  });

  it('picks the first size a buyer can choose', () => {
    const variants = [variant('size_s', 3), variant('size_m', 3), variant('size_l', 3, { enabled: false })];
    expect(firstAvailableVariantId(variants, new Set(['size_s']))).toBe('size_m');
    expect(firstAvailableVariantId(variants, new Set(['size_s', 'size_m']))).toBeUndefined();
  });

  it('reads a projection sold out from state, quantity or every size', () => {
    expect(projectionReadsSoldOut({ state: 'sold' })).toBe(true);
    expect(projectionReadsSoldOut({ state: 'available', availableQuantity: 0 })).toBe(true);
    expect(projectionReadsSoldOut({ state: 'available', availableQuantity: 4, variants: rows })).toBe(false);
    expect(
      projectionReadsSoldOut({
        state: 'available',
        availableQuantity: 4,
        variants: rows.map((row) => ({ ...row, soldOut: true })),
      }),
    ).toBe(true);
  });

  it('keeps a held listing reading as held even when every size has no free stock', () => {
    expect(
      projectionReadsSoldOut({
        state: 'reserved',
        availableQuantity: 0,
        variants: rows.map((row) => ({ ...row, soldOut: true })),
      }),
    ).toBe(false);
  });
});

describe('made-to-order stock', () => {
  it('names the made-to-order sizes, or every size of a one-variant listing', () => {
    const sizes = [variant('size_s', 0), variant('size_m', 0)];
    expect(
      madeToOrderVariantIds(
        {
          state: 'available',
          madeToOrder: true,
          variants: [
            { variantId: 'size_s', soldOut: true },
            { variantId: 'size_m', soldOut: false, madeToOrder: true },
          ],
        },
        sizes,
      ),
    ).toEqual(new Set(['size_m']));
    expect(madeToOrderVariantIds({ state: 'available', madeToOrder: true }, [variant('only', 1)])).toEqual(
      new Set(['only']),
    );
    expect(madeToOrderVariantIds({ state: 'available' }, sizes).size).toBe(0);
    expect(madeToOrderVariantIds(null, sizes).size).toBe(0);
  });

  it('never reads a made-to-order size or listing as sold out, whatever the record says', () => {
    const made = new Set(['size_m']);
    expect(isVariantSoldOut(variant('size_m', 0), new Set(), made)).toBe(false);
    expect(isVariantSoldOut(variant('size_s', 0), new Set(), made)).toBe(true);
    expect(everyOfferedVariantSoldOut([variant('size_s', 0), variant('size_m', 0)], new Set(['size_s']), made)).toBe(
      false,
    );
    expect(firstAvailableVariantId([variant('size_s', 0), variant('size_m', 0)], new Set(), made)).toBe('size_m');
    expect(projectionReadsSoldOut({ state: 'available', availableQuantity: 0, madeToOrder: true })).toBe(false);
    expect(projectionReadsSoldOut({ state: 'available', availableQuantity: 0 })).toBe(true);
  });
});
