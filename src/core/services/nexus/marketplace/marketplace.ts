import { buildMarketUri } from 'pubky-market-specs';
import { MARKETPLACE_ATTESTOR_REQUEST_TIMEOUT_MS } from '@/config/commerce';
import { getMarketplaceTagsBackfilled } from '@/libs/runtime-config/runtime-config';
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
import { buildUrlWithQuery, fetchNexus, fetchNexusIfFound, queryNexus } from '@/services/nexus/nexus.utils';
import { socialNexusServesV1 } from '@/services/nexus/social-v1';

/** A complete first page is authoritative only after historical Market tags were backfilled. */
export type MarketplaceTagPage = { tags: NexusTag[]; completeResource: boolean };

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
   * A v1 social Nexus indexes the canonical resource URI across epochs.
   * Before cutover the Marketplace index supplies its legacy projection.
   *
   * @param params - Seller/listing path params plus pagination and viewer id
   * @returns A tag page and whether it contains the complete canonical aggregate
   */
  static async fetchListingTags(params: TListingTagsParams): Promise<MarketplaceTagPage> {
    if (await socialNexusServesV1()) {
      return this.fetchResourceTags(buildMarketUri(params.seller_id, 'listing', params.listing_id), params);
    }
    const tags = await queryNexus<NexusTag[]>({ url: marketplaceApi.listingTags(params) });
    return { tags, completeResource: false };
  }

  /**
   * Fetches the community tag aggregate for a shop.
   *
   * Same deployment caveat as `fetchListingTags`.
   *
   * @param params - Seller path param plus pagination and viewer id
   * @returns A tag page and whether it contains the complete canonical aggregate
   */
  static async fetchShopTags(params: TShopTagsParams): Promise<MarketplaceTagPage> {
    if (await socialNexusServesV1()) {
      return this.fetchResourceTags(buildMarketUri(params.seller_id, 'shop'), params);
    }
    const tags = await queryNexus<NexusTag[]>({ url: marketplaceApi.shopTags(params) });
    return { tags, completeResource: false };
  }

  /** On a v1 Nexus a missing resource has no tags. Its old Market projection may still contain removed tags. */
  private static async fetchResourceTags(uri: string, { skip_tags = 0, limit_tags = 5, viewer_id }: TShopTagsParams) {
    const url = buildUrlWithQuery({
      baseRoute: 'v1/resource/by-uri',
      params: { uri, skip_tags, limit_tags, viewer_id },
    });
    const view = await fetchNexusIfFound<{ tags: (Omit<NexusTag, 'relationship'> & { tag_uri: string | null })[] }>({
      url,
    });
    const tags = (view?.tags ?? []).map((tag) => ({ ...tag, relationship: tag.tag_uri != null }));
    return { tags, completeResource: getMarketplaceTagsBackfilled() && skip_tags === 0 && tags.length < limit_tags };
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
   *   or a reviewer filter
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
   *   or a reviewer filter
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
      ioEndpoint: 'v0/marketplace/attestor/:attestor_id/profile',
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
      ioEndpoint: 'v0/marketplace/attestor/:attestor_id/annotations',
    });
  }
}
