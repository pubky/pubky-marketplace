import { describe, expect, it } from 'vitest';
import { commerceListingPreorderSchema, commercePreorderShipBy } from '@/libs/commerce/marketplace-records';
import { PREORDER_COPY, preorderLateCancelOpen } from '@/libs/commerce/preorder';

const orderPreorder = {
  shipsFrom: '2026-12-01',
  graceDays: 7,
  shipBy: '2026-12-08T00:00:00.000Z',
  overdueAt: null,
};

describe('preorder', () => {
  it('puts the ship-by deadline at the start of the UTC day grace days after ships-from', () => {
    expect(commercePreorderShipBy({ shipsFrom: '2026-12-01', graceDays: 7 }).toISOString()).toBe(
      '2026-12-08T00:00:00.000Z',
    );
    expect(commercePreorderShipBy({ shipsFrom: '2026-12-30' }).toISOString()).toBe('2027-01-06T00:00:00.000Z');
  });

  it('reads only a date and a grace of 1 to 30 days', () => {
    expect(commerceListingPreorderSchema.safeParse({ shipsFrom: '2026-12-01', graceDays: 30 }).success).toBe(true);
    expect(commerceListingPreorderSchema.safeParse({ shipsFrom: '2026-12-01T00:00:00Z' }).success).toBe(false);
    expect(commerceListingPreorderSchema.safeParse({ shipsFrom: '2026-12-01', graceDays: 31 }).success).toBe(false);
  });

  it('opens the buyer’s late cancel only on a paid order at or after its ship-by deadline', () => {
    const deadline = new Date('2026-12-08T00:00:00.000Z');
    const before = new Date(deadline.getTime() - 1);
    expect(preorderLateCancelOpen({ state: 'paid', preorder: orderPreorder }, before)).toBe(false);
    expect(preorderLateCancelOpen({ state: 'paid', preorder: orderPreorder }, deadline)).toBe(true);
    expect(preorderLateCancelOpen({ state: 'shipped', preorder: orderPreorder }, deadline)).toBe(false);
    expect(preorderLateCancelOpen({ state: 'paid', preorder: null }, deadline)).toBe(false);
  });

  it('names the ships-from date and the refund date in the buyer’s terms', () => {
    expect(PREORDER_COPY.badge('2026-12-01')).toBe('Preorder · ships from Dec 1, 2026');
    expect(PREORDER_COPY.checkoutTerms({ shipsFrom: '2026-12-01', graceDays: 7 })).toBe(
      'Preorder: you pay now and the seller ships from Dec 1, 2026. If it has not shipped by Dec 8, 2026, you can cancel for a refund.',
    );
  });
});
