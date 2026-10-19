import { describe, expect, it } from 'vitest';
import type { ConnectorCatalogProduct, ConnectorCatalogVariant } from '@/libs/commerce/connectors';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import {
  type LinkableListing,
  linkableListingsFrom,
  mappingsFromPicks,
  matchListingVariants,
  planListingLinks,
  unlinkedReasonCopy,
  variantPicks,
} from './connector-listing-links';

const price = { amountMinor: 2500, currency: 'USD', exponent: 2 };

function storeVariant(id: string, extra: Partial<ConnectorCatalogVariant> = {}): ConnectorCatalogVariant {
  return { providerVariantId: id, optionValues: [], price, ...extra };
}

function product(id: string, variants: ConnectorCatalogVariant[], extra: Partial<ConnectorCatalogProduct> = {}) {
  return {
    providerProductId: `gid://shopify/Product/${id}`,
    title: `Product ${id}`,
    options: [],
    imageUrls: [],
    selected: false,
    variants,
    ...extra,
  } satisfies ConnectorCatalogProduct;
}

function listing(listingId: string, variants: LinkableListing['variants']): LinkableListing {
  return { listingId, title: `Listing ${listingId}`, variants };
}

const tee = product(
  '1',
  [
    storeVariant('gid://shopify/ProductVariant/11', {
      sku: 'TEE-S',
      title: 'S',
      optionValues: [{ name: 'Size', value: 'S' }],
    }),
    storeVariant('gid://shopify/ProductVariant/12', {
      sku: 'TEE-M',
      title: 'M',
      optionValues: [{ name: 'Size', value: 'M' }],
    }),
  ],
  { handle: 'organic-tee' },
);

const mug = product('2', [storeVariant('gid://shopify/ProductVariant/21', { sku: 'MUG-1', title: 'Default Title' })], {
  handle: 'enamel-mug',
});

describe('planListingLinks', () => {
  it('links a CSV listing whose every SKU names one store variant', () => {
    const plan = planListingLinks({
      listings: [
        listing('tee-csv', [
          { id: 'size_s', sku: 'tee-s', options: { Size: 'S' }, enabled: true },
          { id: 'size_m', sku: 'TEE-M ', options: { Size: 'M' }, enabled: true },
        ]),
      ],
      products: [tee, mug],
      mappings: [],
    });
    expect(plan.unlinked).toEqual([]);
    expect(plan.suggestions).toEqual([
      {
        listingId: 'tee-csv',
        title: 'Listing tee-csv',
        basis: 'sku',
        providerProductId: 'gid://shopify/Product/1',
        productTitle: 'Product 1',
        mappings: [
          {
            listingId: 'tee-csv',
            variantId: 'size_s',
            providerProductId: 'gid://shopify/Product/1',
            providerVariantId: 'gid://shopify/ProductVariant/11',
            sku: 'TEE-S',
          },
          {
            listingId: 'tee-csv',
            variantId: 'size_m',
            providerProductId: 'gid://shopify/Product/1',
            providerVariantId: 'gid://shopify/ProductVariant/12',
            sku: 'TEE-M',
          },
        ],
      },
    ]);
  });

  it('links by handle and option values when the CSV had no SKUs', () => {
    const plan = planListingLinks({
      listings: [
        listing('organic-tee', [
          { id: 'v-m', options: { Size: 'm' }, enabled: true },
          { id: 'v-s', options: { Size: 'S' }, enabled: true },
          { id: 'v-xl', options: { Size: 'XL' }, enabled: false },
        ]),
        listing('enamel-mug', [{ id: 'only', options: {}, enabled: true }]),
      ],
      products: [tee, mug],
      mappings: [],
    });
    expect(plan.unlinked).toEqual([]);
    expect(plan.suggestions.map((entry) => [entry.listingId, entry.basis])).toEqual([
      ['organic-tee', 'handle'],
      ['enamel-mug', 'handle'],
    ]);
    expect(plan.suggestions[0]?.mappings.map((mapping) => [mapping.variantId, mapping.providerVariantId])).toEqual([
      ['v-m', 'gid://shopify/ProductVariant/12'],
      ['v-s', 'gid://shopify/ProductVariant/11'],
    ]);
    expect(plan.suggestions[1]?.mappings[0]?.sku).toBe('MUG-1');
  });

  it('never guesses: a SKU in two store variants or two listings, or a partial match, is left to the seller', () => {
    const twin = product('3', [storeVariant('gid://shopify/ProductVariant/31', { sku: 'MUG-1' })]);
    const plan = planListingLinks({
      listings: [
        listing('mug-a', [{ id: 'a', sku: 'MUG-1', options: {}, enabled: true }]),
        listing('tee-half', [
          { id: 's', sku: 'TEE-S', options: { Size: 'S' }, enabled: true },
          { id: 'l', sku: 'TEE-L', options: { Size: 'L' }, enabled: true },
        ]),
        listing('hat', [{ id: 'h', sku: 'HAT-1', options: {}, enabled: true }]),
      ],
      products: [tee, mug, twin],
      mappings: [],
    });
    expect(plan.suggestions).toEqual([]);
    expect(plan.unlinked.map(({ listingId, reason }) => [listingId, reason])).toEqual([
      ['mug-a', 'ambiguous'],
      ['tee-half', 'partial'],
      ['hat', 'no_match'],
    ]);
    expect(unlinkedReasonCopy('no_match')).toBe('No product in your store has the same SKU or handle.');
  });

  it('skips linked listings and never offers a store variant that is already linked', () => {
    const plan = planListingLinks({
      listings: [
        listing('mug-old', [{ id: 'x', sku: 'MUG-1', options: {}, enabled: true }]),
        listing('mug-new', [{ id: 'y', sku: 'MUG-1', options: {}, enabled: true }]),
      ],
      products: [mug],
      mappings: [
        {
          listingId: 'mug-old',
          variantId: 'x',
          providerProductId: 'gid://shopify/Product/2',
          providerVariantId: 'gid://shopify/ProductVariant/21',
        },
      ],
    });
    expect(plan.suggestions).toEqual([]);
    expect(plan.unlinked).toEqual([{ listingId: 'mug-new', title: 'Listing mug-new', reason: 'no_match' }]);
  });

  it('keeps a listing with several sizes out of a one-listing-per-variant connection', () => {
    const plan = planListingLinks({
      listings: [
        listing('organic-tee', [
          { id: 's', sku: 'TEE-S', options: { Size: 'S' }, enabled: true },
          { id: 'm', sku: 'TEE-M', options: { Size: 'M' }, enabled: true },
        ]),
      ],
      products: [tee],
      mappings: [],
      variantMode: 'split',
    });
    expect(plan.unlinked[0]?.reason).toBe('split_multi_variant');
  });
});

describe('matchListingVariants', () => {
  it('matches a hand-picked product by SKU, options or title, and refuses a size it cannot place', () => {
    const picked = listing('my-tee', [
      { id: 's', options: { Size: 'S' }, enabled: true },
      { id: 'm', sku: 'TEE-M', options: {}, enabled: true },
    ]);
    expect(matchListingVariants(picked, tee)?.map((mapping) => mapping.providerVariantId)).toEqual([
      'gid://shopify/ProductVariant/11',
      'gid://shopify/ProductVariant/12',
    ]);
    expect(
      matchListingVariants(listing('my-tee', [{ id: 'xl', options: { Size: 'XL' }, enabled: true }]), tee),
    ).toBeNull();
    expect(
      matchListingVariants(listing('anything', [{ id: 'one', options: {}, enabled: true }]), mug)?.[0],
    ).toMatchObject({ variantId: 'one', providerVariantId: 'gid://shopify/ProductVariant/21' });
  });
});

describe('hand-made links', () => {
  const picked = listing('my-tee', [
    { id: 's', options: { Size: 'S' }, enabled: true },
    { id: 'big', options: { Size: 'Big' }, enabled: true },
  ]);

  it('prefills the sizes it can place and leaves the rest to the seller', () => {
    expect(variantPicks(picked, tee)).toEqual({ s: 'gid://shopify/ProductVariant/11', big: null });
    expect(mappingsFromPicks(picked, tee, variantPicks(picked, tee))).toBeNull();
    expect(
      mappingsFromPicks(picked, tee, { s: 'gid://shopify/ProductVariant/11', big: 'gid://shopify/ProductVariant/11' }),
    ).toBeNull();
    expect(
      mappingsFromPicks(picked, tee, {
        s: 'gid://shopify/ProductVariant/11',
        big: 'gid://shopify/ProductVariant/12',
      })?.map((mapping) => [mapping.variantId, mapping.providerVariantId, mapping.sku]),
    ).toEqual([
      ['s', 'gid://shopify/ProductVariant/11', 'TEE-S'],
      ['big', 'gid://shopify/ProductVariant/12', 'TEE-M'],
    ]);
  });

  it('offers only live, fixed-price listings a store can send', () => {
    const shipped = createCommerceListingFixture();
    const digital = createCommerceListingFixture({ fulfillmentMethods: ['digital'] });
    const removed = createCommerceListingFixture({ state: 'removed' });
    const linkable = linkableListingsFrom([
      { listing_id: 'shipped', record: shipped },
      { listing_id: 'digital', record: digital },
      { listing_id: 'removed', record: removed },
    ]);
    expect(linkable.map((entry) => entry.listingId)).toEqual(['shipped']);
    expect(linkable[0]?.variants[0]?.id).toBe(shipped.variants[0]?.id);
  });
});
