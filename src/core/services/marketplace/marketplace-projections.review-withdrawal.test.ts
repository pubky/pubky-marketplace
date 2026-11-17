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

describe('marketplace order projection: a withheld counterparty review', () => {
  const stub = { role: 'seller', submitted: true };
  const parseAll = (reviews: unknown[]) =>
    marketplaceOrderSchema.parse({ ...createOrderFixture('completed'), reviews });

  it('reads the submitted-only stub without failing the order and does not keep it as a review', () => {
    expect(parseAll([stub]).reviews).toEqual([]);
  });

  it('keeps the real reviews next to a stub', () => {
    const reviews = parseAll([stub, review]).reviews;

    expect(reviews).toHaveLength(1);
    expect(reviews?.[0]?.rating).toBe(5);
  });

  it('keeps a submitted review that carries a rating', () => {
    expect(parseAll([{ ...review, submitted: true }]).reviews).toHaveLength(1);
  });
});
