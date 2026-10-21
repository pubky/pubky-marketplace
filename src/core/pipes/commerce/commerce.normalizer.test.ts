import { describe, expect, it } from 'vitest';
import {
  COMMERCE_FIXTURE_SELLER,
  createCommerceListingFixture,
  createCommerceShopFixture,
  createNexusAuctionListingDetailsFixture,
  createNexusListingDetailsFixture,
} from '@/test/fixtures/commerce/commerce';
import { CommerceRecordNormalizer } from './commerce.normalizer';

describe('CommerceRecordNormalizer', () => {
  it('normalizes closed shop and listing records', () => {
    const shop = createCommerceShopFixture();
    const listing = createCommerceListingFixture();

    expect(CommerceRecordNormalizer.shop(shop)).toEqual(shop);
    expect(CommerceRecordNormalizer.listing(listing)).toEqual(listing);
  });

  it('loads an existing saved search that uses the pre-drops sale-format value', () => {
    const existing = {
      query: 'camera',
      categoryId: null,
      saleFormat: 'all',
      conditions: [],
      minimumPriceMinor: null,
      maximumPriceMinor: null,
      sort: 'newest',
    };

    expect(CommerceRecordNormalizer.savedSearchParams(existing)).toEqual(existing);
  });

  it('reads a saved search that used the removed Recommended sort as Newest', () => {
    const legacy = {
      query: '',
      categoryId: null,
      saleFormat: 'all',
      conditions: [],
      minimumPriceMinor: null,
      maximumPriceMinor: null,
      sort: 'recommended',
    };

    expect(CommerceRecordNormalizer.savedSearchParams(legacy)).toEqual({ ...legacy, sort: 'newest' });
  });

  it('returns structured validation issues without copying the rejected payload', () => {
    // An invalid enum value carrying a sensitive string: the error must be
    // structured, never a copy of the payload. (Unknown fields no longer
    // fail — records are open-world — so the trigger is a real violation.)
    const listing = {
      ...createCommerceListingFixture(),
      condition: 'private-address',
    };

    try {
      CommerceRecordNormalizer.listing(listing);
      expect.unreachable('Expected commerce listing validation to fail');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'AppError',
        code: 'INVALID_INPUT',
        category: 'validation',
        context: {
          issues: expect.any(Array),
        },
      });
      expect(JSON.stringify(error)).not.toContain('private-address');
    }
  });

  it('builds canonical owner-scoped marketplace URIs', () => {
    expect(CommerceRecordNormalizer.shopUri(COMMERCE_FIXTURE_SELLER)).toBe(
      `pubky://${COMMERCE_FIXTURE_SELLER}/pub/pubky.app/marketplace/v1/shop.json`,
    );
    expect(CommerceRecordNormalizer.listingUri(COMMERCE_FIXTURE_SELLER, 'boots_01')).toBe(
      `pubky://${COMMERCE_FIXTURE_SELLER}/pub/pubky.app/marketplace/v1/listings/boots_01`,
    );
    expect(CommerceRecordNormalizer.mediaUri(COMMERCE_FIXTURE_SELLER, 'image_01')).toBe(
      `pubky://${COMMERCE_FIXTURE_SELLER}/pub/pubky.app/marketplace/v1/media/image_01`,
    );
    expect(CommerceRecordNormalizer.reviewUri(COMMERCE_FIXTURE_SELLER, 'review_01')).toBe(
      `pubky://${COMMERCE_FIXTURE_SELLER}/pub/pubky.app/marketplace/v1/reviews/review_01`,
    );
    expect(CommerceRecordNormalizer.collectionUri(COMMERCE_FIXTURE_SELLER, 'summer')).toBe(
      `pubky://${COMMERCE_FIXTURE_SELLER}/pub/pubky.app/marketplace/v1/collections/summer.json`,
    );
  });

  it('normalizes seller-scoped composite listing ids', () => {
    expect(CommerceRecordNormalizer.listingCompositeId(`${COMMERCE_FIXTURE_SELLER}:boots_01`)).toBe(
      `${COMMERCE_FIXTURE_SELLER}:boots_01`,
    );
    expect(() => CommerceRecordNormalizer.listingCompositeId('seller:../private')).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    );
  });

  it.each([
    ['invalid owner', 'not-a-pubky', 'listing_01'],
    ['path traversal', COMMERCE_FIXTURE_SELLER, '../private'],
    ['path separator', COMMERCE_FIXTURE_SELLER, 'nested/listing'],
  ])('rejects %s before constructing a URI', (_label, owner, id) => {
    expect(() => CommerceRecordNormalizer.listingUri(owner, id)).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    );
  });

  describe('nexusListingStream', () => {
    it('normalizes a fixed-price projection into a renderable catalog entry', () => {
      const payload = [createNexusListingDetailsFixture()];

      expect(CommerceRecordNormalizer.nexusListingStream(payload)).toEqual([
        {
          id: `${COMMERCE_FIXTURE_SELLER}:boots_01`,
          seller_id: COMMERCE_FIXTURE_SELLER,
          listing_id: 'boots_01',
          state: 'active',
          title: 'Vintage leather boots',
          description: 'Well cared for boots with light wear.',
          category_id: 'fashion-shoes-boots',
          condition: 'good',
          tags: ['vintage'],
          country_code: 'US',
          region: 'NY',
          media_urls: [`pubky://${COMMERCE_FIXTURE_SELLER}/pub/pubky.app/marketplace/v1/media/image_01`],
          sale_format: 'fixed_price',
          price: { amountMinor: 12_500, currency: 'USD', exponent: 2 },
          auction: null,
          // The service-facing fulfillment vocabulary, echoed for the card
          // badge: the default fixture's shipped listing reads `['shipping']`.
          fulfillment_methods: ['shipping'],
          revision: 1,
          updated_at: Date.parse('2026-08-19T21:00:00.000Z'),
          // No reputation snippets in the projection: absence normalizes to
          // null, never a fabricated zero aggregate (ratified D5).
          reputation: null,
          listing_reputation: null,
        },
      ]);
    });

    it('denominates auction terms in the listing primary asset', () => {
      const [entry] = CommerceRecordNormalizer.nexusListingStream([createNexusAuctionListingDetailsFixture()]);

      expect(entry.sale_format).toBe('auction');
      expect(entry.price).toEqual({ amountMinor: 4_500, currency: 'USD', exponent: 2 });
      expect(entry.auction).toEqual({
        startsAt: '2026-08-19T20:00:00.000Z',
        endsAt: '2026-08-29T20:00:00.000Z',
        buyNowPrice: { amountMinor: 12_500, currency: 'USD', exponent: 2 },
        minimumIncrement: { amountMinor: 500, currency: 'USD', exponent: 2 },
      });
    });

    it('keeps optional auction terms null without inventing values', () => {
      const [entry] = CommerceRecordNormalizer.nexusListingStream([
        createNexusAuctionListingDetailsFixture({
          auction_buy_now_price_minor: null,
        }),
      ]);

      expect(entry.auction).toMatchObject({ buyNowPrice: null });
    });

    it('accepts an auction row with all-null terms as indexed before Nexus carried them', () => {
      const [entry] = CommerceRecordNormalizer.nexusListingStream([
        createNexusAuctionListingDetailsFixture({
          auction_starts_at: null,
          auction_ends_at: null,
          auction_buy_now_price_minor: null,
          auction_minimum_increment_minor: null,
        }),
      ]);

      expect(entry.sale_format).toBe('auction');
      expect(entry.auction).toBeNull();
    });

    it('accepts a null region and tolerates additive fields Nexus may introduce', () => {
      const payload = [{ ...createNexusListingDetailsFixture({ region: null }), future_field: 'ignored' }];

      expect(CommerceRecordNormalizer.nexusListingStream(payload)).toMatchObject([
        { seller_id: COMMERCE_FIXTURE_SELLER, listing_id: 'boots_01', region: null, revision: 1 },
      ]);
    });

    it.each([
      ['a non-array payload', createNexusListingDetailsFixture()],
      ['an owner that is not a pubky', [createNexusListingDetailsFixture({ owner_id: 'not-a-pubky' })]],
      ['a path-unsafe listing id', [createNexusListingDetailsFixture({ id: '../private' })]],
      ['a missing revision', [{ ...createNexusListingDetailsFixture(), revision: undefined }]],
      ['an unknown condition value', [{ ...createNexusListingDetailsFixture(), condition: 'mint' }]],
      ['an auction payload missing the end time', [createNexusAuctionListingDetailsFixture({ auction_ends_at: null })]],
      [
        'an auction payload without the auction term keys',
        [
          (() => {
            const {
              auction_starts_at: _startsAt,
              auction_ends_at: _endsAt,
              auction_buy_now_price_minor: _buyNow,
              auction_minimum_increment_minor: _increment,
              ...withoutTerms
            } = createNexusAuctionListingDetailsFixture();
            return withoutTerms;
          })(),
        ],
      ],
      [
        'an auction end time that is not an RFC 3339 timestamp',
        [createNexusAuctionListingDetailsFixture({ auction_ends_at: 'tomorrow' })],
      ],
      [
        'a non-positive minimum increment',
        [createNexusAuctionListingDetailsFixture({ auction_minimum_increment_minor: 0 })],
      ],
      [
        'a fixed-price payload carrying auction terms',
        [createNexusListingDetailsFixture({ auction_ends_at: '2026-08-29T20:00:00.000Z' })],
      ],
    ])('rejects %s', (_label, payload) => {
      expect(() => CommerceRecordNormalizer.nexusListingStream(payload)).toThrow(
        expect.objectContaining({ code: 'INVALID_INPUT', category: 'validation' }),
      );
    });
  });
  describe('shippingPresetInput', () => {
    const valid = { label: 'Tracked', priceMinor: 990, currency: 'USD', estimatedMinDays: 2, estimatedMaxDays: 6 };

    it.each(['USD', 'EUR', 'CHF', 'GBP', 'JPY', 'CAD', 'AUD', 'BTC'])('accepts a preset priced in %s', (currency) => {
      expect(CommerceRecordNormalizer.shippingPresetInput({ ...valid, currency })).toMatchObject({ currency });
    });

    it.each(['SEK', 'usd', 'SATS', '', 'USDT'])('refuses a preset priced in %j', (currency) => {
      expect(() => CommerceRecordNormalizer.shippingPresetInput({ ...valid, currency })).toThrow();
    });

    it('still refuses a zero or fractional price in minor units', () => {
      expect(() => CommerceRecordNormalizer.shippingPresetInput({ ...valid, priceMinor: 0 })).toThrow();
      expect(() => CommerceRecordNormalizer.shippingPresetInput({ ...valid, priceMinor: 9.9 })).toThrow();
    });
  });

  describe('nexusReviewStream', () => {
    const REVIEWER = 'a'.repeat(52);

    function reviewEntry(review: Record<string, unknown> = {}) {
      return {
        review: {
          review_id: '8Z8CWH8NVYQY39ZEBFGKQWWEKG',
          uri: `pubky://${REVIEWER}/pub/pubky.app/marketplace/v1/reviews/8Z8CWH8NVYQY39ZEBFGKQWWEKG`,
          reviewer_id: REVIEWER,
          subject_id: COMMERCE_FIXTURE_SELLER,
          listing_owner_id: COMMERCE_FIXTURE_SELLER,
          listing_id: 'boots_01',
          role: 'buyer_reviewing_seller',
          rating_overall: 2,
          text: 'Arrived late.',
          verified: false,
          attestor_id: null,
          order_ref: null,
          edited_late: false,
          created_at: '2026-10-20T12:00:00.000Z',
          updated_at: '2026-10-20T12:00:00.000Z',
          revision: 1,
          indexed_at: 1,
          ...review,
        },
        response: null,
      };
    }

    it('reads a missing moderation field, from an index older than review moderation, as not moderated', () => {
      const [review] = CommerceRecordNormalizer.nexusReviewStream([reviewEntry()]);

      expect(review.moderation).toBeNull();
      expect(review.text).toBe('Arrived late.');
      expect(review.uri).toBe(`pubky://${REVIEWER}/pub/pubky.app/marketplace/v1/reviews/8Z8CWH8NVYQY39ZEBFGKQWWEKG`);
    });

    it('reads a null moderation as not moderated', () => {
      const [review] = CommerceRecordNormalizer.nexusReviewStream([reviewEntry({ moderation: null })]);

      expect(review.moderation).toBeNull();
      expect(review.text).toBe('Arrived late.');
    });

    it.each(['text_hidden', 'excluded'] as const)('carries %s moderation with its reason and no text', (state) => {
      const [review] = CommerceRecordNormalizer.nexusReviewStream([
        reviewEntry({ text: '', moderation: { state, reason: 'hatespeech' } }),
      ]);

      expect(review.moderation).toEqual({ state, reason: 'hatespeech' });
      expect(review.ratingOverall).toBe(2);
      expect(review.text).toBe('');
    });

    it('drops text an index sent alongside moderation', () => {
      const [review] = CommerceRecordNormalizer.nexusReviewStream([
        reviewEntry({ moderation: { state: 'text_hidden', reason: 'harassement' } }),
      ]);

      expect(review.text).toBe('');
    });

    it('rejects a moderation state the frozen contract does not define', () => {
      expect(() =>
        CommerceRecordNormalizer.nexusReviewStream([reviewEntry({ moderation: { state: 'hidden', reason: 'x' } })]),
      ).toThrow();
    });
  });
});
