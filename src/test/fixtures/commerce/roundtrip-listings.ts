import { commerceListingRecordSchema, type CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { COMMERCE_FIXTURE_SELLER, createCommerceListingFixture } from './commerce';

function media(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'image' as const,
    url: `pubky://${COMMERCE_FIXTURE_SELLER}/pub/pubky.app/marketplace/v1/media/${id}`,
    contentHash: id.length.toString(16).padStart(2, '0').repeat(32),
    mimeType: 'image/jpeg',
    byteSize: 20_000,
    width: 800,
    height: 600,
    altText: `Photo ${id}`,
    ...overrides,
  };
}

function flatShipping(currency: string, exponent: number, amountMinor: number) {
  return [
    {
      id: 'ship_01',
      pricing: 'flat' as const,
      label: 'Standard shipping',
      price: { amountMinor, currency, exponent },
      estimatedMinDays: 3,
      estimatedMaxDays: 7,
    },
  ];
}

/**
 * Twelve listings that exercise every column and every record field the
 * canonical CSV cannot carry: variants with SKUs and price overrides, auction
 * and offer-less sales, non-USD assets, video media, free/flat/calculated
 * shipping, pickup, digital, return-policy details, and text that needs CSV
 * quoting and formula protection.
 */
export function createRoundTripListings(): CommerceListingRecord[] {
  const base = createCommerceListingFixture;
  const records: CommerceListingRecord[] = [
    base({ listingId: 'plain_01', title: 'Plain boots' }),
    base({
      listingId: 'variants_02',
      title: 'Boots in sizes',
      media: [media('img_a'), media('img_b')],
      variants: [
        { id: 'size_40', sku: 'BOOT-40', options: { size: '40' }, quantity: 0, mediaIds: ['img_a'], enabled: false },
        { id: 'size_41', sku: 'BOOT-41', options: { size: '41' }, quantity: 4, mediaIds: ['img_b'], enabled: true },
        {
          id: 'size_42',
          options: { size: '42', colour: 'brown' },
          quantity: 9,
          mediaIds: [],
          enabled: true,
          priceOverride: { amountMinor: 13_900, currency: 'USD', exponent: 2 },
        },
      ],
    }),
    base({
      listingId: 'auction_03',
      title: 'Auction lot',
      sale: {
        format: 'auction',
        startingPrice: { amountMinor: 5_000, currency: 'USD', exponent: 2 },
        buyNowPrice: { amountMinor: 20_000, currency: 'USD', exponent: 2 },
        minimumIncrement: { amountMinor: 500, currency: 'USD', exponent: 2 },
        startsAt: '2026-10-01T10:00:00.000Z',
        endsAt: '2026-10-20T10:00:00.000Z',
        antiSnipingWindowSeconds: 300,
        antiSnipingExtensionSeconds: 120,
      },
    }),
    base({
      listingId: 'quoting_04',
      state: 'paused',
      title: '=1+1, "quoted" boots',
      description: 'Line one,\nline two with "quotes", a comma, and emoji \u{1F97E} \u00e9\u00e8',
      tags: ['vintage', 'a,b', "it's"],
      sale: {
        format: 'fixed_price',
        unitPrice: { amountMinor: 9_900, currency: 'EUR', exponent: 2 },
        acceptsOffers: false,
      },
      shippingOptions: flatShipping('EUR', 2, 1_100),
    }),
    base({
      listingId: 'digital_05',
      title: 'Digital guide',
      fulfillmentMethods: ['digital'],
      package: undefined,
      shippingOptions: [],
      returnPolicy: { acceptsReturns: false, buyerPaysReturnShipping: false, details: 'Digital goods are final.' },
    }),
    base({
      listingId: 'bitcoin_06',
      title: 'Priced in bitcoin',
      sale: {
        format: 'fixed_price',
        unitPrice: { amountMinor: 250_000, currency: 'BTC', exponent: 8 },
        acceptsOffers: true,
      },
      shippingOptions: flatShipping('BTC', 8, 4_000),
    }),
    base({
      listingId: 'media_07',
      title: 'Photos and a video',
      media: [
        media('image_01'),
        media('img_b'),
        media('clip_c', { type: 'video', mimeType: 'video/mp4', durationMs: 12_000 }),
      ],
    }),
    base({
      listingId: 'shipping_08',
      title: 'Three shipping options',
      shippingOptions: [
        { id: 'free_ship', pricing: 'free', label: 'Free post', estimatedMinDays: 5, estimatedMaxDays: 10 },
        {
          id: 'flat_ship',
          pricing: 'flat',
          label: 'Express',
          price: { amountMinor: 2_500, currency: 'USD', exponent: 2 },
          estimatedMinDays: 1,
          estimatedMaxDays: 2,
        },
        {
          id: 'calc_ship',
          pricing: 'calculated',
          label: 'Carrier rate',
          provider: 'easypost',
          serviceCode: 'ups_ground',
          estimatedMinDays: 2,
          estimatedMaxDays: 6,
        },
      ],
    }),
    base({
      listingId: 'pickup_09',
      title: 'Local pickup too',
      fulfillmentMethods: ['physical', 'shipping', 'pickup'],
    }),
    base({
      listingId: 'returns_10',
      title: 'Returns with details',
      condition: 'for_parts',
      conditionDetails: 'Sole is detached.',
      returnPolicy: {
        acceptsReturns: true,
        returnWindowDays: 14,
        buyerPaysReturnShipping: false,
        details: 'Free returns.',
      },
      location: { countryCode: 'PT' },
    }),
    base({ listingId: 'ended_11', state: 'ended', title: 'Ended listing', revision: 4 }),
    base({ listingId: 'second_12', title: 'Second plain', categoryId: 'home-garden', condition: 'new', revision: 2 }),
  ];
  return records.map((record) => commerceListingRecordSchema.parse(record));
}
