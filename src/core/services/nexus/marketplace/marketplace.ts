import { buildMarketUri } from 'pubky-market-specs';
import { z } from 'zod';
import { MARKETPLACE_ATTESTOR_REQUEST_TIMEOUT_MS } from '@/config/commerce';
import { ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
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
export type MarketplaceTagPage = { tags: NexusTag[]; completeResource: boolean; probeFailure?: unknown };

const resourceTagSchema = z.object({
  label: z.string(),
  taggers: z.array(z.string()),
  taggers_count: z.number().int().nonnegative(),
  tag_uri: z.string().nullish(),
});

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
    return this.fetchTags(
      buildMarketUri(params.seller_id, 'listing', params.listing_id),
      params,
      marketplaceApi.listingTags(params),
    );
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
    return this.fetchTags(buildMarketUri(params.seller_id, 'shop'), params, marketplaceApi.shopTags(params));
  }

  private static async fetchTags(uri: string, params: TShopTagsParams, legacyUrl: string): Promise<MarketplaceTagPage> {
    let canonical: boolean;
    try {
      canonical = await socialNexusServesV1();
    } catch (probeFailure) {
      // During backfill a separate Market index still holds valid historical tags.
      // After cutover it may contain deleted tags and cannot substitute for the social index.
      if (getMarketplaceTagsBackfilled()) throw probeFailure;
      const tags = await queryNexus<NexusTag[]>({ url: legacyUrl }).catch(() => {
        throw probeFailure;
      });
      return { tags, completeResource: false, probeFailure };
    }
    if (canonical) return this.fetchResourceTags(uri, params);
    const tags = await queryNexus<NexusTag[]>({ url: legacyUrl });
    return { tags, completeResource: false };
  }

  /** On a v1 Nexus a missing resource has no tags. Only a fully backfilled aggregate can remove old local labels. */
  private static async fetchResourceTags(
    uri: string,
    { skip_tags, limit_tags, viewer_id }: TShopTagsParams,
  ): Promise<MarketplaceTagPage> {
    const backfilled = getMarketplaceTagsBackfilled();
    const fetchAll = backfilled && skip_tags === undefined && limit_tags === undefined;
    const limit = limit_tags ?? (fetchAll ? 100 : 5);
    let skip = skip_tags ?? 0;
    const tags = new Map<string, NexusTag>();
    // Nexus accepts skip_tags up to 10,000. A larger aggregate remains partial.
    do {
      const url = buildUrlWithQuery({
        baseRoute: 'v1/resource/by-uri',
        params: { uri, skip_tags: skip, limit_tags: limit, viewer_id },
      });
      const view = await fetchNexusIfFound<unknown>({ url });
      if (view === null) return { tags: [], completeResource: backfilled && !skip_tags };
      const page = z.object({ tags: z.array(resourceTagSchema).max(limit) }).safeParse(view);
      if (!page.success) {
        throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'Invalid resource tag page', {
          service: ErrorService.Nexus,
          operation: 'fetchResourceTags',
        });
      }
      let shifted = false;
      for (const tag of page.data.tags) {
        if (tags.has(tag.label)) shifted = true;
        tags.set(tag.label, { ...tag, relationship: tag.tag_uri != null });
      }
      // A repeated label means the popularity order changed between offset reads.
      // Keep previous labels until a stable traversal can confirm which ones disappeared.
      if (shifted || page.data.tags.length < limit) {
        return { tags: [...tags.values()], completeResource: !shifted && backfilled && !skip_tags };
      }
      skip += limit;
    } while (fetchAll && skip <= 10_000);
    return { tags: [...tags.values()], completeResource: false };
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
   * Single-attempt read of a subject's reputation aggregate. A 404 means no
   * review is indexed for the subject in that role — the explicit "New seller"
   * state, which callers must render as absence, never 0.0 — so a 404 resolves
   * to `null` without retrying or reporting an error.
   *
   * @param params - Subject path param plus role filter
   * @returns The reputation summary as currently indexed, or `null` on 404
   */
  static async fetchShopReputation(params: TShopReputationParams): Promise<NexusReputationSummary | null> {
    return await fetchNexusIfFound<NexusReputationSummary>({
      url: marketplaceApi.shopReputation(params),
    });
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
