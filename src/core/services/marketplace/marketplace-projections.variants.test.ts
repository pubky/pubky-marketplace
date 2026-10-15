import { describe, expect, it } from 'vitest';
import { toCamelCaseWire } from '@/libs/commerce/wire-casing';
import { PROJECTION_FIXTURE_SELLER } from '@/test/fixtures/commerce/projections';
import { marketplaceListingProjectionSchema, marketplacePublicListingAvailabilitySchema } from './marketplace-projections';

const AGGREGATE_ID = `listing:${PROJECTION_FIXTURE_SELLER}_boots_01`;

describe('public availability with sizes', () => {
  it('parses the per-size sold-out flags from the snake_case wire', () => {
    const wire = {
      aggregate_id: AGGREGATE_ID,
      state: 'available',
      server_time: '2026-10-15T12:00:00.000Z',
      variants: [
        { variant_id: 'size_s', sold_out: true },
        { variant_id: 'size_m', sold_out: false },
      ],
    };

    expect(marketplacePublicListingAvailabilitySchema.parse(toCamelCaseWire(wire))).toEqual({
      aggregateId: AGGREGATE_ID,
      state: 'available',
      serverTime: '2026-10-15T12:00:00.000Z',
      variants: [
        { variantId: 'size_s', soldOut: true },
        { variantId: 'size_m', soldOut: false },
      ],
    });
  });

  it('parses a listing that sells one variant, where the key is absent', () => {
    const parsed = marketplacePublicListingAvailabilitySchema.parse(
      toCamelCaseWire({ aggregate_id: AGGREGATE_ID, state: 'reserved', server_time: '2026-10-15T12:00:00.000Z' }),
    );

    expect(parsed.variants).toBeUndefined();
  });

  it('refuses a size row without a sold-out flag', () => {
    expect(
      marketplacePublicListingAvailabilitySchema.safeParse({
        aggregateId: AGGREGATE_ID,
        state: 'available',
        serverTime: '2026-10-15T12:00:00.000Z',
        variants: [{ variantId: 'size_s' }],
      }).success,
    ).toBe(false);
  });
});

describe('listing projection with sizes', () => {
  const base = {
    aggregate_id: AGGREGATE_ID,
    seller_pubky: PROJECTION_FIXTURE_SELLER,
    listing_id: 'boots_01',
    listing_revision: 1,
    content_hash: 'c'.repeat(64),
    server_revision: 3,
    state: 'available',
    available_quantity: 4,
    reserved_quantity: 0,
    unit_price: { amount_minor: 12_500, currency: 'USD', exponent: 2 },
    sale_format: 'fixed_price',
    fulfillment_methods: ['shipping'],
    auction: null,
  };

  it('keeps the offered sizes in record order', () => {
    const parsed = marketplaceListingProjectionSchema.parse(
      toCamelCaseWire({
        ...base,
        variants: [
          { variant_id: 'size_s', available_quantity: 0, sold_out: true },
          { variant_id: 'size_m', available_quantity: 4, sold_out: false },
        ],
      }),
    );

    expect(parsed.variants).toEqual([
      { variantId: 'size_s', availableQuantity: 0, soldOut: true },
      { variantId: 'size_m', availableQuantity: 4, soldOut: false },
    ]);
  });

  it('parses a projection with no sizes', () => {
    expect(marketplaceListingProjectionSchema.parse(toCamelCaseWire(base)).variants).toBeUndefined();
  });
});
