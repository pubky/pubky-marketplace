import { buildMarketUri, buildWatchlist } from 'pubky-market-specs';
import { describe, expect, it } from 'vitest';
import { parseListingUri } from './listingUri';

const SELLER = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const LISTING_ID = '0034A0X7NJ52A';
const LONG_LISTING_ID = '1061cf08aaad4c8f99d996f3c2c092ba';
const CANONICAL = `pubky://${SELLER}/pub/pubky.app/marketplace/v1/listings/${LISTING_ID}`;

describe('parseListingUri', () => {
  it('parses a canonical listing URI', () => {
    expect(parseListingUri(CANONICAL)).toEqual({ sellerPubky: SELLER, listingId: LISTING_ID });
  });

  it.each([
    ['post URI', `pubky://${SELLER}/pub/pubky.app/posts/${LISTING_ID}`],
    ['shop URI', `pubky://${SELLER}/pub/pubky.app/marketplace/v1/shop.json`],
    ['extra path segment', `${CANONICAL}/extra`],
    ['trailing slash', `${CANONICAL}/`],
    ['query string', `${CANONICAL}?x=1`],
    ['short pubky id', `pubky://short/pub/pubky.app/marketplace/v1/listings/${LISTING_ID}`],
    ['invalid short listing id', `pubky://${SELLER}/pub/pubky.app/marketplace/v1/listings/short!1234567`],
    ['http scheme', `https://${SELLER}/pub/pubky.app/marketplace/v1/listings/${LISTING_ID}`],
    ['empty string', ''],
  ])('returns null for %s', (_, uri) => {
    expect(parseListingUri(uri)).toBeNull();
  });

  it('parses a 32-character commerce entity id', () => {
    expect(parseListingUri(`pubky://${SELLER}/pub/pubky.app/marketplace/v1/listings/${LONG_LISTING_ID}`)).toEqual({
      sellerPubky: SELLER,
      listingId: LONG_LISTING_ID,
    });
  });
});

describe('listing URI compatibility with pubky-market-specs', () => {
  const validateWatchlistItem = (listingId: string) =>
    buildWatchlist(SELLER, {
      schemaVersion: 1,
      recordType: 'watchlist',
      ownerPubky: SELLER,
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      items: [{ listingOwnerPubky: SELLER, listingId, watchedAtMs: 1 }],
      tombstones: [],
    }).free();

  it.each([
    ['32-hex entity id', '1061cf08aaad4c8f99d996f3c2c092ba'],
    ['Crockford timestamp id', '0034A0X7NJ52A'],
    ['one-character entity id', 'a'],
    ['128-character entity id', 'a'.repeat(128)],
  ])('accepts a %s from the Market URI builder', (_, listingId) => {
    const uri = buildMarketUri(SELLER, 'listing', listingId);

    expect(() => validateWatchlistItem(listingId)).not.toThrow();
    expect(parseListingUri(uri)).toEqual({ sellerPubky: SELLER, listingId });
  });

  // The spec URI builder interpolates IDs without validating them. Shop enforces its transaction-service ID rules.
  it.each([
    ['slash', 'listing/id'],
    ['dot', 'listing.id'],
    ['empty', ''],
    ['129-character entity id', 'a'.repeat(129)],
  ])('enforces the Shop ID rules for %s', (_, listingId) => {
    const uri = buildMarketUri(SELLER, 'listing', listingId);

    expect(() => validateWatchlistItem(listingId)).toThrow();
    expect(parseListingUri(uri)).toBeNull();
  });
});
