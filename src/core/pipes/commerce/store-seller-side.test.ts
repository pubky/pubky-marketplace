import { describe, expect, it } from 'vitest';
import { canSellHere, withoutSalesOutsideStoreSeller } from './store-seller-side';

const STORE_SELLER = 's'.repeat(52);
const VIEWER = 'v'.repeat(52);
const OTHER = 'o'.repeat(52);

const rows = [
  { id: 'bought-from-store', sellerPubky: STORE_SELLER },
  { id: 'bought-elsewhere', sellerPubky: OTHER },
  { id: 'sold-by-viewer', sellerPubky: VIEWER },
];

const ids = (list: { id: string }[]) => list.map(({ id }) => id);

describe('canSellHere', () => {
  it('lets only the store seller sell in a store, and everyone outside store mode', () => {
    expect(canSellHere(VIEWER, STORE_SELLER)).toBe(false);
    expect(canSellHere(STORE_SELLER, STORE_SELLER)).toBe(true);
    expect(canSellHere(VIEWER, null)).toBe(true);
  });
});

describe('withoutSalesOutsideStoreSeller', () => {
  it('drops the rows another signed-in seller sold in a store', () => {
    expect(ids(withoutSalesOutsideStoreSeller(rows, VIEWER, STORE_SELLER))).toEqual([
      'bought-from-store',
      'bought-elsewhere',
    ]);
  });

  it('keeps every row for the store seller', () => {
    const storeSellerRows = [...rows, { id: 'sold-by-store', sellerPubky: STORE_SELLER }];
    expect(withoutSalesOutsideStoreSeller(storeSellerRows, STORE_SELLER, STORE_SELLER)).toBe(storeSellerRows);
  });

  it('keeps every row outside store mode', () => {
    expect(withoutSalesOutsideStoreSeller(rows, VIEWER, null)).toBe(rows);
  });
});
