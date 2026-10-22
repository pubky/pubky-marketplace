/**
 * Nexus marketplace types
 *
 * Mirror the response shapes served by the Nexus marketplace index
 * (`nexus-common/src/models/marketplace/*` on the `feat/marketplace-indexing`
 * branch of pubky-nexus). Field names are snake_case exactly as serialized by
 * Nexus; enum values follow the snake_case serde renames in `pubky-app-specs`.
 *
 * These are lossy read projections of the owner-signed homeserver records —
 * they carry the record's media URIs (`media_urls`) but none of the per-media
 * metadata (type, dimensions, alt text), no variants, shipping options, or
 * return policy, so they can never be written into the `commerce_listings` /
 * `commerce_shops` record caches directly. The homeserver stays canonical for record content
 * (ADR-0020); Nexus provides discovery, ordering, and revision freshness.
 *
 * The projection does carry the sale terms a catalog card needs: the primary
 * price (the unit price for fixed-price listings, the starting price for
 * auctions) and, for auctions, the `auction_*` term fields. It never carries
 * live auction state (current bid, bid count) — bids live in the transaction
 * service's listing projection, not in the listing record Nexus indexes.
 */

export type NexusListingState = 'active' | 'paused' | 'ended' | 'removed';

/**
 * The compact reputation object Nexus embeds in listing stream entries, the
 * single-listing projection, and shop views (ADR 0024 §9): cards render
 * stars with zero additional requests.
 *
 * Truth basis: `count` covers every indexed review of the scope;
 * `verified_count` is the subset whose embedded purchase attestation
 * cryptographically verified at ingest (compact-JWS parse, Ed25519
 * signature against the self-certifying `iss` pubky, claims bound to the
 * review). `avg` averages the overall stars of ALL indexed reviews —
 * verified and labeled-unverified alike (ratified D5). Absence of the whole
 * object means "no indexed reviews", the explicit New-seller state — never
 * to be rendered as 0.0.
 *
 * `buckets` and `unverified_count` carry the counting rules v2 figures
 * (index release IX2); older indexes omit both.
 */
export type NexusReputationSnippet = {
  avg: number;
  count: number;
  verified_count: number;
  buckets?: Record<string, NexusReputationBucket>;
  unverified_count?: number;
};

/**
 * The counting rules v2 figures of one set of counted reviews: one
 * attestor's verified reviews of a scope that carry an attestation `iat`,
 * are not superseded and are not excluded by moderation (a trust bucket), or
 * the exact figure over `attestors=` windows. `orders` counts distinct
 * `(attestor, order_ref)`; `histogram[0]` holds 1-star counts. The
 * `seller_*` fields appear only on the buyer-reviewing-seller subject scope.
 */
export type NexusReputationBucket = {
  orders: number;
  buyers: number;
  sum_buyer_means: number;
  weighted_sum: number;
  weight_total: number;
  histogram: [number, number, number, number, number];
  first_iat: number | null;
  last_iat: number | null;
  seller_buyers?: number;
  sum_seller_buyer_means?: number;
};

/** Review direction as serialized by pubky-app-specs. */
export type NexusReviewRole = 'buyer_reviewing_seller' | 'seller_reviewing_buyer';

/**
 * How the index's moderation treats a review. `text_hidden`: the moderator
 * hid the text and the review still counts. `excluded`: the review is fraud
 * and leaves every aggregate. `reason` is the moderator's label.
 */
export type NexusReviewModerationState = 'text_hidden' | 'excluded';

export type NexusReviewModeration = {
  state: NexusReviewModerationState;
  reason: string;
};

/**
 * One indexed marketplace review as served inside `GET v0/shop/{seller}/reviews`
 * and `GET v0/listing/{seller}/{listing}/reviews` entries.
 *
 * `verified` is a cryptographic fact — the attestation parsed, verified
 * against `attestor_id` (its `iss` pubky), and bound to this review — never
 * a trust statement: WHO counts as a trusted attestor is client policy.
 * `edited_late` flags records revised beyond the marketplace's 24h edit
 * window (the window is app policy; the record is user property; Nexus
 * surfaces the divergence instead of hiding it).
 */
export type NexusReviewDetails = {
  review_id: string;
  uri: string;
  reviewer_id: string;
  subject_id: string;
  listing_owner_id: string;
  listing_id: string;
  role: NexusReviewRole;
  rating_overall: number;
  rating_item_accuracy: number | null;
  rating_shipping: number | null;
  rating_communication: number | null;
  text: string;
  verified: boolean;
  attestor_id: string | null;
  order_ref: string | null;
  /**
   * The attestation's `iat` (seconds) and price weight (1–5); `null` when
   * the review is unverified. Indexes before IX2 omit both.
   */
  iat?: number | null;
  price_weight?: number | null;
  edited_late: boolean;
  created_at: string;
  updated_at: string;
  revision: number;
  indexed_at: number;
  /**
   * `null` when the review is not moderated; `text` is `""` whenever it is
   * set. Indexes older than review moderation omit the field, which means
   * the same as `null`.
   */
  moderation?: NexusReviewModeration | null;
};

/**
 * The subject's response record joined to a review (subject-only, one
 * revisable response per review — ratified D7; Nexus only indexes responses
 * whose owner is the review's subject).
 */
export type NexusReviewResponseDetails = {
  review_id: string;
  responder_id: string;
  reviewer_id: string;
  review_uri: string;
  text: string;
  created_at: string;
  updated_at: string;
  revision: number;
  indexed_at: number;
};

/** One entry of a paged review list: the review plus its joined response. */
export type NexusReviewView = {
  review: NexusReviewDetails;
  response: NexusReviewResponseDetails | null;
};

/**
 * The order of a review list (index release IX4): `newest` is newest indexed
 * first (the default), `value` the highest `price_weight` first, then the
 * rating in either direction; ties go newest first.
 */
export type NexusReviewSort = 'newest' | 'value' | 'rating_desc' | 'rating_asc';

/**
 * What an index served over every match of a filtered or sorted review
 * stream, under counting rules v2 (IX4). The seller-scope fields come with
 * the seller stream only. The Shop's sort does not read it: header figures
 * stay the counted figures of the whole scope.
 */
export type NexusReviewsMatched = {
  buyers: number;
  orders: number;
  avg: number | null;
  seller_buyers?: number;
  seller_avg?: number | null;
};

/**
 * A review stream answer: a bare list while the request carries no filter or
 * sort parameter (and always from an index before IX4), the `{reviews,
 * matched}` envelope once one is present.
 */
export type NexusReviewStream = NexusReviewView[] | { reviews: NexusReviewView[]; matched: NexusReviewsMatched };

/**
 * The full reputation aggregate from `GET v0/shop/{seller}/reputation`.
 * `histogram[0]` holds 1-star counts. `attestors` breaks verified counts
 * down per attestor pubky so consumers can apply their own trust list.
 * The endpoint answers 404 when no review is indexed for the subject —
 * the explicit New-seller state.
 */
export type NexusReputationSummary = {
  count: number;
  verified_count: number;
  avg: number;
  histogram: [number, number, number, number, number];
  avg_item_accuracy: number | null;
  avg_shipping: number | null;
  avg_communication: number | null;
  response_count: number;
  edited_late_count: number;
  attestors: Record<string, number>;
  last_reviewed_at: string | null;
  buckets?: Record<string, NexusReputationBucket>;
  unverified_count?: number;
  /** The exact figure over the request's `attestors=` windows; present only with the parameter. */
  scoped?: NexusReputationBucket;
};

export type NexusListingCondition = 'new' | 'like_new' | 'excellent' | 'good' | 'fair' | 'for_parts';

export type NexusListingSaleFormat = 'fixed_price' | 'auction';

/**
 * The fulfillment vocabulary Nexus echoes from the listing record: item
 * types (`physical` | `digital`) plus fulfillment methods (`shipping` |
 * `pickup`). A both-ways pickup listing carries `shipping` explicitly
 * alongside `pickup` (local pickup design §A1/§A2), so the wire accepts it.
 */
export type NexusFulfillmentMethod = 'physical' | 'digital' | 'shipping' | 'pickup';

export type NexusSortOrder = 'ascending' | 'descending';

/**
 * Property the listing stream is sorted by. `timeline` (the server default)
 * orders by indexing time; `ends_at` orders auction listings by auction end
 * time and excludes fixed-price listings entirely.
 */
export type NexusListingStreamSorting = 'timeline' | 'ends_at';

/**
 * One indexed listing as returned by `GET v0/stream/listings` and `GET v0/listing/{seller_id}/{listing_id}`.
 *
 * The five `auction_*` fields are the auction sale terms and are all `null`
 * for fixed-price listings. The `*_minor` amounts are minor units of the
 * listing's primary asset (`price_currency` / `price_exponent`). Auction
 * listings indexed before Nexus carried these fields serve `null` for all
 * five until re-indexed, so an auction row with null terms is a legal stale
 * state, not a protocol violation.
 *
 * `state` is the state the index serves. A seller's record keeps `active`
 * after an auction closes, so an index that derives state reports the auction
 * as `ended` from `auction_ends_at` on, while an index that does not still
 * reports `active`. Read it through `effectiveListingState`, which applies the
 * same rule on the client.
 */
export type NexusListingDetails = {
  id: string;
  uri: string;
  owner_id: string;
  indexed_at: number;
  state: NexusListingState;
  title: string;
  description: string;
  category_id: string;
  condition: NexusListingCondition;
  tags: string[];
  country_code: string;
  region: string | null;
  media_urls: string[];
  sale_format: NexusListingSaleFormat;
  price_amount_minor: number;
  price_currency: string;
  price_exponent: number;
  auction_starts_at: string | null;
  auction_ends_at: string | null;
  auction_buy_now_price_minor: number | null;
  auction_minimum_increment_minor: number | null;
  fulfillment_methods: NexusFulfillmentMethod[];
  adult_only: boolean;
  created_at: string;
  updated_at: string;
  revision: number;
  /**
   * Seller-scoped reputation (buyer reviews across all their listings).
   * Omitted entirely by Nexus when the seller has no indexed review, and
   * absent from rows served by a Nexus deployed before reputation indexing —
   * both are the honest-absence state, never zeros.
   */
  reputation?: NexusReputationSnippet;
  /** Listing-scoped reputation (buyer reviews of this listing). Same absence semantics. */
  listing_reputation?: NexusReputationSnippet;
  /**
   * Single-listing projection only, with `attestors=`: the exact figures of
   * the seller's and of this listing's counted reviews inside the windows.
   */
  scoped_reputation?: NexusReputationBucket;
  scoped_listing_reputation?: NexusReputationBucket;
};

/**
 * Query parameters accepted by `GET v0/stream/listings`.
 *
 * `min_price` / `max_price` are expressed in major units and Nexus rejects
 * them unless `currency` is also provided. `category` is an exact match on
 * the kebab-case category id. `limit` is capped server-side at 30.
 * `sorting=ends_at` returns only auction listings; combine with
 * `order=ascending` for an "ending soon" stream. `state=active` excludes an
 * auction whose end time has passed on an index that derives state; the
 * catalog also drops such rows itself because cached rows outlive the query.
 */
export type TListingStreamParams = {
  seller_id?: string;
  category?: string;
  condition?: NexusListingCondition;
  sale_format?: NexusListingSaleFormat;
  state?: NexusListingState;
  min_price?: number;
  max_price?: number;
  currency?: string;
  /** Seller-declared item location: ISO-3166-1 alpha-2 country code. */
  country?: string;
  order?: NexusSortOrder;
  sorting?: NexusListingStreamSorting;
  skip?: number;
  limit?: number;
  start?: number;
  end?: number;
};

/** Path params for `GET v0/listing/{seller_id}/{listing_id}` (single indexed listing). */
export type TListingDetailsParams = {
  seller_id: string;
  listing_id: string;
  /** Trusted attestor windows (`attestorWindowsParam`); adds the `scoped_*` figures. */
  attestors?: string;
};

/**
 * Query parameters for `GET v0/listing/{seller_id}/{listing_id}/tags`.
 * Mirrors the post tag endpoint's pagination/viewer contract
 * (`GET v0/post/{author}/{post}/tags`).
 */
export type TListingTagsParams = {
  seller_id: string;
  listing_id: string;
  limit_tags?: number;
  skip_tags?: number;
  viewer_id?: string;
};

/** Query parameters for `GET v0/shop/{seller_id}/tags`. */
export type TShopTagsParams = {
  seller_id: string;
  limit_tags?: number;
  skip_tags?: number;
  viewer_id?: string;
};

/** Path params excluded from tag endpoint query strings. */
export const MARKETPLACE_TAGS_PATH_PARAMS = ['seller_id', 'listing_id'];

/**
 * Query parameters for `GET v0/shop/{seller_id}/reviews`. `role` defaults
 * server-side to `buyer_reviewing_seller` (the public seller-reputation
 * surface); `seller_reviewing_buyer` exists for negotiation contexts only
 * (ratified D8) and must never build public buyer profiles.
 */
export type TShopReviewsParams = {
  seller_id: string;
  role?: NexusReviewRole;
  skip?: number;
  limit?: number;
  sort?: NexusReviewSort;
};

/** Path/query params for `GET v0/shop/{seller_id}/reputation`. */
export type TShopReputationParams = {
  seller_id: string;
  role?: NexusReviewRole;
  /**
   * `<pubky>:<from>:<until>,…` (seconds over the attestation `iat`, either
   * end may be empty, at most 20 entries; empty is a 400). Adds `scoped`.
   * Indexes before IX2 ignore it.
   */
  attestors?: string;
};

/** Path/query params for `GET v0/listing/{seller_id}/{listing_id}/reviews`. */
export type TListingReviewsParams = {
  seller_id: string;
  listing_id: string;
  skip?: number;
  limit?: number;
  sort?: NexusReviewSort;
};

/** The kinds of outcome an attestor records against an attested order. */
export type NexusAttestorOutcomeKind = 'refunded' | 'returned';

/**
 * An attestor's profile as `GET v0/marketplace/attestor/{attestor_id}/profile`
 * serves it (index release IX5). `record` is the profile exactly as
 * published, `proof` included, and verifies offline against the profile URI of
 * `attestor_id`. `key_windows` is the index's reading of the record's `keys`
 * (whole seconds, rounded up); the Shop narrows trust from the verified
 * `record`, never from this derived field.
 */
export type NexusAttestorProfile = {
  attestor_id: string;
  uri: string;
  key_windows: {
    pubky: string;
    valid_from: number;
    valid_until: number | null;
    compromised_from: number | null;
  }[];
  record: unknown;
  indexed_at: number;
};

/**
 * One attestor annotation of an attested order, as an entry of
 * `GET v0/marketplace/attestor/{attestor_id}/annotations`. `record` is the
 * annotation exactly as published and verifies offline; the Shop reads the
 * outcomes from it rather than from the derived `outcomes`.
 */
export type NexusAttestorAnnotation = {
  attestor_id: string;
  order_ref: string;
  uri: string;
  outcomes: { kind: NexusAttestorOutcomeKind; on: string }[];
  revision: number;
  record: unknown;
  indexed_at: number;
};

/** Path params for `GET v0/marketplace/attestor/{attestor_id}/profile`. */
export type TAttestorProfileParams = {
  attestor_id: string;
};

/**
 * Path/query params for `GET v0/marketplace/attestor/{attestor_id}/annotations`:
 * at most 100 order refs per request, answered as an array aligned with them.
 */
export type TAttestorAnnotationsParams = {
  attestor_id: string;
  order_refs: readonly string[];
};

/** Path params excluded from attestor endpoint query strings. */
export const MARKETPLACE_ATTESTOR_PATH_PARAMS = ['attestor_id'];
