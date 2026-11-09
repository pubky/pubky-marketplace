import { describe, expect, it } from 'vitest';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import {
  anyGroupFollowed,
  type EditedListingFields,
  keepFollowedFields,
  NO_FOLLOWED_GROUPS,
} from './listing-followed-fields';

const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD', exponent: 2 });

function published() {
  return createCommerceListingFixture({
    title: 'From the store',
    description: 'Store text.',
    sale: { format: 'fixed_price', unitPrice: usd(10000), acceptsOffers: true },
    variants: [
      {
        id: 'shopify-aaa',
        sku: 'A',
        options: { Material: 'Wool' },
        quantity: 2,
        mediaIds: ['image_01'],
        enabled: true,
      },
      {
        id: 'shopify-bbb',
        sku: 'B',
        options: { Material: 'Silk' },
        quantity: 5,
        mediaIds: ['image_01'],
        enabled: false,
        priceOverride: usd(20000),
      },
    ],
  });
}

/** What the editor builds from its form: positional ids, only size/color/style, every variant enabled. */
function edited(overrides: Partial<EditedListingFields> = {}): EditedListingFields {
  return {
    title: 'Edited here',
    description: 'Edited text.',
    media: [{ id: 'image_new' }],
    variants: [
      {
        id: 'variant_1',
        sku: 'X',
        options: {},
        quantity: 9,
        mediaIds: ['image_new'],
        enabled: true,
        priceOverride: usd(11111),
      },
      { id: 'variant_2', sku: 'Y', options: {}, quantity: 8, mediaIds: ['image_new'], enabled: true },
    ],
    sale: { format: 'fixed_price', unitPrice: usd(99999), acceptsOffers: false },
    ...overrides,
  };
}

describe('keepFollowedFields', () => {
  it('changes nothing for a listing that follows no store', () => {
    expect(keepFollowedFields(published(), edited(), NO_FOLLOWED_GROUPS)).toEqual(edited());
  });

  it('puts back the store’s title, description and photos when content follows', () => {
    const record = published();

    const result = keepFollowedFields(record, edited(), { content: true, price: false, variants: false });

    expect(result.title).toBe('From the store');
    expect(result.description).toBe('Store text.');
    expect(result.media).toEqual(record.media);
    expect(result.variants.map((variant) => variant.mediaIds)).toEqual([['image_01'], ['image_01']]);
    expect(result.sale).toEqual(edited().sale);
  });

  it('puts back the price and each variant’s price override when price follows', () => {
    const record = published();

    const result = keepFollowedFields(record, edited(), { content: false, price: true, variants: false });

    expect(result.sale).toEqual(record.sale);
    expect(result.variants[0]?.priceOverride).toBeUndefined();
    expect(result.variants[1]?.priceOverride).toEqual(usd(20000));
    expect(result.title).toBe('Edited here');
  });

  it('keeps the listing’s own variants when variants follow, taking only stock from the form', () => {
    const record = published();

    const result = keepFollowedFields(record, edited(), { content: false, price: false, variants: true });

    expect(result.variants.map(({ id, sku, enabled }) => [id, sku, enabled])).toEqual([
      ['shopify-aaa', 'A', true],
      ['shopify-bbb', 'B', false],
    ]);
    expect(result.variants.map(({ quantity }) => quantity)).toEqual([9, 8]);
    expect(result.variants[0]?.options).toEqual({ Material: 'Wool' });
    expect(result.variants[0]?.priceOverride).toEqual(usd(11111));
    expect(result.variants[1]?.priceOverride).toBeUndefined();
  });

  it('keeps every followed part when all three follow, and lets only stock through', () => {
    const record = published();

    const result = keepFollowedFields(record, edited(), { content: true, price: true, variants: true });

    expect(result.title).toBe('From the store');
    expect(result.sale).toEqual(record.sale);
    expect(result.variants[1]?.priceOverride).toEqual(usd(20000));
    expect(result.variants.map(({ quantity }) => quantity)).toEqual([9, 8]);
  });
});

describe('anyGroupFollowed', () => {
  it('is true when one part follows', () => {
    expect(anyGroupFollowed(NO_FOLLOWED_GROUPS)).toBe(false);
    expect(anyGroupFollowed({ content: false, price: true, variants: false })).toBe(true);
  });
});
