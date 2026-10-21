import { describe, expect, it } from 'vitest';
import { createOrderFixture, ORDER_FIXTURE_BUYER, ORDER_FIXTURE_SELLER } from '@/test/fixtures/commerce/orders';
import { marketplaceOrderSchema } from './marketplace-projections';

const review = {
  id: '0f9b6a6e-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
  reviewerPubky: ORDER_FIXTURE_BUYER,
  subjectPubky: ORDER_FIXTURE_SELLER,
  rating: 5,
  text: 'Accurate and fast.',
  createdAt: '2026-08-21T10:00:00.000Z',
};

const parse = (extra: Record<string, unknown>) =>
  marketplaceOrderSchema.parse({ ...createOrderFixture('completed'), reviews: [{ ...review, ...extra }] }).reviews?.[0];

describe('marketplace order projection: a withdrawn review', () => {
  it('reads the author’s withdrawal flag', () => {
    expect(parse({ publicRemoved: true })?.publicRemoved).toBe(true);
  });

  it('reads an older service’s review, which has no flag, as not removed', () => {
    expect(parse({})?.publicRemoved).toBeUndefined();
  });

  it('drops a malformed flag instead of failing the order', () => {
    expect(parse({ publicRemoved: 'yes' })?.publicRemoved).toBeUndefined();
  });
});
