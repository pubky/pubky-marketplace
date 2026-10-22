import { MARKETPLACE_ATTESTOR_REQUEST_TIMEOUT_MS } from '@/config/commerce';
import { marketplaceApi } from '@/services/nexus/marketplace/marketplace.api';
import type {
  NexusAttestorAnnotation,
  NexusAttestorProfile,
  NexusListingDetails,
  NexusReputationSummary,
  NexusReviewStream,
  TAttestorAnnotationsParams,
  TAttestorProfileParams,
  TListingDetailsParams,
  TListingReviewsParams,
  TListingStreamParams,
  TListingTagsParams,
  TShopReputationParams,
  TShopReviewsParams,
  TShopTagsParams,
} from '@/services/nexus/marketplace/marketplace.types';
import type { NexusTag } from '@/services/nexus/nexus.types';
import { fetchNexus, fetchNexusIfFound, queryNexus } from '@/services/nexus/nexus.utils';

/**
 * Nexus Marketplace Service
 *
 * Read-only access to the Nexus marketplace index. Responses are lossy
 * projections used for discovery; canonical record content is fetched from
 * the owner's homeserver (see `CommerceApplication`).
 */
export class NexusMarketplaceService {
  private constructor() {}

  /**
   * Fetches a page of indexed listings, newest-indexed first by default.
   *
   * @param params - Server-side filters and pagination (see `TListingStreamParams`)
   * @returns Array of listing projections; empty when nothing matches
   */
  static async fetchListingStream(params: TListingStreamParams = {}): Promise<NexusListingDetails[]> {
    return await queryNexus<NexusListingDetails[]>({ url: marketplaceApi.listingStream(params) });
  }

  /**
   * Fetches one indexed listing's projection — the watchlist's bounded
   * per-item freshness read (revision, price, state, auction deadline).
   * 404s propagate; the caller decides whether "not indexed" is meaningful.
   *
   * @param params - Seller/listing path params
   * @returns The listing projection as currently indexed by Nexus
   */
  static async fetchListingDetails(params: TListingDetailsParams): Promise<NexusListingDetails> {
    return await queryNexus<NexusListingDetails>({ url: marketplaceApi.listingDetails(params) });
  }

  /**
   * Single-attempt read of one indexed listing projection. `queryNexus`
   * retries a 404 five times with backoff because Nexus indexes
   * asynchronously; a caller that already holds a homeserver 404 and only
   * needs to know whether the index still lists the record cannot wait out
   * that backoff. Errors propagate unchanged.
   *
   * @param params - Seller/listing path params
   * @returns The listing projection as currently indexed by Nexus
   */
  static async fetchListingDetailsOnce(params: TListingDetailsParams): Promise<NexusListingDetails> {
    return await fetchNexus<NexusListingDetails>({ url: marketplaceApi.listingDetails(params) });
  }

  /**
   * Fetches the community tag aggregate for a listing.
   *
   * Served by the marketplace Nexus (tag aggregation deployed 2026-08-28,
   * `308b985e`); a 404 means this deployment lacks the endpoint and callers
   * degrade to local-only tags.
   *
   * @param params - Seller/listing path params plus pagination and viewer id
   * @returns Array of tag aggregates (empty when the listing has no tags)
   */
  static async fetchListingTags(params: TListingTagsParams): Promise<NexusTag[]> {
    return await queryNexus<NexusTag[]>({ url: marketplaceApi.listingTags(params) });
  }

  /**
   * Fetches the community tag aggregate for a shop.
   *
   * Same deployment caveat as `fetchListingTags`.
   *
   * @param params - Seller path param plus pagination and viewer id
   * @returns Array of tag aggregates (empty when the shop has no tags)
   */
  static async fetchShopTags(params: TShopTagsParams): Promise<NexusTag[]> {
    return await queryNexus<NexusTag[]>({ url: marketplaceApi.shopTags(params) });
  }

  /**
   * Fetches a page of indexed reviews about a subject (with joined subject
   * responses). Served once the reputation-indexing Nexus is deployed; a
   * 404 from an older deployment propagates and callers degrade to
   * rendering no review section at all.
   *
   * @param params - Subject path param plus role filter, pagination and sort
   * @returns Review page entries, newest-indexed first unless a sort was
   *   requested (empty when none); an envelope when the request carried a sort
   */
  static async fetchShopReviews(params: TShopReviewsParams): Promise<NexusReviewStream> {
    return await queryNexus<NexusReviewStream>({ url: marketplaceApi.shopReviews(params) });
  }

  /**
   * Fetches the full reputation aggregate of a subject. Answers 404 when no
   * review is indexed for the subject in that role — the explicit
   * "New seller" state, which callers must render as absence, never 0.0.
   *
   * @param params - Subject path param plus role filter
   * @returns The reputation summary as currently indexed
   */
  static async fetchShopReputation(params: TShopReputationParams): Promise<NexusReputationSummary> {
    return await queryNexus<NexusReputationSummary>({ url: marketplaceApi.shopReputation(params) });
  }

  /**
   * Fetches a page of indexed buyer reviews of one listing (with joined
   * seller responses). Same deployment caveat as `fetchShopReviews`.
   *
   * @param params - Seller/listing path params plus pagination and sort
   * @returns Review page entries, newest-indexed first unless a sort was
   *   requested (empty when none); an envelope when the request carried a sort
   */
  static async fetchListingReviews(params: TListingReviewsParams): Promise<NexusReviewStream> {
    return await queryNexus<NexusReviewStream>({ url: marketplaceApi.listingReviews(params) });
  }

  /**
   * Single-attempt read of an attestor's indexed profile. `queryNexus` would
   * retry a 404 with backoff and report it as an error, but an attestor that
   * has not published (or an index without the route) is an ordinary answer
   * here, so a 404 resolves to `null` without an error.
   *
   * @param params - Attestor path param
   * @returns The profile with its served `record` (proof included), or `null`
   *   when the index has none
   */
  static async fetchAttestorProfile(params: TAttestorProfileParams): Promise<NexusAttestorProfile | null> {
    return await fetchNexusIfFound<NexusAttestorProfile>({
      url: marketplaceApi.attestorProfile(params),
      timeoutMs: MARKETPLACE_ATTESTOR_REQUEST_TIMEOUT_MS,
    });
  }

  /**
   * Single-attempt read of an attestor's annotations for up to 100 order
   * refs (the caller chunks longer lists). Same absence semantics as
   * `fetchAttestorProfile`: a 404 means the index does not serve the route.
   *
   * @param params - Attestor path param and the order refs to ask for
   * @returns One entry per requested order ref, in request order, `null`
   *   where the index holds no annotation; `null` for the whole answer when
   *   the route is missing
   */
  static async fetchAttestorAnnotations(
    params: TAttestorAnnotationsParams,
  ): Promise<(NexusAttestorAnnotation | null)[] | null> {
    return await fetchNexusIfFound<(NexusAttestorAnnotation | null)[]>({
      url: marketplaceApi.attestorAnnotations(params),
      timeoutMs: MARKETPLACE_ATTESTOR_REQUEST_TIMEOUT_MS,
    });
  }
}
