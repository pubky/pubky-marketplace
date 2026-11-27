/**
 * Parsing for canonical marketplace listing URIs
 * (`pubky://<sellerPubky>/pub/pubky.app/marketplace/v1/listings/<listingId>`),
 * the form produced by the Market spec for a listing.
 */

import { commerceEntityIdSchema, commercePubkySchema } from './transaction-contracts';

const LISTING_URI_PATTERN = /^pubky:\/\/([^/]+)\/pub\/pubky\.app\/marketplace\/v1\/listings\/([^/]+)$/;

export interface ListingUriRef {
  sellerPubky: string;
  listingId: string;
}

/**
 * Parses a canonical listing URI into its seller pubky and listing id.
 * Returns null for anything that is not an exact canonical listing URI
 * (post URIs, malformed strings, extra path segments, etc.).
 */
export function parseListingUri(uri: string): ListingUriRef | null {
  const match = LISTING_URI_PATTERN.exec(uri);
  if (!match) return null;
  if (!commercePubkySchema.safeParse(match[1]).success || !commerceEntityIdSchema.safeParse(match[2]).success) {
    return null;
  }
  return { sellerPubky: match[1], listingId: match[2] };
}
