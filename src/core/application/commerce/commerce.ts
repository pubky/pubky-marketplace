import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { GrantSession } from '@synonymdev/pubky';
import { z } from 'zod';
import { CommerceAttentionSeenApplication } from '@/application/commerce/attention-seen';
import { CommerceInventoryApplication } from '@/application/commerce/inventory';
import { CommercePrivKeyringApplication } from '@/application/commerce/priv-keyring';
import { TagKind } from '@/application/tag/tag.types';
import {
  COMMERCE_SAVED_SEARCH_MAX_PER_OWNER,
  COMMERCE_WATCH_CHECK_MAX_ITEMS,
  COMMERCE_WATCH_ENDING_SOON_THRESHOLD_MS,
  getCommerceAdapterMode,
  getMarketplaceUrl,
  getPaykitServerApi,
  getUsdtPaymentsEnabled,
  isDurableCommerceMode,
  isTransactionalCommerceMode,
  MARKETPLACE_FOLLOWED_SHELF_MAX_SELLER_FETCHES,
} from '@/config/commerce';
import { CONNECTOR_SHARE_CONSENT_VERSION } from '@/config/commerce-copy';
import { BASE_UNITS_PER_BITCOIN } from '@/config/currencies';
import { NEXUS_LISTINGS_PER_PAGE } from '@/config/nexus';
import { readAuthEpoch } from '@/controllers/auth/auth-epoch';
import { withExclusiveLock } from '@/libs/chat/web-locks';
import {
  extractReviewAttestation,
  extractReviewAttestations,
  type MarketplaceAttestation,
  marketplaceAttestationSchema,
  type MarketplaceItemAttestation,
  readReviewAttestationPending,
  readReviewResultPending,
  verifyOrderReceiptClaims,
  verifyOwnDropEdition,
  verifyOwnOrderReceipt,
  verifyOwnReviewAttestation,
} from '@/libs/commerce/attestation';
import { isAuctionSaleEnded } from '@/libs/commerce/auction-phase';
import {
  AUCTION_HAS_BIDS_MESSAGE,
  AUCTION_HAS_BIDS_REFUSAL,
  bidsBlockingDelete,
} from '@/libs/commerce/auction-removal';
import { decodeConnectorRecipientKey, sealConnectorAddress } from '@/libs/commerce/connector-address-envelope';
import {
  sealDeliveryAddressForSellers,
  type SellerDeliveryEnvelope,
  type SellerDeliveryKey,
} from '@/libs/commerce/delivery-envelope';
import {
  DIGITAL_DELIVERY_COPY,
  type DigitalFileOpenFailure,
  hasInstantDigitalLines,
  type MarketplaceDigitalDeliveryCapability,
  type MarketplaceDigitalDeliveryChannel,
  type MarketplaceDigitalDeliveryInput,
  type MarketplaceDigitalDeliverySet,
  type MarketplaceOrderDeliveryEmail,
  type MarketplaceOrderDigitalDelivery,
  type MarketplaceOrderDigitalEvidence,
  type MarketplaceOrderDigitalLine,
  type MarketplaceSellerDigitalDelivery,
} from '@/libs/commerce/digital';
import {
  digitalCiphertextBytes,
  digitalDeliverableUrl,
  digitalFileContentType,
  digitalFileName,
  encryptDigitalDeliverable,
  newDigitalDeliverableId,
  openDigitalDeliverable,
} from '@/libs/commerce/digital-file';
import { listingPublishNeedsMarketplaceSession } from '@/libs/commerce/listing-publish-guards';
import { buildRegisterVariants, type RegisterListingVariant } from '@/libs/commerce/listing-variants';
import { locksAdmissionView } from '@/libs/commerce/locks-lifecycle';
import { lockPolicyCreator, toBareLockResource } from '@/libs/commerce/locks-payment';
import {
  assertReserveFreePublicRecord,
  type CommerceDigitalLock,
  type CommerceDropRecord,
  commerceListingFulfillmentMethods,
  type CommerceListingRecord,
  commerceListingShippingMinor,
  type CommerceOrderReceiptRecord,
  commerceReviewRecordSchema,
  type CommerceShopRecord,
  type CommerceWatchlistRecord,
  findForbiddenPublicReserveKey,
  stripForbiddenPublicReserveKeys,
} from '@/libs/commerce/marketplace-records';
import {
  listingIdFromAggregate,
  orderReviewListings,
  reviewListingAggregateId,
  reviewOfListing,
  reviewsOfReviewer,
} from '@/libs/commerce/order-reviews';
import {
  PAYKIT_ENDPOINT_MAX_BYTES,
  PAYKIT_REFUND_MAX_APPS,
  paykitEndpointUrl,
  paykitRegistryAppIds,
  USDT_ARBITRUM_ENDPOINT_ID,
  usdtAddressFromEndpointPayload,
} from '@/libs/commerce/paykit-refund-endpoint';
import {
  appRegistryTakesPaymentRequests,
  type BuyerPaykitWallet,
  foundAppRegistryShowsNewWallet,
  PAYKIT_APP_REGISTRY_PATH,
  PAYKIT_READER_AUTHORIZATION_PATH,
  paykitAppRegistryUrl,
  paykitReaderAuthorizationUrl,
} from '@/libs/commerce/paykit-wallet';
import {
  PAYMENT_METHOD_DISCOVERY_CONCURRENCY,
  PAYMENT_METHOD_SELLERS_MAX_PAGES,
  type PaymentMethodFilter,
  type PaymentMethodSellersPage,
} from '@/libs/commerce/payment-method-filter';
import type { BindDeliveryAddress, PaymentMethodKind, SellerPaymentConfig } from '@/libs/commerce/payment-methods';
import {
  type MarketplaceCheckoutFulfillmentLine,
  type MarketplaceFulfillmentMethod,
  type MarketplacePickupDetails,
  type MarketplacePickupReveal,
  type MarketplaceSellerPickupDetails,
  pickupRefusalFailureMessage,
  resolveCheckoutFulfillment,
} from '@/libs/commerce/pickup';
import {
  assertPrivKeyringLive,
  isPrivKeyringRevoked,
  PRIV_V1_LOG_PATH,
  privEntryUrl,
  privErrorSummary,
  type PrivKeyring,
} from '@/libs/commerce/priv-envelope';
import type { MarketplacePrivKeysResult } from '@/libs/commerce/priv-keys';
import { attestorWindowsParam } from '@/libs/commerce/review-counting';
import type { MarketplaceReviewSortParam } from '@/libs/commerce/review-sort';
import { createCommerceSandboxCatalog } from '@/libs/commerce/sandbox-catalog';
import {
  autoConfirmableRail,
  mayAwaitSellerConfirmation,
  SELLER_AUTO_CONFIRM_REASON,
} from '@/libs/commerce/seller-auto-confirm';
import { isAssignedCountryCode, publishedCountryCode } from '@/libs/commerce/ships-to';
import {
  buildMarketplaceCheckoutAggregateId,
  buildMarketplaceDropAggregateId,
  buildMarketplaceListingAggregateId,
  buildMarketplaceOrderAggregateId,
  buildMarketplacePaymentAggregateId,
  classifyMarketplacePickupCommandRefusal,
  type ConnectorShare,
  type CreateMarketplaceCheckoutCommand,
  isCorrelatedBenignListingRegistrationResponse,
  isListingRecordNotFoundResponse,
  isSuccessfulListingRegistrationResponse,
  type MarketplaceCommand,
  type MarketplaceCommandResponse,
  orderIdFromMarketplaceAggregateId,
} from '@/libs/commerce/transaction-commands';
import type { CommerceJsonValue, CommerceMoney } from '@/libs/commerce/transaction-contracts';
import { assertPublishableListingStock } from '@/libs/commerce/unlimited-stock';
import { variantRefusalMessage } from '@/libs/commerce/variant-refusals';
import { AppError } from '@/libs/error/error';
import { AuthErrorCode, ClientErrorCode, ServerErrorCode, ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { hasHttpStatus, isAppError, isNotFound } from '@/libs/error/error.utils';
import { HttpMethod, HttpStatusCode } from '@/libs/http/http.types';
import { Logger } from '@/libs/logger/logger';
import { getRegionPolicy } from '@/libs/runtime-config/runtime-config';
import type {
  CommerceAuctionRegistrationCommand,
  CommerceCatalogEntryModelSchema,
  CommerceIndexedReview,
  CommerceListingModelSchema,
  CommerceListingProjectionModelSchema,
  CommerceReputationSnippet,
  CommerceReputationSummary,
  CommerceReviewModelSchema,
  CommerceReviewResponseModelSchema,
  CommerceSavedSearchModelSchema,
  CommerceSavedSearchParams,
  CommerceSyncJobModelSchema,
  CommerceWatchAlertModelSchema,
  CommerceWatchSnapshotModelSchema,
} from '@/models/commerce/commerce.schema';
import { selectFollowedSellersToRefresh } from '@/pipes/commerce/commerce.discovery';
import {
  type CommerceDeliveryAddressInput,
  CommerceRecordNormalizer,
  type CommerceShippingPresetInput,
} from '@/pipes/commerce/commerce.normalizer';
import {
  emptyWatchlistState,
  localRowsToWatchlistState,
  mergeWatchlistStates,
  watchlistRecordToState,
  watchlistStatesEqual,
  watchlistStateToRecordBody,
} from '@/pipes/commerce/commerce.watchlist';
import { buildDefaultShopRecord, DEFAULT_SHOP_COUNTRY_CODE } from '@/pipes/commerce/default-shop';
import {
  detectWatchAlerts,
  type WatchIndexObservation,
  type WatchObservation,
  type WatchProjectionObservation,
} from '@/pipes/marketplaceWatch/marketplaceWatch.detector';
import { buildFxRateSnapshot } from '@/pipes/money/money.rates';
import { MarketplaceMediaService } from '@/services/commerce/marketplace-media';
import { ExchangerateService } from '@/services/exchangerate/exchangerate';
import type { BtcRate } from '@/services/exchangerate/exchangerate.types';
import { CommerceHomeserverService } from '@/services/homeserver/commerce/commerce';
import { CommercePrivStoreService } from '@/services/homeserver/commerce/priv-store';
import { HomeserverService, PRIVATE_APP_DATA_PATH } from '@/services/homeserver/homeserver';
import type { THomeserverResourceEvent } from '@/services/homeserver/homeserver.types';
import { retryHomeserverWrite, retryHomeserverWriteAfterReread } from '@/services/homeserver/write-retry';
import { type CommerceListingRowGeneration, LocalCommerceService } from '@/services/local/commerce/commerce';
import {
  buildMarketplaceTagRowId,
  LocalMarketplaceTagService,
  type MarketplaceTagKind,
} from '@/services/local/tag/marketplace/tag.marketplace';
import { LocksGatewayService } from '@/services/locks/locks';
import { RetiredLocksSessionStorage } from '@/services/locks/retired-locks-session';
import {
  MarketplaceGatewayService,
  type MarketplaceNotificationEntry,
  type MarketplaceOrder,
  type MarketplacePayment,
} from '@/services/marketplace/marketplace';
import { MarketplaceConnectorStatusService } from '@/services/marketplace/marketplace-connector-status';
import {
  MarketplaceGrantSessionService,
  type MintedGrantSession,
} from '@/services/marketplace/marketplace-grant-session';
import { isRecognizedMarketplaceNotification } from '@/services/marketplace/marketplace-projections';
import {
  type MarketplaceSessionEndedEvent,
  MarketplaceSessionService,
} from '@/services/marketplace/marketplace-session';
import { NexusMarketplaceService } from '@/services/nexus/marketplace/marketplace';
import type {
  NexusListingCondition,
  NexusListingDetails,
  NexusListingSaleFormat,
  NexusListingState,
} from '@/services/nexus/marketplace/marketplace.types';
import type { NexusTag } from '@/services/nexus/nexus.types';
import { PaykitReceiverService } from '@/services/paykit/paykit-receiver';
import { useAuthStore } from '@/stores/auth/auth.store';

/**
 * The `review` view inside a successful review command result (camelCased
 * by the wire boundary) — exactly the fields record publication needs.
 */
const reviewResultSchema = z
  .object({
    reviewerPubky: z.string().length(52),
    reviewerRole: z.enum(['buyer', 'seller']),
    subjectPubky: z.string().length(52),
    rating: z.number().int().min(1).max(5),
    text: z.string(),
    /** The buyer's per-order seller ratings, on every one of their item reviews; absent or null when unrated. */
    shipping: z.number().int().min(1).max(5).nullish(),
    communication: z.number().int().min(1).max(5).nullish(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .passthrough();

/** One entry of a per-item command result's `reviews[]`: the `review` view plus the listing it rates. */
const reviewItemResultSchema = reviewResultSchema.extend({ listingAggregateId: z.string().min(1) });

/**
 * The payload of a review the service withholds behind a double-blind window:
 * the terms of the latest `review.create` / `review.update` result (every item
 * review, kept in line order), which publish once the service issues the
 * attestations. `withdrawn` marks a review the user removed while it was
 * withheld: it never publishes, and only the service withdrawal is still owed.
 */
const awaitingReleasePayloadSchema = z.object({
  orderId: z.string().min(1),
  /** The seller and the first-line listing the order's single v1 review rates, for display. */
  sellerPubky: z.string(),
  firstListingId: z.string().min(1).nullable(),
  releaseAt: z.string().min(1).nullable(),
  withdrawn: z.boolean().optional(),
  result: z.object({
    review: reviewResultSchema.optional(),
    reviews: z.array(reviewItemResultSchema).optional(),
  }),
});

type AwaitingReleasePayload = z.infer<typeof awaitingReleasePayloadSchema>;

/** A review withheld by a double-blind window, as the surfaces show it. */
export interface AwaitingReleaseReview {
  orderId: string;
  /** The window's end, or null when the service named none. */
  releaseAt: string | null;
  reviewerRole: 'buyer' | 'seller';
  items: { listingOwnerPubky: string; listingId: string; rating: number; text: string; updatedAt: string }[];
}

export interface TCommitCreateDefaultShopParams {
  ownerPubky: string;
  /** The seller's published profile, if any. */
  profile: { name: string; bio: string } | null;
  /** Where the triggering listing ships from; otherwise a cached listing of the seller's, then the default. */
  location?: CommerceShopRecord['location'];
}

export interface CommerceCatalogStreamFilters {
  saleFormat?: NexusListingSaleFormat;
  condition?: NexusListingCondition;
  /**
   * Ask Nexus for auctions ordered by soonest auction end
   * (`sorting=ends_at&order=ascending`) instead of the indexing timeline.
   * That stream contains only auction listings by definition.
   */
  endingSoonest?: boolean;
  /** Seller-declared item location: ISO-3166-1 alpha-2 country code. */
  country?: string;
  /** One seller's listings only (Nexus `seller_id`). */
  sellerId?: string;
}

/**
 * Cross-tab Web Lock that owns one listing's registration attempts. Its
 * holder requests no other lock, so it cannot join a lock-order cycle with
 * the messaging, watchlist or auth locks.
 */
export const LISTING_REGISTRATION_LOCK_PREFIX = 'pubky-listing-registration|';
/** Deadline for the service requests one attempt makes while holding the lock. */
export const LISTING_REGISTRATION_TIMEOUT_MS = 20_000;

/**
 * One registration, publish or delete of a listing. Its session binding
 * (`authEpoch`, the signed-in `pubky`, the marketplace `sessionToken`) is
 * read once when it starts; a sign-out in any tab, an account switch or a
 * session replacement changes it, and the attempt stops before its next
 * request or write. `observed` is the listing row generation the attempt
 * acts on, advanced only by its own writes.
 */
type ListingRegistrationAttempt = {
  compositeListingId: string;
  aggregateId: string;
  authEpoch: number;
  pubky: string | null;
  sessionToken: string | null;
  observed: CommerceListingRowGeneration;
  signal?: AbortSignal;
};

/**
 * `publish` (a user action) waits for the lock and acts on the row as it is
 * then. `heal` (owner surfaces) gives up if another attempt holds the lock
 * and acts only if the row is unchanged since the attempt began.
 */
type ListingRegistrationOwner = 'publish' | 'heal';

/**
 * `record_deleted`: the seller's homeserver has no record, so nothing was
 * sent. `service_not_found`: the service refused with `NOT_FOUND` for the
 * same reason. Neither is retried. `superseded`: the row changed under the
 * attempt, which leaves it to the newer writer.
 */
type ListingRegistrationOutcome = 'registered' | 'record_deleted' | 'service_not_found' | 'superseded';

/**
 * The three honest states a rating header can be in: `rated` (the index
 * holds reviews), `new_seller` (a reputation-aware index confirmed zero
 * reviews — the explicit cold-start state, ratified in the design's §10.3),
 * or `unavailable` (no reputation-aware index reachable — render nothing,
 * never a fabricated state).
 */
/**
 * Whether the current session can use private cross-device watchlist sync,
 * decided from `session.info.capabilities` (facts), never by probing for 403s.
 */
export type CommerceWatchlistSyncCapability = 'capable' | 'needs_reauth' | 'no_session';

/**
 * Outcome of one watchlist sync round. `skipped` covers sandbox mode and
 * signed-out/restoring states; `needs_reauth` is the honest "this homeserver
 * session's grant cannot touch /priv" state (from capability facts or an
 * actual 401/403); `needs_marketplace_approval` means the marketplace refused
 * to release the data key to the current purchase session (missing, or
 * approved without `/priv/pubky.app/`), which only a marketplace session
 * approval repairs; `unavailable` means the marketplace cannot release the
 * key right now, so nothing is written.
 */
export type CommerceWatchlistSyncStatus =
  | 'synced'
  | 'needs_reauth'
  | 'needs_marketplace_approval'
  | 'unavailable'
  | 'unsupported'
  | 'skipped'
  | 'error';

/** The logical id of the one encrypted watchlist entry. */
const WATCHLIST_PRIV_ENTRY_ID = 'watchlist';

/** Plaintext receipts moved per orders load; the rest move on later loads. */
const RECEIPT_MIGRATION_BATCH = 100;

/**
 * Read-back retries for an acked listing write (see
 * {@link CommerceApplication.readBackAckedWrite}). Homeserver reads can lag a
 * just-acked write by a moment, so the verify read waits briefly before
 * believing a lag; one publish that outlasted this budget is still reported
 * as published (unverified), never as failed.
 */
const LISTING_READ_BACK_RETRY_DELAYS_MS = [250, 500, 1_000];

/**
 * Outcome of one portable order-receipt publication pass, mirrored by the
 * controller into the commerce store for UI surfaces. Same honesty contract
 * as the watchlist sync status: capability is decided from session facts,
 * and a refused private read/write reports `needs_reauth` — nothing
 * silently no-ops. A data-key refusal for the purchase session reports
 * `needs_marketplace_approval`. `unavailable` covers the cases re-approval cannot fix:
 * this deployment issued no attestation, the marketplace cannot release the
 * data key that seals receipts, or a transient failure left a receipt
 * unpublished or a plaintext receipt unmoved (it retries on the next
 * orders-surface load).
 * `skipped` covers non-durable modes and signed-out/restoring states.
 */
export type CommerceReceiptPublicationStatus =
  | 'published'
  | 'needs_reauth'
  | 'needs_marketplace_approval'
  | 'unavailable'
  | 'skipped';

export type CommerceSellerReputationOverview =
  | { status: 'rated'; summary: CommerceReputationSummary }
  | { status: 'new_seller' }
  | { status: 'unavailable' };

/**
 * One checkout line as the fulfillment plumbing needs it (local pickup §A2):
 * the projection facts plus the seller identity and the listing's published
 * methods, so the buyer's per-(seller, fulfillment) group choice can be
 * validated and assigned before submit.
 */
export type CommerceCheckoutLineInput = MarketplaceCheckoutFulfillmentLine & {
  expectedRevision: number;
  quantity: number;
  variantId?: string;
  variantOptions?: { name: string; value: string }[];
};

/**
 * A checkout submission with per-group fulfillment choices. A seller group
 * with no recorded choice ships (the default); a checkout with no shipped
 * line sends NO delivery address (§A2), and the delivery email rides only
 * when an email-kind digital line needs it (digital delivery design §4.3).
 */
export type CommerceCheckoutFulfillmentInput = {
  lines: CommerceCheckoutLineInput[];
  fulfillmentChoiceBySeller?: Readonly<Record<string, MarketplaceFulfillmentMethod | undefined>>;
  deliveryAddress?: CreateMarketplaceCheckoutCommand['payload']['deliveryAddress'];
  /**
   * Each shipped seller's published delivery key, resolved by the caller
   * (the controller) just before checkout. On a durable deployment the
   * address is sealed to these keys and only ciphertext leaves the device.
   */
  deliveryKeys?: ReadonlyMap<string, SellerDeliveryKey>;
  /**
   * Sellers whose connected store the buyer chose to share the address with,
   * each with the connection's recipient key as the service published it.
   * Only a seller that ships and gets a sealed delivery address can be in it.
   */
  connectorShares?: readonly ConnectorShareChoice[];
  deliveryEmail?: string;
  /** The buyer's country, sent in clear text so the service can apply the EU fence (plan C2). */
  buyerCountry?: string;
};

export type ConnectorShareChoice = {
  sellerPubky: string;
  shopDomain: string;
  keyId: string;
  publicKey: Uint8Array;
};

/**
 * An own review read from the reviewer's homeserver: the record, an ordinary
 * 404, no claim, or `overwritten` — no record carries this order's
 * attestation, so a later order's review took the shared per-listing path.
 */
type OwnReviewRead =
  | { kind: 'found'; model: CommerceReviewModelSchema }
  | { kind: 'missing' }
  | { kind: 'overwritten'; attestation: z.infer<typeof marketplaceAttestationSchema> }
  | { kind: 'unresolved' };

/** What deleting an own review did: confirmed by the homeserver, owed in the outbox, or nothing to delete. */
export type OwnReviewDeleteOutcome = 'removed' | 'queued' | 'absent';

const OWN_REVIEW_WITHDRAW_ATTEMPTS = 3;

const ownReviewRemovalPayloadSchema = z.object({
  url: z.string().min(1),
  orderId: z.string().min(1),
  /** The reviewed listing the record rates; absent on a job staged before per-item reviews, which covers the order. */
  listingId: z.string().min(1).optional(),
});

function ownReviewRemovalUrl(payload: unknown): string | null {
  const parsed = ownReviewRemovalPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.url : null;
}

function ownReviewRemovalTarget(payload: unknown): { orderId: string; listingId?: string } | null {
  const parsed = ownReviewRemovalPayloadSchema.safeParse(payload);
  return parsed.success ? { orderId: parsed.data.orderId, listingId: parsed.data.listingId } : null;
}

/**
 * A review-list page, or the honest signal that no review index serves this
 * deployment. `sortApplied` is true only when the index answered a requested
 * sort in its envelope form; false for a list read without a sort and for an
 * index that ignored the parameter (before IX4), whose list is newest first.
 */
export type CommerceIndexedReviewsResult =
  | { status: 'ok'; reviews: CommerceIndexedReview[]; sortApplied: boolean }
  | { status: 'unavailable' };

/** One page of a review list; `sort` is the parameter to send, absent for the default order. */
export interface CommerceReviewsPage {
  skip?: number;
  limit?: number;
  sort?: MarketplaceReviewSortParam;
}

function reviewsResult(payload: unknown, page: CommerceReviewsPage): CommerceIndexedReviewsResult {
  const { reviews, envelope } = CommerceRecordNormalizer.nexusReviewPage(payload);
  return { status: 'ok', reviews, sortApplied: page.sort !== undefined && envelope };
}

type CommerceListingWithProjection = CommerceListingModelSchema & {
  /** What a buyer can take now; `null` while unknown, and for made-to-order stock, which has no count. */
  purchasableQuantity: number | null;
  /** The service holds a projection of this listing, so it is registered for checkout (a sold one included). */
  registeredWithService: boolean;
};

function applyInventoryProjection(
  listing: CommerceListingModelSchema,
  projection: CommerceListingProjectionModelSchema | null | undefined,
): CommerceListingWithProjection {
  const recordQuantity = listing.record.variants
    .filter(({ enabled }) => enabled)
    .reduce((total, variant) => total + variant.quantity, 0);
  const registeredWithService = projection != null;
  if (!projection || projection.listing_revision !== listing.revision || projection.made_to_order) {
    return { ...listing, purchasableQuantity: null, registeredWithService };
  }
  return {
    ...listing,
    purchasableQuantity: Math.min(recordQuantity, projection.available_quantity),
    registeredWithService,
  };
}

const SELLER_REFRESH_MAX_PAGES = 100;

/**
 * The states a seller's own refresh reads from the index. The discovery stream
 * serves one lifecycle state per query, and the seller manages unlisted and
 * ended listings (relist, inventory, history) as well as live ones, so a
 * device that never saw them must still learn of them. A removed listing has
 * nothing left to manage.
 */
const SELLER_OWN_LISTING_STATES = ['active', 'paused', 'ended'] as const satisfies readonly NexusListingState[];

export class CommerceApplication {
  private constructor() {}

  private static sellerListingsRefreshInFlight = new Map<string, Promise<void>>();
  /** Tail of each seller's queued shop writes in this tab (owner → settled promise). */
  private static shopWrites = new Map<string, Promise<void>>();
  /** Listings (composite id → count) with a `commitUpsertListing` running in this tab. */
  private static listingPublishesInFlight = new Map<string, number>();

  static async getShop(ownerPubky: string) {
    return await LocalCommerceService.getShop(ownerPubky);
  }

  static async getAllShops() {
    return await LocalCommerceService.getAllShops();
  }

  /**
   * A seller can list before publishing a storefront, so a missing `shop.json`
   * is an ordinary answer: it rejects with a 404 that callers read as "no shop"
   * (`hasHttpStatus`), built without the reporting factory.
   */
  static async fetchShop(ownerPubky: string): Promise<CommerceShopRecord> {
    const url = CommerceRecordNormalizer.shopUri(ownerPubky);
    const published = await CommerceHomeserverService.fetchJsonIfFound(url);
    if (!published.found) {
      throw new AppError({
        category: ErrorCategory.Client,
        code: ClientErrorCode.NOT_FOUND,
        message: 'This seller has not published a shop yet.',
        service: ErrorService.Homeserver,
        operation: 'fetchShop',
        context: { statusCode: HttpStatusCode.NOT_FOUND },
      });
    }
    return CommerceRecordNormalizer.shop(published.json);
  }

  /** Refresh published settings without discarding an unpublished local edit. */
  static async refreshShop(ownerPubky: string): Promise<CommerceShopRecord> {
    const local = await LocalCommerceService.getShop(ownerPubky);
    if (local && local.sync_status !== 'synced') return local.record;

    const record = await this.fetchShop(ownerPubky);
    return await LocalCommerceService.cacheRefreshedShop(record, local?.record ?? null);
  }

  /**
   * A seller's current shop record, read network-first so a seller's later
   * changes (seller type, country) reach buyers who cached the shop before.
   * Falls back to the cached copy when the read fails, including a 404, which
   * may be transient; with nothing cached, the read's error propagates.
   */
  static async refreshShopOrGetCached(ownerPubky: string): Promise<CommerceShopRecord> {
    try {
      return await this.refreshShop(ownerPubky);
    } catch (error) {
      const local = await LocalCommerceService.getShop(ownerPubky).catch(() => null);
      if (local) return local.record;
      throw error;
    }
  }

  /**
   * A live stream of changes to the seller's `shop.json`, from the seller's
   * homeserver `/events-stream` (public, no session), starting after `cursor`;
   * a null cursor replays the file's past events first. Null when the seller
   * has no homeserver. Callers own the reader lifecycle.
   */
  static async subscribeShopEvents(
    ownerPubky: string,
    cursor: string | null = null,
  ): Promise<ReadableStream<THomeserverResourceEvent> | null> {
    return await this.shopEventStream(ownerPubky, cursor, false);
  }

  /** The cursor of the latest write to the seller's `shop.json`, so a live stream can start after it; null when none. */
  static async latestShopEventCursor(ownerPubky: string): Promise<string | null> {
    const stream = await this.shopEventStream(ownerPubky, null, true);
    if (!stream) return null;
    const reader = stream.getReader();
    try {
      const { done, value } = await reader.read();
      return done ? null : value.cursor;
    } finally {
      void reader.cancel().catch(() => {});
    }
  }

  private static async shopEventStream(
    ownerPubky: string,
    cursor: string | null,
    latestOnly: boolean,
  ): Promise<ReadableStream<THomeserverResourceEvent> | null> {
    const homeserver = await HomeserverService.resolveHomeserverOf(ownerPubky);
    if (!homeserver) return null;
    return await HomeserverService.subscribeHomeserverEventStream({
      homeserver,
      users: [[ownerPubky, cursor]],
      pathPrefixes: [CommerceRecordNormalizer.shopUri(ownerPubky).slice(`pubky://${ownerPubky}`.length)],
      ...(latestOnly ? { latestOnly } : {}),
    });
  }

  static async getOrFetchShop(ownerPubky: string): Promise<CommerceShopRecord> {
    const local = await LocalCommerceService.getShop(ownerPubky);
    if (local) return local.record;

    const record = await this.fetchShop(ownerPubky);
    await LocalCommerceService.upsertShop(record, 'synced');
    return record;
  }

  static async getListing(compositeListingId: string) {
    const listing = await LocalCommerceService.getListing(compositeListingId);
    if (!listing) return listing;
    const projection = await LocalCommerceService.getListingProjection(compositeListingId);
    return applyInventoryProjection(listing, projection);
  }

  static async getManyListings(compositeListingIds: string[]): Promise<Map<string, CommerceListingModelSchema>> {
    const listings = await LocalCommerceService.getListingsByIds(compositeListingIds);
    return new Map(listings.map((listing) => [listing.id, listing]));
  }

  /**
   * Reads the locally cached community tag aggregate for a marketplace target.
   *
   * @param kind - `TagKind.LISTING` or `TagKind.SHOP`
   * @param taggedId - Composite `seller:listingId` for listings, owner pubky for shops
   * @returns The cached NexusTag[] aggregate (viewer's own write-through included)
   */
  static async getMarketplaceTags(kind: MarketplaceTagKind, taggedId: string): Promise<NexusTag[]> {
    return await LocalMarketplaceTagService.read(buildMarketplaceTagRowId(kind, taggedId));
  }

  /**
   * Fetches the community tag aggregate for a marketplace target from the
   * marketplace Nexus and merges it into the local cache.
   *
   * Honest degradation: the tag endpoints only exist once the marketplace
   * Nexus deploys tag aggregation. A 404 means "aggregation not available",
   * so this returns an empty array WITHOUT touching the local cache — the
   * viewer's own locally written tags keep rendering, and nothing fake is
   * shown. Any other error propagates.
   *
   * @param params.kind - `TagKind.LISTING` or `TagKind.SHOP`
   * @param params.taggedId - Composite `seller:listingId` for listings, owner pubky for shops
   * @param params.viewerId - Viewer pubky for relationship data, if signed in
   * @param params.skip - Number of tags to skip (pagination)
   * @param params.limit - Maximum number of tags to return
   * @returns Tags returned by Nexus; empty when the endpoint is not deployed (404)
   */
  static async fetchMarketplaceTags({
    kind,
    taggedId,
    viewerId,
    skip,
    limit,
  }: {
    kind: MarketplaceTagKind;
    taggedId: string;
    viewerId?: string;
    skip?: number;
    limit?: number;
  }): Promise<NexusTag[]> {
    let nexusTags: NexusTag[];
    try {
      if (kind === TagKind.LISTING) {
        const [sellerId, listingId] = taggedId.split(':');
        nexusTags = await NexusMarketplaceService.fetchListingTags({
          seller_id: sellerId,
          listing_id: listingId,
          skip_tags: skip,
          limit_tags: limit,
          viewer_id: viewerId,
        });
      } else {
        nexusTags = await NexusMarketplaceService.fetchShopTags({
          seller_id: taggedId,
          skip_tags: skip,
          limit_tags: limit,
          viewer_id: viewerId,
        });
      }
    } catch (error) {
      if (isAppError(error) && isNotFound(error)) {
        return [];
      }
      throw error;
    }

    if (nexusTags.length > 0) {
      await LocalMarketplaceTagService.mergeTags({
        taggedId: buildMarketplaceTagRowId(kind, taggedId),
        tags: nexusTags,
        viewerId: viewerId ?? null,
      });
    }

    return nexusTags;
  }

  static async getListingsBySeller(sellerPubky: string) {
    const listings = await LocalCommerceService.getListingsBySeller(sellerPubky);
    return await Promise.all(
      listings.map(async (listing) =>
        applyInventoryProjection(listing, await LocalCommerceService.getListingProjection(listing.id)),
      ),
    );
  }

  static async cacheMarketplaceListingProjection(projection: CommerceListingProjectionModelSchema): Promise<void> {
    await LocalCommerceService.cacheListingProjection(projection);
  }

  static async getOrFetchListingsBySeller(sellerPubky: string) {
    const listings = await LocalCommerceService.getListingsBySeller(sellerPubky);
    if (listings.length > 0) return listings;

    await this.fetchSellerCatalogListings(sellerPubky);
    const entries = await LocalCommerceService.getCatalogEntriesBySeller(sellerPubky);
    await Promise.all(entries.map((entry) => this.getOrFetchListing(sellerPubky, entry.listing_id)));
    return await LocalCommerceService.getListingsBySeller(sellerPubky);
  }

  /**
   * Refreshes one seller's discovery stream, then hydrates only records that
   * are absent locally or newer than the canonical record already cached.
   * Nexus remains discovery/revision data; the homeserver remains canonical.
   *
   * Concurrent dashboard mounts for the same seller share one bounded pass.
   * Missing entries from the stream are intentionally retained locally:
   * discovery is not the seller's durable inventory authority.
   */
  static async refreshListingsBySeller(sellerPubky: string): Promise<void> {
    // Sandbox catalogs are seeded locally and stay self-contained (same
    // invariant as fetchCatalogListings / fetchSellerCatalogListings):
    // sandbox mode never reads from Nexus, so the refresh is a no-op and
    // the cached rows keep rendering.
    if (getCommerceAdapterMode() === 'sandbox') return;

    const inFlight = this.sellerListingsRefreshInFlight.get(sellerPubky);
    if (inFlight) {
      await inFlight;
      return;
    }

    const refresh = this.runSellerListingsRefresh(sellerPubky);
    this.sellerListingsRefreshInFlight.set(sellerPubky, refresh);
    try {
      await refresh;
    } finally {
      if (this.sellerListingsRefreshInFlight.get(sellerPubky) === refresh) {
        this.sellerListingsRefreshInFlight.delete(sellerPubky);
      }
    }
  }

  private static async runSellerListingsRefresh(sellerPubky: string): Promise<void> {
    const entries = await this.collectSellerCatalogEntries(sellerPubky, {
      strictIdentity: true,
      paginate: true,
      states: SELLER_OWN_LISTING_STATES,
    });
    const localListings = await LocalCommerceService.getListingsBySeller(sellerPubky);
    const localListingsById = new Map(localListings.map((listing) => [listing.listing_id, listing]));
    const recordsToCommit: CommerceListingRecord[] = [];
    // Nexus keeps indexing a listing for a while after the seller deletes it.
    // Its record is gone, so it is skipped rather than failing the refresh.
    const deleted = new Set<string>();

    for (const entry of entries) {
      const local = localListingsById.get(entry.listing_id);
      if (local && local.revision >= entry.revision) continue;
      const record = await this.fetchListingIfFound(sellerPubky, entry.listing_id);
      if (!record) {
        deleted.add(entry.listing_id);
        continue;
      }
      if (record.revision < entry.revision) {
        throw Err.validation(
          ValidationErrorCode.INVALID_INPUT,
          'Canonical listing revision is older than the Nexus discovery revision.',
          {
            service: ErrorService.Marketplace,
            operation: 'refreshListingsBySeller',
            context: { canonicalRevision: record.revision, indexedRevision: entry.revision },
          },
        );
      }
      recordsToCommit.push(record);
    }

    await LocalCommerceService.commitSellerCatalogRefresh(
      entries.filter((entry) => !deleted.has(entry.listing_id)),
      recordsToCommit,
      { sellerPubky, deletedListingIds: deleted },
    );
  }

  static async getListingsByCategory(categoryId: string) {
    return await LocalCommerceService.getListingsByCategory(categoryId);
  }

  static async getAllListings() {
    return await LocalCommerceService.getAllListings();
  }

  static async getListingDrafts(ownerPubky: string) {
    return await LocalCommerceService.getDraftsByOwner(ownerPubky);
  }

  static async commitUpdateListingDraft(
    ownerPubky: string,
    listingId: string,
    form: CommerceJsonValue,
    mediaBlobs: Record<string, Blob> = {},
  ): Promise<void> {
    await LocalCommerceService.upsertDraft({
      ownerId: ownerPubky,
      listingId,
      data: { ownerPubky, listingId, form },
      now: Date.now(),
      mediaBlobs,
    });
  }

  static async commitDeleteListingDraft(ownerPubky: string, listingId: string): Promise<void> {
    await LocalCommerceService.deleteDraft(`${ownerPubky}:${listingId}`);
  }

  static async initializeSandboxCatalog(): Promise<boolean> {
    if (getCommerceAdapterMode() !== 'sandbox') return false;
    const catalog = createCommerceSandboxCatalog();
    const seeded = await LocalCommerceService.seedSandboxCatalog(catalog);
    let listings = catalog.listings;
    if (!seeded) {
      const existing = await Promise.all(
        listings.map((listing) => LocalCommerceService.getListing(`${listing.ownerPubky}:${listing.listingId}`)),
      );
      // Preserve a non-sandbox catalog instead of claiming that seeding succeeded.
      if (existing.some((listing) => !listing)) return false;
      // Re-register existing demos after the in-memory service restarts.
      listings = existing.map((listing) => listing!.record);
    }
    const registrations = await Promise.allSettled(listings.map((listing) => this.ensureListingRegistered(listing)));
    if (registrations.some((result) => result.status === 'rejected' || !result.value)) {
      throw Err.server(ServerErrorCode.SERVICE_UNAVAILABLE, 'Sandbox listings could not be prepared for checkout.', {
        service: ErrorService.Marketplace,
        operation: 'initializeSandboxCatalog',
      });
    }
    return true;
  }

  static async executeMarketplaceCommand(actorPubky: string, command: MarketplaceCommand) {
    await this.assertSellerAuthorityRoutable(command);
    return await MarketplaceGatewayService.execute(actorPubky, command);
  }

  static async commitOfferCheckout(actorPubky: string, command: MarketplaceCommand) {
    return await this.executeMarketplaceCommand(actorPubky, command);
  }

  // ---------------------------------------------------------------------
  // Local pickup (Wave 7 safe subset, local pickup design PART A)
  //
  // Pickup details are restricted personal data. This layer NEVER writes
  // them to Dexie, a store, or any persistence: the buyer's revealed copy
  // is memory-only and re-fetched from the reveal read on each view (§A1),
  // and the seller's owner-read copy is returned to the caller, which holds
  // it in memory. The only writes are the service commands themselves.
  // ---------------------------------------------------------------------

  /**
   * The client-side deployment boundary for pickup commands (§A8): the
   * sandbox deployment stores and reveals no pickup details, so the commands
   * are refused before any bytes leave the client — the same refusal the
   * durable service answers on sandbox-payments deployments, in the same
   * shape: CONFLICT with the typed `pickup_unavailable` refusal.
   */
  private static assertPickupDeployment(operation: string): void {
    if (!isDurableCommerceMode(getCommerceAdapterMode())) {
      throw Err.client(ClientErrorCode.CONFLICT, 'Pickup is unavailable on this deployment.', {
        service: ErrorService.Marketplace,
        operation,
        context: { refusal: 'pickup_unavailable' },
      });
    }
  }

  /**
   * Command refusals come back in the response envelope (`ok:false`), not as
   * thrown errors, so the typed pickup refusals (§A3/§A6/§A7) would never
   * reach a caller that branches on `context.refusal` — the entitled reads
   * already throw that shape. Re-throw a classified pickup refusal as the
   * same CONFLICT + `context.refusal` error the reads produce; unclassified
   * failures (revision conflicts, validation) keep the envelope for the
   * caller to handle.
   */
  private static throwIfPickupCommandRefusal(operation: string, response: MarketplaceCommandResponse): void {
    if (response.ok) return;
    const refusal = classifyMarketplacePickupCommandRefusal(response);
    if (!refusal) return;
    throw Err.client(ClientErrorCode.CONFLICT, pickupRefusalFailureMessage(refusal), {
      service: ErrorService.Marketplace,
      operation,
      context: { refusal },
    });
  }

  /**
   * The deployment's `pickup_available` capability (§A7), read from the
   * service's /health surface: false in every non-durable mode and whenever
   * the sealing key is absent or sandbox payments are enabled. 7.2b gates
   * every pickup affordance on this.
   */
  static async fetchPickupAvailable(): Promise<boolean> {
    return await MarketplaceGatewayService.getPickupAvailability();
  }

  /** The deployment's digital delivery capability (digital delivery design §6 B5), read from /health. */
  static async fetchDigitalDeliveryCapability(): Promise<MarketplaceDigitalDeliveryCapability> {
    return await MarketplaceGatewayService.getDigitalDeliveryCapability();
  }

  /**
   * Whether the Shop may offer USDT: the runtime flag AND the service's
   * `/health` capability. With the flag off the service is never asked, so a
   * default deploy makes no extra request. Gates new offers only; it never
   * hides an existing USDT order.
   */
  static async fetchUsdtPaymentsAvailable(): Promise<boolean> {
    if (!getUsdtPaymentsEnabled()) return false;
    return await MarketplaceGatewayService.getUsdtPaymentsCapability();
  }

  /** Who marks orders paid on this deployment; null when the service does not say. */
  static async fetchPaymentConfirmationMode(): Promise<'seller' | 'automatic' | null> {
    return await MarketplaceGatewayService.getPaymentConfirmationMode();
  }

  /**
   * The paying buyer's per-line pickup-details reveal (§A3): the pinned
   * snapshot recorded at payment, straight from the service's entitled read.
   * The returned details stay IN MEMORY ONLY — they are written to no Dexie
   * table, no store, and no cache, and must be re-fetched on each view.
   */
  static async fetchPickupReveal(actorPubky: string, orderId: string): Promise<MarketplacePickupReveal> {
    return await MarketplaceGatewayService.getOrderPickupDetails(actorPubky, orderId);
  }

  /**
   * The seller's owner read of their own current pickup details plus the
   * surviving version counter (§A4): the input the next
   * `pickup_details.set` compare-and-swaps against.
   */
  static async fetchSellerPickupDetails(
    actorPubky: string,
    listingAggregateId: string,
  ): Promise<MarketplaceSellerPickupDetails> {
    return await MarketplaceGatewayService.getListingPickupDetails(actorPubky, listingAggregateId);
  }

  /**
   * `pickup_details.set` (§A7): sealed whole-payload upsert of a listing's
   * pickup details. `expectedVersion` CASes against the per-listing version
   * counter (0 when no details exist yet); a stale value gets the standard
   * 409 REVISION_CONFLICT refetch-and-retry treatment. The envelope's
   * `expectedRevision` is always 0 — the CAS rides the payload.
   */
  static async commitSetPickupDetails(
    actorPubky: string,
    input: {
      sellerPubky: string;
      listingId: string;
      expectedVersion: number;
      details: MarketplacePickupDetails;
    },
  ): Promise<MarketplaceCommandResponse> {
    this.assertPickupDeployment('commitSetPickupDetails');
    const command = CommerceRecordNormalizer.marketplaceCommand({
      version: 1,
      commandId: crypto.randomUUID(),
      aggregateId: buildMarketplaceListingAggregateId(input.sellerPubky, input.listingId),
      expectedRevision: 0,
      issuedAt: new Date().toISOString(),
      kind: 'pickup_details.set',
      payload: { expectedVersion: input.expectedVersion, details: input.details },
    });
    const response = await this.executeMarketplaceCommand(actorPubky, command);
    this.throwIfPickupCommandRefusal('commitSetPickupDetails', response);
    return response;
  }

  /**
   * `pickup_details.clear` (§A3/§A7): removes the listing's pickup details.
   * The service retains only versions pinned by a paid, non-terminal order;
   * the version counter survives, so the next set continues the sequence.
   */
  static async commitClearPickupDetails(
    actorPubky: string,
    input: {
      sellerPubky: string;
      listingId: string;
      expectedVersion: number;
    },
  ): Promise<MarketplaceCommandResponse> {
    this.assertPickupDeployment('commitClearPickupDetails');
    const command = CommerceRecordNormalizer.marketplaceCommand({
      version: 1,
      commandId: crypto.randomUUID(),
      aggregateId: buildMarketplaceListingAggregateId(input.sellerPubky, input.listingId),
      expectedRevision: 0,
      issuedAt: new Date().toISOString(),
      kind: 'pickup_details.clear',
      payload: { expectedVersion: input.expectedVersion },
    });
    const response = await this.executeMarketplaceCommand(actorPubky, command);
    this.throwIfPickupCommandRefusal('commitClearPickupDetails', response);
    return response;
  }

  // ---------------------------------------------------------------------
  // Digital delivery seller setup (digital delivery design §2, §6 C1–C5)
  //
  // A file is encrypted here with a fresh AES-256-GCM key; only the
  // ciphertext goes to the seller's homeserver, and the key goes once, to the
  // service, inside `digital_delivery.set`, which seals it. Neither the key
  // nor the plaintext is persisted, stored or logged; the seller's own link
  // or text from the owner read is returned to the caller only.
  // ---------------------------------------------------------------------

  /** The durable-service boundary for digital delivery: the sandbox seals and releases nothing. */
  private static assertDigitalDeployment(operation: string): void {
    if (!isDurableCommerceMode(getCommerceAdapterMode())) {
      throw Err.client(ClientErrorCode.CONFLICT, DIGITAL_DELIVERY_COPY.unavailable, {
        service: ErrorService.Marketplace,
        operation,
        context: { refusal: 'digital_delivery_unavailable' },
      });
    }
  }

  /** The seller's owner read of one listing's digital delivery (§6 C5). */
  static async fetchSellerDigitalDelivery(
    actorPubky: string,
    listingAggregateId: string,
  ): Promise<MarketplaceSellerDigitalDelivery> {
    return await MarketplaceGatewayService.getListingDigitalDelivery(actorPubky, listingAggregateId);
  }

  /**
   * `digital_delivery.set`: sets how buyers receive the listing as version
   * `expectedVersion + 1`. A file is encrypted, bound to the seller,
   * deliverable id and version, and written to the seller's homeserver
   * before the command. When the service refuses, the new ciphertext is
   * referenced by no version, so it is deleted (best effort). The response
   * is returned as-is; refusals stay in the envelope.
   *
   * A command that throws after the upload has an unknown outcome: the
   * service may have set the version before the reply was lost, and deleting
   * a referenced ciphertext would break every later download. The same
   * command (same id and payload) is sent once more, which returns the
   * service's stored result: a refusal deletes the upload and is returned,
   * a success is returned, and a second throw keeps the upload (an
   * unreferenced ciphertext under a random id reveals nothing) and rethrows
   * the first error. A failed encryption throws with `refusal:
   * 'encrypt_failed'`, before anything leaves the device.
   */
  static async commitSetDigitalDelivery(
    actorPubky: string,
    input: {
      sellerPubky: string;
      listingId: string;
      expectedVersion: number;
      delivery: MarketplaceDigitalDeliveryInput;
    },
  ): Promise<MarketplaceCommandResponse> {
    this.assertDigitalDeployment('commitSetDigitalDelivery');
    let uploadedUrl: string | null = null;
    let delivery: MarketplaceDigitalDeliverySet;
    if (input.delivery.kind === 'file') {
      const version = input.expectedVersion + 1;
      const deliverableId = newDigitalDeliverableId();
      let encrypted: Awaited<ReturnType<typeof encryptDigitalDeliverable>>;
      try {
        encrypted = await encryptDigitalDeliverable({
          plaintext: input.delivery.bytes,
          sellerPubky: input.sellerPubky,
          deliverableId,
          version,
        });
      } catch (cause) {
        throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'The file could not be encrypted on this device.', {
          service: ErrorService.Local,
          operation: 'commitSetDigitalDelivery',
          context: { refusal: 'encrypt_failed' },
          cause,
        });
      }
      const url = digitalDeliverableUrl(input.sellerPubky, deliverableId, version);
      await CommerceHomeserverService.putDeliverable(url, encrypted.ciphertext);
      uploadedUrl = url;
      delivery = {
        kind: 'file',
        deliverableId,
        version,
        key: encrypted.key,
        iv: encrypted.iv,
        ciphertextBlake3: encrypted.ciphertextBlake3,
        plaintextBlake3: encrypted.plaintextBlake3,
        sizeBytes: encrypted.sizeBytes,
        contentType: digitalFileContentType(input.delivery.contentType),
        fileName: digitalFileName(input.delivery.fileName),
      };
    } else {
      delivery = input.delivery;
    }
    const command = CommerceRecordNormalizer.marketplaceCommand({
      version: 1,
      commandId: crypto.randomUUID(),
      aggregateId: buildMarketplaceListingAggregateId(input.sellerPubky, input.listingId),
      expectedRevision: 0,
      issuedAt: new Date().toISOString(),
      kind: 'digital_delivery.set',
      payload: { expectedVersion: input.expectedVersion, delivery },
    });
    let response: MarketplaceCommandResponse;
    try {
      response = await this.executeMarketplaceCommand(actorPubky, command);
    } catch (error) {
      if (!uploadedUrl) throw error;
      const replayed = await this.executeMarketplaceCommand(actorPubky, command).catch(() => null);
      if (!replayed) {
        Logger.warn('A digital delivery set had no answer; its uploaded deliverable is kept');
        throw error;
      }
      response = replayed;
    }
    if (!response.ok && uploadedUrl) {
      await CommerceHomeserverService.deleteDeliverable(uploadedUrl).catch(() => {
        Logger.warn('An unreferenced digital deliverable could not be deleted');
      });
    }
    return response;
  }

  /** `digital_delivery.clear`: removes delivery; the service refuses while buyers pay for or download it (C4). */
  static async commitClearDigitalDelivery(
    actorPubky: string,
    input: { sellerPubky: string; listingId: string; expectedVersion: number },
  ): Promise<MarketplaceCommandResponse> {
    this.assertDigitalDeployment('commitClearDigitalDelivery');
    const command = CommerceRecordNormalizer.marketplaceCommand({
      version: 1,
      commandId: crypto.randomUUID(),
      aggregateId: buildMarketplaceListingAggregateId(input.sellerPubky, input.listingId),
      expectedRevision: 0,
      issuedAt: new Date().toISOString(),
      kind: 'digital_delivery.clear',
      payload: { expectedVersion: input.expectedVersion },
    });
    return await this.executeMarketplaceCommand(actorPubky, command);
  }

  /**
   * The buyer's pinned digital payload for one order (digital delivery design
   * §4.2). The service writes an access row on every read, and an opened
   * instant line stays sold if the order is later cancelled (§6 E8), so this
   * is called only when the buyer asks to open a line.
   */
  static async fetchOrderDigitalDelivery(
    actorPubky: string,
    orderId: string,
    lineIndex: number,
  ): Promise<MarketplaceOrderDigitalDelivery> {
    this.assertDigitalDeployment('fetchOrderDigitalDelivery');
    return await MarketplaceGatewayService.getOrderDigitalDelivery(actorPubky, orderId, lineIndex);
  }

  /**
   * Opens a buyer's file line (§3.4): reads the ciphertext from the seller's
   * homeserver, checks its length and BLAKE3 against the pin, decrypts it
   * with the pinned key under the seller, deliverable and version, and
   * checks the plaintext BLAKE3. The bytes are returned only when all hold;
   * nothing is stored.
   */
  static async openOrderDigitalFile(
    line: Extract<MarketplaceOrderDigitalLine, { kind: 'file' }>,
  ): Promise<
    | { ok: true; bytes: Uint8Array; fileName: string; contentType: string }
    | { ok: false; reason: DigitalFileOpenFailure }
  > {
    let ciphertext: Uint8Array<ArrayBuffer>;
    try {
      ciphertext = await CommerceHomeserverService.getDeliverable(
        digitalDeliverableUrl(line.sellerPubky, line.deliverableId, line.version),
        digitalCiphertextBytes(line.sizeBytes),
      );
    } catch (error) {
      // A body larger than the pinned ciphertext is not the file that was paid for.
      const oversized = isAppError(error) && error.code === ClientErrorCode.PAYLOAD_TOO_LARGE;
      return { ok: false, reason: oversized ? 'ciphertext_mismatch' : 'fetch_failed' };
    }
    const opened = await openDigitalDeliverable({
      ciphertext,
      key: line.key,
      iv: line.iv,
      ciphertextBlake3: line.ciphertextBlake3,
      plaintextBlake3: line.plaintextBlake3,
      sizeBytes: line.sizeBytes,
      sellerPubky: line.sellerPubky,
      deliverableId: line.deliverableId,
      version: line.version,
    });
    if (!opened.ok) return opened;
    return { ok: true, bytes: opened.plaintext, fileName: line.fileName, contentType: line.contentType };
  }

  /** The seller's delivery evidence on one of their digital orders (§3 "Seller's orders"). */
  static async fetchOrderDigitalEvidence(
    actorPubky: string,
    orderId: string,
  ): Promise<MarketplaceOrderDigitalEvidence> {
    this.assertDigitalDeployment('fetchOrderDigitalEvidence');
    return await MarketplaceGatewayService.getOrderDigitalEvidence(actorPubky, orderId);
  }

  /** An email-kind order's delivery email and emailed time (§4.3, §6 F5–F9). */
  static async fetchOrderDeliveryEmail(actorPubky: string, orderId: string): Promise<MarketplaceOrderDeliveryEmail> {
    this.assertDigitalDeployment('fetchOrderDeliveryEmail');
    return await MarketplaceGatewayService.getOrderDeliveryEmail(actorPubky, orderId);
  }

  /**
   * `order.set_delivery_email` (§6 F11, F12): the buyer replaces the address
   * the seller sends an email-kind line to. `expectedRevision` is the
   * order's current revision.
   */
  static async commitSetDeliveryEmail(
    actorPubky: string,
    input: { orderId: string; expectedRevision: number; deliveryEmail: string },
  ): Promise<MarketplaceCommandResponse> {
    this.assertDigitalDeployment('commitSetDeliveryEmail');
    const command = CommerceRecordNormalizer.marketplaceCommand({
      version: 1,
      commandId: crypto.randomUUID(),
      aggregateId: buildMarketplaceOrderAggregateId(input.orderId),
      expectedRevision: input.expectedRevision,
      issuedAt: new Date().toISOString(),
      kind: 'order.set_delivery_email',
      payload: { orderId: input.orderId, deliveryEmail: input.deliveryEmail },
    });
    return await this.executeMarketplaceCommand(actorPubky, command);
  }

  /**
   * `fulfillment.deliver_digital` (§4.3, §6 F13): the seller marks an
   * order's email or message lines delivered after sending them.
   * `expectedRevision` is the order's current revision, so a racing buyer
   * cancel request and this mark have exactly one winner (F15).
   */
  static async commitDeliverDigital(
    actorPubky: string,
    input: { orderId: string; expectedRevision: number; channel: MarketplaceDigitalDeliveryChannel },
  ): Promise<MarketplaceCommandResponse> {
    this.assertDigitalDeployment('commitDeliverDigital');
    const command = CommerceRecordNormalizer.marketplaceCommand({
      version: 1,
      commandId: crypto.randomUUID(),
      aggregateId: buildMarketplaceOrderAggregateId(input.orderId),
      expectedRevision: input.expectedRevision,
      issuedAt: new Date().toISOString(),
      kind: 'fulfillment.deliver_digital',
      payload: { orderId: input.orderId, channel: input.channel },
    });
    return await this.executeMarketplaceCommand(actorPubky, command);
  }

  /**
   * `fulfillment.release_digital`: the seller releases a paid order's instant
   * lines when they wait for the seller's release. `expectedRevision` is the
   * order's current revision, so a racing buyer cancel request has one winner.
   */
  static async commitReleaseDigital(
    actorPubky: string,
    input: { orderId: string; expectedRevision: number },
  ): Promise<MarketplaceCommandResponse> {
    this.assertDigitalDeployment('commitReleaseDigital');
    const command = CommerceRecordNormalizer.marketplaceCommand({
      version: 1,
      commandId: crypto.randomUUID(),
      aggregateId: buildMarketplaceOrderAggregateId(input.orderId),
      expectedRevision: input.expectedRevision,
      issuedAt: new Date().toISOString(),
      kind: 'fulfillment.release_digital',
      payload: { orderId: input.orderId },
    });
    return await this.executeMarketplaceCommand(actorPubky, command);
  }

  /**
   * `fulfillment.mark_ready` (§A6): the seller arms a paid pickup order for
   * handover (`paid` → `ready_for_pickup`). `expectedRevision` is the
   * order's current revision.
   */
  static async commitMarkReady(
    actorPubky: string,
    input: { orderId: string; expectedRevision: number },
  ): Promise<MarketplaceCommandResponse> {
    this.assertPickupDeployment('commitMarkReady');
    const command = CommerceRecordNormalizer.marketplaceCommand({
      version: 1,
      commandId: crypto.randomUUID(),
      aggregateId: buildMarketplaceOrderAggregateId(input.orderId),
      expectedRevision: input.expectedRevision,
      issuedAt: new Date().toISOString(),
      kind: 'fulfillment.mark_ready',
      payload: { orderId: input.orderId },
    });
    const response = await this.executeMarketplaceCommand(actorPubky, command);
    this.throwIfPickupCommandRefusal('commitMarkReady', response);
    return response;
  }

  /**
   * `fulfillment.confirm_pickup` (§A6): either party confirms the handover
   * (`paid`/`ready_for_pickup` → `delivered`). A seller-actor confirm is
   * refused service-side while a post-payment terms change is unresolved.
   */
  static async commitConfirmPickup(
    actorPubky: string,
    input: { orderId: string; expectedRevision: number },
  ): Promise<MarketplaceCommandResponse> {
    this.assertPickupDeployment('commitConfirmPickup');
    const command = CommerceRecordNormalizer.marketplaceCommand({
      version: 1,
      commandId: crypto.randomUUID(),
      aggregateId: buildMarketplaceOrderAggregateId(input.orderId),
      expectedRevision: input.expectedRevision,
      issuedAt: new Date().toISOString(),
      kind: 'fulfillment.confirm_pickup',
      payload: { orderId: input.orderId },
    });
    const response = await this.executeMarketplaceCommand(actorPubky, command);
    this.throwIfPickupCommandRefusal('commitConfirmPickup', response);
    return response;
  }

  /**
   * `checkout.create` with the Wave 7 fulfillment plumbing (§A2): the
   * buyer's per-(seller, fulfillment) group choice is assigned to every
   * line of the group and validated against what each line's listing
   * publishes — a disallowed choice is refused locally with a typed
   * validation error, never silently rewritten to shipping. The delivery
   * address rule is enforced by the command schema (required when any group
   * ships; forbidden on pickup-only checkouts).
   */
  static async commitCreateMarketplaceCheckout(
    actorPubky: string,
    input: CommerceCheckoutFulfillmentInput,
  ): Promise<MarketplaceCommandResponse> {
    const plan = resolveCheckoutFulfillment(input.lines, input.fulfillmentChoiceBySeller ?? {});
    if (!plan.ok) {
      throw Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        'A checkout group chooses a fulfillment its listing does not publish.',
        {
          service: ErrorService.Marketplace,
          operation: 'commitCreateMarketplaceCheckout',
          context: {
            sellerPubky: plan.sellerPubky,
            fulfillment: plan.fulfillment,
            listingAggregateId: plan.listingAggregateId,
          },
        },
      );
    }
    const commandId = crypto.randomUUID();
    const sealedAddress = await this.sealCheckoutAddress(actorPubky, commandId, input, plan.lineFulfillments);
    const command = CommerceRecordNormalizer.marketplaceCommand({
      version: 1,
      commandId,
      aggregateId: buildMarketplaceCheckoutAggregateId(commandId),
      expectedRevision: 0,
      issuedAt: new Date().toISOString(),
      kind: 'checkout.create',
      payload: {
        lines: input.lines.map((line, index) => ({
          listingAggregateId: line.listingAggregateId,
          expectedRevision: line.expectedRevision,
          quantity: line.quantity,
          ...(line.variantId ? { variantId: line.variantId } : {}),
          ...(line.variantOptions && line.variantOptions.length > 0 ? { variantOptions: line.variantOptions } : {}),
          fulfillment: plan.lineFulfillments[index],
        })),
        ...sealedAddress,
        ...(await this.sealConnectorShares(actorPubky, commandId, input, sealedAddress)),
        ...(input.deliveryEmail !== undefined ? { deliveryEmail: input.deliveryEmail } : {}),
        ...(input.buyerCountry !== undefined ? { buyerCountry: input.buyerCountry } : {}),
      },
    });
    return await this.executeMarketplaceCommand(actorPubky, command);
  }

  /**
   * The buyer's opt-in copies of the address, one per chosen seller, sealed to
   * the store connection's recipient key and bound to this checkout. The seller
   * must also get the sealed delivery address: sharing with a store is never the
   * only copy, and a seller who does not ship has nothing to share.
   */
  private static async sealConnectorShares(
    actorPubky: string,
    commandId: string,
    input: CommerceCheckoutFulfillmentInput,
    sealedAddress: { deliveryAddress?: unknown; deliveryAddressEnvelopes?: SellerDeliveryEnvelope[] },
  ): Promise<{ connectorShares?: ConnectorShare[] }> {
    const choices = input.connectorShares ?? [];
    if (choices.length === 0 || !input.deliveryAddress) return {};
    const sealedSellers = new Set((sealedAddress.deliveryAddressEnvelopes ?? []).map(({ sellerPubky }) => sellerPubky));
    const address = input.deliveryAddress;
    const shares = await Promise.all(
      choices.map(async (choice) => {
        if (!sealedSellers.has(choice.sellerPubky)) {
          throw Err.validation(
            ValidationErrorCode.INVALID_INPUT,
            'An address can be shared only with the store of a seller that ships this checkout.',
            {
              service: ErrorService.Marketplace,
              operation: 'commitCreateMarketplaceCheckout',
              context: { sellerPubky: choice.sellerPubky },
            },
          );
        }
        return {
          sellerPubky: choice.sellerPubky,
          shopDomain: choice.shopDomain,
          consentVersion: CONNECTOR_SHARE_CONSENT_VERSION,
          keyId: choice.keyId,
          envelope: await sealConnectorAddress({
            address,
            recipientPublicKey: choice.publicKey,
            binding: {
              checkoutCommandId: commandId,
              buyerPubky: actorPubky,
              sellerPubky: choice.sellerPubky,
              keyId: choice.keyId,
            },
          }),
        };
      }),
    );
    return { connectorShares: shares };
  }

  /**
   * The connected stores a buyer may share the address with, for the shipped
   * sellers of a checkout. A seller whose status cannot be read is simply
   * offered no choice: sharing is optional and never blocks a checkout.
   */
  static async getConnectorStores(sellerPubkys: readonly string[]): Promise<Map<string, ConnectorShareChoice>> {
    const stores = new Map<string, ConnectorShareChoice>();
    await Promise.all(
      sellerPubkys.map(async (sellerPubky) => {
        try {
          const [store] = await MarketplaceConnectorStatusService.getStores(sellerPubky);
          if (!store) return;
          const key = store.addressSharing.recipientKey;
          stores.set(sellerPubky, {
            sellerPubky,
            shopDomain: store.domain,
            keyId: key.keyId,
            publicKey: decodeConnectorRecipientKey(key.publicKey),
          });
        } catch {
          // No store, or its status could not be read: no opt-in is offered.
        }
      }),
    );
    return stores;
  }

  /**
   * The address part of a checkout payload. A durable deployment never
   * receives the plaintext address: it is sealed once per shipped seller to
   * the key the caller resolved, and a shipped seller with no resolved key
   * stops the checkout here. The local prototype adapter keeps the address
   * on the device and takes it as typed.
   */
  private static async sealCheckoutAddress(
    actorPubky: string,
    commandId: string,
    input: CommerceCheckoutFulfillmentInput,
    lineFulfillments: readonly MarketplaceFulfillmentMethod[],
  ): Promise<
    | { deliveryAddress?: NonNullable<CommerceCheckoutFulfillmentInput['deliveryAddress']> }
    | {
        deliveryAddressEnvelopes: SellerDeliveryEnvelope[];
      }
  > {
    if (!input.deliveryAddress) return {};
    if (!isDurableCommerceMode(getCommerceAdapterMode())) return { deliveryAddress: input.deliveryAddress };
    const shippedSellers = new Set(
      input.lines.filter((_, index) => lineFulfillments[index] === 'shipping').map((line) => line.sellerPubky),
    );
    const keys = new Map<string, SellerDeliveryKey>();
    for (const sellerPubky of shippedSellers) {
      const key = input.deliveryKeys?.get(sellerPubky);
      if (!key) {
        throw Err.validation(
          ValidationErrorCode.INVALID_INPUT,
          'A seller that ships this checkout has no delivery key to seal the address to.',
          {
            service: ErrorService.Marketplace,
            operation: 'commitCreateMarketplaceCheckout',
            context: { sellerPubky },
          },
        );
      }
      keys.set(sellerPubky, key);
    }
    return {
      deliveryAddressEnvelopes: await sealDeliveryAddressForSellers({
        address: input.deliveryAddress,
        checkoutCommandId: commandId,
        buyerPubky: actorPubky,
        keys,
      }),
    };
  }

  /**
   * The multi-operator mismatch guard (docs/ecommerce/multi-operator.md,
   * increment 1). A seller's shop record may declare the transaction-service
   * authority it sells through (`shop.transactionService`, specs
   * `0.6.2-marketplace.7`). This client cannot route to arbitrary services
   * yet, so when a listing-aggregate command targets a seller whose declared
   * authority is a DIFFERENT origin than this deployment's configured
   * service, the command is refused with an honest message — instead of
   * silently registering the seller's listing into an authority they never
   * declared.
   *
   * Deliberately fail-open on absence: no shop record, no declared field, an
   * unreadable homeserver, or a sandbox deployment all keep today's
   * behavior. The declaration is the seller's routing statement, not a
   * security boundary — the transaction service authenticates actors itself.
   */
  private static async assertSellerAuthorityRoutable(command: MarketplaceCommand): Promise<void> {
    if (!isDurableCommerceMode(getCommerceAdapterMode())) return;
    const aggregateId = typeof command.aggregateId === 'string' ? command.aggregateId : '';
    if (!aggregateId.startsWith('listing:')) return;
    const sellerPubky = aggregateId.slice('listing:'.length, 'listing:'.length + 52);
    if (sellerPubky.length !== 52) return;

    let declared: string | undefined;
    try {
      declared = (await this.getOrFetchShop(sellerPubky)).transactionService;
    } catch {
      return;
    }
    if (!declared) return;

    const configured = getMarketplaceUrl();
    let declaredOrigin: string;
    let configuredOrigin: string;
    try {
      declaredOrigin = new URL(declared).origin;
      configuredOrigin = new URL(configured).origin;
    } catch {
      return;
    }
    if (declaredOrigin === configuredOrigin) return;

    throw Err.validation(
      ValidationErrorCode.INVALID_INPUT,
      'This listing is not registered with this Shop, so checkout cannot continue here.',
      {
        service: ErrorService.Marketplace,
        operation: 'assertSellerAuthorityRoutable',
        context: {
          sellerPubky,
          declaredOrigin: declaredOrigin.length <= 64 ? declaredOrigin : declaredOrigin.slice(0, 64),
          configuredOrigin: configuredOrigin.length <= 64 ? configuredOrigin : configuredOrigin.slice(0, 64),
          kind: command.kind,
        },
      },
    );
  }

  /**
   * Starts the interactive Marketplace Transaction Service session flow:
   * returns the `pubkyauth://` authorization URL to hand to the user's signer
   * (QR or deeplink) plus a lazy `awaitSession` that resolves once the signer
   * approves and the AuthToken is exchanged for a bearer session. AuthTokens
   * are single-use, so every retry must come back through here for a fresh
   * flow. Durable modes only; the service fails closed otherwise.
   */
  static beginMarketplaceSessionFlow() {
    return MarketplaceSessionService.beginSessionFlow();
  }

  /**
   * Mints a marketplace session from the Shop's own sign-in grant, with no
   * signer approval. Nothing is installed: the caller installs it with
   * {@link installGrantMarketplaceSession} once it knows the identity is
   * unchanged. Throws when the service refuses.
   */
  static async mintMarketplaceSessionFromGrant({ grant, pubky }: { grant: GrantSession; pubky: string }) {
    return await MarketplaceGrantSessionService.mint({ grant, pubky });
  }

  static installGrantMarketplaceSession(minted: MintedGrantSession, expectedPubky: string) {
    return MarketplaceSessionService.establishClaimedGrantSession(minted, expectedPubky);
  }

  /** Best-effort revoke of a minted session nobody will use. */
  static async revokeGrantMarketplaceSession(minted: MintedGrantSession): Promise<void> {
    await MarketplaceGrantSessionService.revoke({ token: minted.token, sessionId: minted.sessionId });
  }

  static currentHomeserverGrantIsFull(): boolean {
    return HomeserverService.currentSessionHasFullGrant();
  }

  /**
   * Restores the account-scoped marketplace session persisted in
   * `localStorage`, returning its public facts (never the token) or null
   * when nothing valid is persisted for this account.
   */
  static restoreMarketplaceSession(pubky: string) {
    return MarketplaceSessionService.restorePersistedSession(pubky);
  }

  static restoreInventorySession(pubky: string) {
    return CommerceInventoryApplication.restoreInventorySession(pubky);
  }

  /**
   * Drops the Marketplace Transaction Service session this tab holds, with
   * only its own persisted record (a newer bearer another tab persisted
   * stays). The published-receipt memo backs the user-visible `published`
   * status, so it is cleared here too — session teardown matches the store
   * reset, and a later account re-reads its receipts instead of trusting a
   * prior session. The persisted Lock Server creator session is not this
   * bearer's and stays; sign-out removes it.
   */
  static clearMarketplaceSession(): void {
    MarketplaceSessionService.clearSession('cleared');
    this.clearSessionScopedState();
  }

  /**
   * Sign-out and account switch: also removes the purchase bearer and Lock
   * Server creator session another tab persisted, because none may outlive
   * the user who is leaving.
   */
  static clearMarketplaceSessionForSignOut(options?: { confirmBff?: boolean }): void | Promise<void> {
    const cleanup = MarketplaceSessionService.clearForSignOut(options);
    RetiredLocksSessionStorage.clear();
    this.clearSessionScopedState();
    return cleanup;
  }

  /**
   * Account switch without a sign-out: the purchase, Studio and Lock Server
   * sessions of any account but `keepPubky` go from memory and from rest,
   * with the caches that belonged to the account that left.
   */
  static clearMarketplaceSessionsOfOtherAccounts(keepPubky: string): void {
    MarketplaceSessionService.clearOtherAccounts(keepPubky);
    CommerceInventoryApplication.clearInventorySessionsOfOtherAccounts(keepPubky);
    RetiredLocksSessionStorage.clear();
    this.clearSessionScopedState();
  }

  private static clearSessionScopedState(): void {
    this.publishedReceiptUrls.clear();
    this.ownReviewHomeserverMisses.clear();
    this.deletedOwnReviews.clear();
    CommercePrivKeyringApplication.clear();
  }

  static clearInventorySession(): void {
    CommerceInventoryApplication.clearInventorySession();
  }

  static clearInventorySessionForSignOut(): void {
    CommerceInventoryApplication.clearInventorySessionForSignOut();
  }

  /**
   * Controllers subscribe here so a transport-side `clearSession` (TTL, 401,
   * sign-out) can null the zustand copy without the service touching stores.
   */
  static onMarketplaceSessionEnded(listener: (event: MarketplaceSessionEndedEvent) => void): () => void {
    return MarketplaceSessionService.onSessionEnded(listener);
  }

  static onInventorySessionEnded(listener: (event: MarketplaceSessionEndedEvent) => void): () => void {
    return CommerceInventoryApplication.onInventorySessionEnded(listener);
  }

  static beginInventorySessionFlow(expectedPubky: string) {
    return CommerceInventoryApplication.beginInventorySessionFlow(expectedPubky);
  }

  /**
   * True while `MarketplaceSessionService.getActiveSession()` still holds a
   * token inside the expiry margin. Callers must not duplicate that TTL rule.
   */
  static hasActiveMarketplaceSession(): boolean {
    return MarketplaceSessionService.getActiveSession() !== null;
  }

  static async getMarketplaceListingProjection(actorPubky: string | null, aggregateId: string) {
    return await MarketplaceGatewayService.getListing(actorPubky, aggregateId);
  }

  static async getMarketplaceSellerListingProjection(actorPubky: string, aggregateId: string) {
    return await MarketplaceGatewayService.getSellerListing(actorPubky, aggregateId);
  }

  static async getMarketplaceListingBids(actorPubky: string | null, aggregateId: string) {
    return await MarketplaceGatewayService.getListingBids(actorPubky, aggregateId);
  }

  static async getMarketplaceConversations(actorPubky: string) {
    return await MarketplaceGatewayService.getConversations(actorPubky);
  }

  static async getMarketplaceOffers(actorPubky: string) {
    return await MarketplaceGatewayService.getOffers(actorPubky);
  }

  /**
   * The account's marketplace notifications. In durable modes a
   * `message_received` row is never returned: private messages are
   * end-to-end encrypted, no service writer can attest them, and a row naming
   * a sender would show who wrote without the mute list being consulted.
   * Durable messaging is surfaced only by the inbox, which applies it.
   */
  static async getMarketplaceNotifications(actorPubky: string) {
    const notifications = await MarketplaceGatewayService.getNotifications(actorPubky);
    if (!isDurableCommerceMode(getCommerceAdapterMode())) return notifications;
    this.retryReleasedReviews(actorPubky, notifications);
    return notifications.filter((notification) => notification.type !== 'message_received');
  }

  /** Notifications whose `review_released` already started a retry in this tab, so each starts one. */
  private static releaseNotificationsSeen = new Set<string>();

  /** Test seam: forgets which release notifications this tab already acted on. */
  static resetReleaseNotificationMemo(): void {
    this.releaseNotificationsSeen.clear();
  }

  /**
   * A `review_released` notification means the service now issues the
   * attestations of that order's reviews: the user's withheld review for it
   * is retried at once, once per notification, instead of waiting for the
   * next orders load. The retry runs beside the notification read, never in
   * front of it, and a failure is logged inside the retry.
   */
  private static retryReleasedReviews(actorPubky: string, notifications: MarketplaceNotificationEntry[]): void {
    for (const notification of notifications) {
      if (!isRecognizedMarketplaceNotification(notification) || notification.type !== 'review_released') continue;
      const orderId = orderIdFromMarketplaceAggregateId(notification.aggregateId);
      const seen = `${actorPubky}|${notification.id}`;
      if (orderId === null || this.releaseNotificationsSeen.has(seen)) continue;
      this.releaseNotificationsSeen.add(seen);
      void this.resumeAwaitingReleaseReviews(actorPubky, orderId).catch((error) => {
        Logger.warn('Retrying a released review failed', { orderId, error });
      });
    }
  }

  static async getMarketplaceNotificationPreferences(actorPubky: string) {
    return await MarketplaceGatewayService.getNotificationPreferences(actorPubky);
  }

  static async getMarketplaceOrders(actorPubky: string) {
    return await MarketplaceGatewayService.getOrders(actorPubky);
  }

  static async getMarketplacePayment(actorPubky: string, paymentId: string) {
    return await MarketplaceGatewayService.getPayment(actorPubky, paymentId);
  }

  static async confirmBitcoinPayment(actorPubky: string, orderId: string, reason?: string, releaseDigital = false) {
    return await MarketplaceGatewayService.confirmBitcoinPayment(actorPubky, orderId, reason, releaseDigital);
  }

  /**
   * The seller's own automatic confirmation: confirms, as the seller, every
   * open order of theirs whose payment waits for them and matched (see
   * `autoConfirmableRail`). Each candidate is re-read in full first, and a
   * failed confirmation leaves that order for the seller without stopping the
   * rest. `isStillEnabled` is asked before every confirmation, so a seller who
   * turns the setting off mid-pass confirms nothing more. Every request carries
   * `signal`; once it aborts the pass ends, so a request that never answers
   * cannot hold it open. Returns the ids it confirmed.
   */
  static async autoConfirmSellerPayments(
    sellerPubky: string,
    isStillEnabled: () => boolean,
    signal: AbortSignal,
  ): Promise<string[]> {
    const orders = await MarketplaceGatewayService.getOrders(sellerPubky, { signal });
    const confirmed: string[] = [];
    for (const row of orders) {
      if (signal.aborted) break;
      if (!mayAwaitSellerConfirmation(row, sellerPubky)) continue;
      try {
        const order = await MarketplaceGatewayService.getOrder(sellerPubky, row.id, { signal });
        const rail = order ? autoConfirmableRail(order, sellerPubky) : null;
        if (rail !== null && !isStillEnabled()) break;
        const releaseDigital = order !== null && hasInstantDigitalLines(order);
        if (rail === 'paykit') {
          await MarketplaceGatewayService.confirmBitcoinPayment(
            sellerPubky,
            row.id,
            SELLER_AUTO_CONFIRM_REASON,
            releaseDigital,
            { signal },
          );
        } else if (rail === 'paypal') {
          await MarketplaceGatewayService.confirmFiatReceived(sellerPubky, row.id, releaseDigital, { signal });
        } else {
          continue;
        }
        confirmed.push(row.id);
      } catch (error) {
        Logger.warn('Automatic seller payment confirmation failed; the order stays with the seller', {
          orderId: row.id,
          error,
        });
      }
    }
    return confirmed;
  }

  static async resolveBitcoinPayment(
    actorPubky: string,
    orderId: string,
    input: {
      outcome: 'paid' | 'refunded' | 'abandoned';
      reason?: string;
      externalRefundReference?: string;
    },
    idempotencyKey: string,
  ) {
    return await MarketplaceGatewayService.resolveBitcoinPayment(actorPubky, orderId, input, idempotencyKey);
  }

  // --- Seller-configurable payment methods (durable service only) ----------

  /**
   * The seller's public payment config. While Bitcoin is not offered, the
   * service's `/health` is read too, so a Paykit outage is reported as such
   * (`paykitUnreachable`) instead of reading as a seller with no setup. A
   * failed health read says nothing, so it leaves the config as the service
   * returned it.
   */
  static async getSellerPaymentConfig(sellerPubky: string): Promise<SellerPaymentConfig> {
    const config = await MarketplaceGatewayService.getSellerPaymentConfig(sellerPubky);
    if (config.bitcoinAvailable && config.bitcoinOfferAvailable) return config;
    const rail = await MarketplaceGatewayService.getPaykitRailStatus().catch(() => 'unknown' as const);
    return rail === 'unreachable' ? { ...config, paykitUnreachable: true } : config;
  }

  /**
   * Whether the buyer can receive a Bitcoin payment request from the Shop's
   * Paykit server (see {@link BuyerPaykitWallet}). The registry wins over
   * receiver markers: Bitkit 2.6 keeps the markers 2.5 published but no
   * longer answers on them. So a registry read that fails (anything but a
   * 404, already logged by the homeserver service) is `unverified`, never a
   * marker verdict. Rejects only when the marker read fails after the
   * registry was ruled out. With `paykitServerApi=upstream` the registry
   * alone decides (see {@link appRegistryTakesPaymentRequests}).
   */
  static async fetchBuyerPaykitWallet(buyerPubky: string): Promise<BuyerPaykitWallet> {
    const upstream = getPaykitServerApi() === 'upstream';
    let registry: { found: false } | { found: true; json: unknown };
    try {
      registry = await HomeserverService.getJsonIfFound<unknown>({
        url: paykitAppRegistryUrl(buyerPubky),
        logUrl: PAYKIT_APP_REGISTRY_PATH,
        publicRead: true,
      });
    } catch {
      return 'unverified';
    }
    // Upstream Paykit delivers only to an App Registry wallet that also
    // published its signed key authorization: markers never decide. The
    // Shop checks the authorization is there; Paykit verifies its signature.
    if (upstream) {
      if (!registry.found || !appRegistryTakesPaymentRequests(registry.json)) return 'not_payable';
      try {
        const authorization = await HomeserverService.getJsonIfFound<unknown>({
          url: paykitReaderAuthorizationUrl(buyerPubky),
          logUrl: PAYKIT_READER_AUTHORIZATION_PATH,
          publicRead: true,
        });
        return authorization.found ? 'payable' : 'not_payable';
      } catch {
        return 'unverified';
      }
    }
    if (registry.found && foundAppRegistryShowsNewWallet(registry.json)) return 'unsupported';
    return (await PaykitReceiverService.hasPaymentRequestReceiver(buyerPubky)) ? 'payable' : 'not_payable';
  }

  /**
   * pubky/pubky-marketplace#371: the Arbitrum USDT address the
   * buyer's Paykit wallet publishes as a public `usdt-arbitrum-address`
   * endpoint, from the first app in their App Registry that has one. Null
   * when none is published or anything cannot be read: the buyer then types
   * an address as before.
   */
  static async fetchBuyerPaykitUsdtAddress(buyerPubky: string): Promise<string | null> {
    let appIds: string[];
    try {
      const registry = await HomeserverService.getJsonIfFound<unknown>({
        url: paykitAppRegistryUrl(buyerPubky),
        logUrl: PAYKIT_APP_REGISTRY_PATH,
      });
      appIds = registry.found ? paykitRegistryAppIds(registry.json) : [];
    } catch {
      return null;
    }
    for (const appId of appIds.slice(0, PAYKIT_REFUND_MAX_APPS)) {
      // An app that doesn't publish the endpoint is an expected miss, not an error.
      try {
        const endpoint = await HomeserverService.getJsonIfFound<unknown>({
          url: paykitEndpointUrl(buyerPubky, appId, USDT_ARBITRUM_ENDPOINT_ID),
          logUrl: `/pub/paykit/v0/apps/${appId}/endpoints/${USDT_ARBITRUM_ENDPOINT_ID}`,
          maxBytes: PAYKIT_ENDPOINT_MAX_BYTES,
          tolerateUnreachable: true,
        });
        const address = endpoint.found ? usdtAddressFromEndpointPayload(endpoint.json) : null;
        if (address) return address;
      } catch {
        // An unreadable endpoint: try the next app.
      }
    }
    return null;
  }

  static async getMyPaymentConfig(actorPubky: string) {
    return await MarketplaceGatewayService.getMyPaymentConfig(actorPubky);
  }

  static async putMyPaymentConfig(
    actorPubky: string,
    input: {
      bitcoinEnabled: boolean;
      paypalMerchantEmail: string | null;
      usdtEnabled?: boolean;
    },
  ) {
    return await MarketplaceGatewayService.putMyPaymentConfig(actorPubky, input);
  }

  static async bindPaymentMethod(
    actorPubky: string,
    orderId: string,
    method: PaymentMethodKind,
    delivery?: BindDeliveryAddress,
  ) {
    return await MarketplaceGatewayService.bindPaymentMethod(actorPubky, orderId, method, delivery);
  }

  static async markFiatPaid(actorPubky: string, orderId: string, transactionRef?: string) {
    return await MarketplaceGatewayService.markFiatPaid(actorPubky, orderId, transactionRef);
  }

  static async confirmFiatReceived(actorPubky: string, orderId: string, releaseDigital = false) {
    return await MarketplaceGatewayService.confirmFiatReceived(actorPubky, orderId, releaseDigital);
  }

  static async getMarketplaceReceipt(actorPubky: string, receiptId: string) {
    return await MarketplaceGatewayService.getReceipt(actorPubky, receiptId);
  }

  static async getMarketplaceOrder(actorPubky: string, orderId: string) {
    return await MarketplaceGatewayService.getOrder(actorPubky, orderId);
  }

  static async uploadMarketplaceAttachment(actorPubky: string, recipientPubky: string, file: File) {
    return await MarketplaceGatewayService.uploadAttachment(actorPubky, recipientPubky, file);
  }

  static async fetchMarketplaceAttachment(actorPubky: string, attachmentId: string) {
    return await MarketplaceGatewayService.fetchAttachment(actorPubky, attachmentId);
  }

  static async submitLocksPaykitProof(params: {
    creatorPubky: string;
    readerPubky: string;
    bundleId: string;
    lockResource: string;
    criterionId: string;
  }) {
    return await LocksGatewayService.submitPaykitProof(params);
  }

  /**
   * The buyer's side of a real Locks/Paykit payment (`locks-paykit` mode):
   *
   * 0. Prepare the payment with `payment.prepare_locks` (replayed when it
   *    already is), which the service requires before registration.
   * 1. Generate (or reuse a persisted, not-yet-registered) bundle id and
   *    submit the proof bundle to the Lock Server, which requests the real
   *    Paykit invoice and delivers the private Payment Request to the buyer's
   *    wallet.
   * 2. Register the correlation with the transaction service via
   *    `payment.register_locks` with only the payment and bundle ids, at the
   *    revision the preparation left.
   *
   * This NEVER advances the payment: registration flips the payment to the
   * `locks` adapter and the service's worker independently verifies the Locks
   * lifecycle before confirming (ADR-0019 §7). Returns the raw command
   * response so callers can apply the standard revision-conflict handling
   * (refetch and retry). The correlation — including the bearer bundle id —
   * is persisted in the buyer's account-scoped database so the flow survives
   * a reload and the purchased content stays unlockable.
   */
  static async beginMarketplaceLocksPayment({
    buyerPubky,
    order,
    payment,
    digitalLock,
  }: {
    buyerPubky: string;
    order: MarketplaceOrder;
    payment: MarketplacePayment;
    digitalLock: CommerceDigitalLock;
  }): Promise<MarketplaceCommandResponse> {
    if (getCommerceAdapterMode() !== 'locks-paykit') {
      throw Err.client(ClientErrorCode.BAD_REQUEST, 'Real Locks/Paykit payments are not enabled in this deployment.', {
        service: ErrorService.Locks,
        operation: 'beginMarketplaceLocksPayment',
      });
    }
    const creator = lockPolicyCreator(digitalLock.policyUri);
    const bareLockResource = toBareLockResource(digitalLock.policyUri);
    if (!creator || !bareLockResource) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'The listing carries an invalid Locks policy URI.', {
        service: ErrorService.Locks,
        operation: 'beginMarketplaceLocksPayment',
      });
    }
    if (creator !== order.sellerPubky) {
      // The service enforces this too; refusing here keeps a mismatched lock
      // from ever producing an upstream lifecycle.
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'The lock creator is not this order\u2019s seller.', {
        service: ErrorService.Locks,
        operation: 'beginMarketplaceLocksPayment',
      });
    }

    const existing = await LocalCommerceService.getLocksCorrelation(buyerPubky, payment.id);
    // Prepare first: the service checks the seller's lock against the
    // checkout snapshot, takes the hold and pins the `locks` adapter, so a
    // refused payment never gets a Lock Server invoice. A repeat replays a
    // live preparation, so a bundle submitted earlier (or before the service
    // required this step) still registers after it. Locks takes no client
    // reference yet (pubky/locks#52), so the minted one is not sent.
    let expectedRevision = payment.revision;
    if (!existing?.registered) {
      const prepared = await MarketplaceGatewayService.execute(buyerPubky, {
        version: 1,
        commandId: crypto.randomUUID(),
        aggregateId: buildMarketplacePaymentAggregateId(payment.id),
        expectedRevision,
        issuedAt: new Date().toISOString(),
        kind: 'payment.prepare_locks',
        payload: { paymentId: payment.id },
      });
      if (!prepared.ok) return prepared;
      expectedRevision = prepared.revision;
    }
    let bundleId = existing?.bundle_id;
    const submit = async (id: string) => {
      await LocksGatewayService.submitPaykitProof({
        creatorPubky: creator,
        readerPubky: buyerPubky,
        bundleId: id,
        lockResource: digitalLock.policyUri,
        criterionId: digitalLock.criterionId,
      });
    };
    if (!existing) {
      bundleId = await LocksGatewayService.generateBundleId();
      // Persist BEFORE the submit: the bundle id is the buyer's only handle on
      // the upstream lifecycle. A Lock Server with durable invoice admission
      // (pubky/locks#72) keeps the task even when its response is lost, so a
      // retry must find that task again rather than mint a second one.
      await LocalCommerceService.upsertLocksCorrelation({
        owner_id: buyerPubky,
        payment_id: payment.id,
        order_id: order.id,
        seller_pubky: creator,
        bundle_id: bundleId,
        policy_uri: digitalLock.policyUri,
        criterion_id: digitalLock.criterionId,
        content_path: digitalLock.contentPath,
        resource_hash: digitalLock.resourceHash,
        window_expires_at: null,
        registered: false,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
      await submit(bundleId);
    } else if (!existing.registered) {
      // An unregistered correlation may predate a submit that never reached the
      // Lock Server. Look the task up: if it exists the buyer keeps polling it,
      // and only a missing task is submitted, with the same bundle id. A
      // submitted bundle is never submitted again.
      const task = await LocksGatewayService.findVerification(creator, existing.bundle_id);
      if (!task) await submit(existing.bundle_id);
    }

    const response = await MarketplaceGatewayService.execute(buyerPubky, {
      version: 1,
      commandId: crypto.randomUUID(),
      aggregateId: buildMarketplacePaymentAggregateId(payment.id),
      expectedRevision,
      issuedAt: new Date().toISOString(),
      kind: 'payment.register_locks',
      payload: { paymentId: payment.id, bundleId: bundleId! },
    });
    if (response.ok) {
      const verification = (response.result as { verification?: { windowExpiresAt?: string } }).verification;
      await LocalCommerceService.markLocksCorrelationRegistered(
        buyerPubky,
        payment.id,
        verification?.windowExpiresAt ?? null,
        Date.now(),
      );
    }
    return response;
  }

  static async getMarketplaceLocksCorrelation(buyerPubky: string, paymentId: string) {
    return await LocalCommerceService.getLocksCorrelation(buyerPubky, paymentId);
  }

  /**
   * Redeems a confirmed Locks payment for the purchased digital content:
   * issues the short-lived access credential from the persisted bundle id,
   * reads the guarded bytes through the Lock Server proxy, and verifies their
   * BLAKE3 hash against the hash the seller published in the listing record.
   * A hash mismatch is a content-integrity failure and throws — the bytes are
   * never returned as if they were the purchased content.
   */
  static async unlockMarketplaceLocksContent(
    buyerPubky: string,
    paymentId: string,
  ): Promise<{ bytes: Uint8Array; contentPath: string }> {
    const correlation = await LocalCommerceService.getLocksCorrelation(buyerPubky, paymentId);
    if (!correlation) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'No Locks correlation is stored for this payment.', {
        service: ErrorService.Locks,
        operation: 'unlockMarketplaceLocksContent',
      });
    }
    const credential = await LocksGatewayService.issueAccessCredential(correlation.seller_pubky, correlation.bundle_id);
    const blob = await LocksGatewayService.fetchGuardedContent(correlation.content_path, credential.credential);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const digest = bytesToHex(blake3(bytes));
    if (digest !== correlation.resource_hash) {
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'The delivered content does not match the listed hash.', {
        service: ErrorService.Locks,
        operation: 'unlockMarketplaceLocksContent',
        context: { contentPath: correlation.content_path },
      });
    }
    return { bytes, contentPath: correlation.content_path };
  }

  static async lookupLocksVerification(creatorPubky: string, bundleId: string) {
    return await LocksGatewayService.lookupVerification(creatorPubky, bundleId);
  }

  /**
   * The buyer's view of the Lock Server task behind a Locks payment: wallet
   * setup in progress, a terminal admission failure, or neither. `null` when
   * no correlation is stored or the Lock Server holds no task for it.
   */
  static async fetchMarketplaceLocksAdmission(buyerPubky: string, paymentId: string) {
    const correlation = await LocalCommerceService.getLocksCorrelation(buyerPubky, paymentId);
    if (!correlation) return null;
    const lifecycle = await LocksGatewayService.findVerification(correlation.seller_pubky, correlation.bundle_id);
    return lifecycle ? locksAdmissionView(lifecycle) : null;
  }

  static async issueLocksAccessCredential(creatorPubky: string, bundleId: string) {
    return await LocksGatewayService.issueAccessCredential(creatorPubky, bundleId);
  }

  static async fetchLocksGuardedContent(relativePath: string, credential: string) {
    return await LocksGatewayService.fetchGuardedContent(relativePath, credential);
  }

  static getPaykitSetupUrl(returnTo: string, state: string, creator: string) {
    return LocksGatewayService.buildPaykitSetupUrl(returnTo, state, creator);
  }

  static getPaykitReconnectUrl(returnTo: string, state: string, creator: string) {
    return LocksGatewayService.buildPaykitReconnectUrl(returnTo, state, creator);
  }

  /**
   * The bitcoin price in every listing currency, from one Blocktank snapshot,
   * for the indicative "≈" price hints shown beside listing prices.
   * Display-only: nothing transactional consumes these rates (the service
   * fixes the amount actually charged at checkout), and it throws when
   * unavailable so the UI shows no hint instead of a stale or invented number.
   */
  static async getIndicativeBtcRate(): Promise<BtcRate> {
    const { fiatPerBtc } = buildFxRateSnapshot(await ExchangerateService.getIndicativeTickers());
    const btcUsd = Number(fiatPerBtc.USD);
    if (!Number.isFinite(btcUsd) || btcUsd <= 0) {
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'BTCUSD ticker not found in API response', {
        service: ErrorService.Exchangerate,
        operation: 'getIndicativeBtcRate',
      });
    }
    return { btcUsd, satUsd: btcUsd / BASE_UNITS_PER_BITCOIN, lastUpdatedAt: new Date(), fiatPerBtc };
  }

  static async isFavorite(ownerPubky: string, listingId: string): Promise<boolean> {
    return await LocalCommerceService.isFavorite(ownerPubky, listingId);
  }

  static async getCartItems(ownerPubky: string) {
    return await LocalCommerceService.getCartItems(ownerPubky);
  }

  static async commitUpsertCartItem(
    ownerPubky: string,
    listingId: string,
    variantId: string,
    quantity: number,
  ): Promise<void> {
    await LocalCommerceService.upsertCartItem(ownerPubky, listingId, variantId, quantity, Date.now());
  }

  static async commitUpsertAwardCartItem(
    ownerPubky: string,
    listingId: string,
    variantId: string,
    quantity: number,
    awardId: string,
    offerRevision: number,
  ): Promise<void> {
    await LocalCommerceService.upsertAwardCartItem(
      ownerPubky,
      listingId,
      variantId,
      quantity,
      awardId,
      offerRevision,
      Date.now(),
    );
  }

  static async commitDeleteCartItem(
    ownerPubky: string,
    listingId: string,
    variantId: string,
    awardId?: string,
  ): Promise<void> {
    await LocalCommerceService.deleteCartItem(ownerPubky, listingId, variantId, awardId);
  }

  static async commitClearCart(ownerPubky: string): Promise<void> {
    await LocalCommerceService.clearCart(ownerPubky);
  }

  static async getDeliveryAddresses(ownerPubky: string) {
    return await LocalCommerceService.getDeliveryAddresses(ownerPubky);
  }

  static async commitUpsertDeliveryAddress(
    ownerPubky: string,
    addressId: string,
    input: CommerceDeliveryAddressInput,
  ): Promise<void> {
    await LocalCommerceService.upsertDeliveryAddress(ownerPubky, addressId, input, Date.now());
  }

  static async commitDeleteDeliveryAddress(ownerPubky: string, addressId: string): Promise<void> {
    await LocalCommerceService.deleteDeliveryAddress(ownerPubky, addressId);
  }

  static async commitSetDefaultDeliveryAddress(ownerPubky: string, addressId: string): Promise<void> {
    await LocalCommerceService.setDefaultDeliveryAddress(ownerPubky, addressId, Date.now());
  }

  static async commitMarkDeliveryAddressUsed(ownerPubky: string, addressId: string): Promise<void> {
    await LocalCommerceService.markDeliveryAddressUsed(ownerPubky, addressId, Date.now());
  }

  static async getShippingPresets(ownerPubky: string) {
    return await LocalCommerceService.getShippingPresets(ownerPubky);
  }

  static async commitUpsertShippingPreset(
    ownerPubky: string,
    presetId: string,
    input: CommerceShippingPresetInput,
  ): Promise<void> {
    await LocalCommerceService.upsertShippingPreset(ownerPubky, presetId, input, Date.now());
  }

  static async commitDeleteShippingPreset(ownerPubky: string, presetId: string): Promise<void> {
    await LocalCommerceService.deleteShippingPreset(ownerPubky, presetId);
  }

  static async getFavorites(ownerPubky: string) {
    return await LocalCommerceService.getFavorites(ownerPubky);
  }

  static async commitCreateFavorite(ownerPubky: string, listingId: string): Promise<void> {
    await LocalCommerceService.createFavorite(ownerPubky, listingId, Date.now());
    await this.stageWatchlistPush(ownerPubky);
  }

  static async commitDeleteFavorite(ownerPubky: string, listingId: string): Promise<void> {
    await LocalCommerceService.deleteFavorite(ownerPubky, listingId, Date.now());
    // The watch baseline shadows the favorite row; an unwatched item must not
    // keep producing alerts. Already-created alerts stay — they were real
    // observations made while the item was watched.
    await LocalCommerceService.deleteWatchSnapshot(ownerPubky, listingId);
    await this.stageWatchlistPush(ownerPubky);
  }

  // ---------------------------------------------------------------------------
  // Cross-device watchlist sync (PRIVATE homeserver document)
  // ---------------------------------------------------------------------------

  /** In-flight sync per owner, so overlapping triggers share one round-trip. */
  private static watchlistSyncInFlight = new Map<
    string,
    { run: Promise<CommerceWatchlistSyncStatus>; purchaseSession: string; keysEpoch: number }
  >();

  /** Which purchase session a round started under: the private data key is released to it, and only to it. */
  private static watchlistPurchaseSessionId(): string {
    const session = MarketplaceSessionService.getActiveSession();
    return session ? `${session.pubky}:${session.issuedAt}` : '';
  }

  private static watchlistSyncJobId(ownerPubky: string): string {
    return `watchlist|${ownerPubky}`;
  }

  /**
   * Marks the private watchlist document dirty in the retryable outbox
   * (`commerce_sync_jobs`, same table the review outbox uses). The job id is
   * deterministic per owner because the document is whole-state — the latest
   * sync always carries every prior change, so one pending job coalesces any
   * number of toggles. Local-first: this stages only; the actual push is
   * triggered by the controller after the toggle, and any staged job that
   * outlives a failed push heals on the next watchlist sync.
   */
  private static async stageWatchlistPush(ownerPubky: string): Promise<void> {
    if (getCommerceAdapterMode() === 'sandbox') return;
    const now = Date.now();
    await LocalCommerceService.restageSyncJob({
      id: this.watchlistSyncJobId(ownerPubky),
      owner_id: ownerPubky,
      entity_type: 'watchlist',
      entity_id: ownerPubky,
      operation: 'update',
      status: 'pending',
      attempts: 0,
      next_attempt_at: now,
      last_error_code: null,
      payload: {},
      created_at: now,
      updated_at: now,
    });
  }

  /**
   * Whether the CURRENT session can use private watchlist sync, decided from
   * session facts (`session.info.capabilities`), never by probing for 403s:
   * - `capable` — the session's grant covers writing `/priv/pubky.app/`
   *   (the widened Ring grant, or the root `/:rw` of a recovery-phrase sign-in)
   * - `needs_reauth` — a live session whose grant predates the `/priv` scope;
   *   the user must approve a fresh sign-in for sync to work
   * - `no_session` — signed out or the session is still being restored
   */
  static getWatchlistSyncCapability(): CommerceWatchlistSyncCapability {
    if (!HomeserverService.hasActiveSession()) return 'no_session';
    return HomeserverService.canCurrentSessionWrite(PRIVATE_APP_DATA_PATH) ? 'capable' : 'needs_reauth';
  }

  /**
   * One full sync round of the private watchlist document: pull, merge,
   * apply locally, push back when the merge changed the remote.
   *
   * Local-first: Dexie is applied before any push, and a failed push leaves
   * the outbox job pending so the next sync heals it. The merge rule
   * (per-key LWW, tie -> tombstone) lives in `commerce.watchlist.ts`.
   *
   * Honesty contract: capability is decided from session facts up front, and
   * a 401/403 on the actual read or write ALSO returns `needs_reauth` — the
   * caller (controller) surfaces that state; nothing silently no-ops. A
   * browser without the Web Locks API gets `unsupported` and a refused lock
   * gets `error`; neither touches the homeserver.
   */
  static async syncWatchlist(ownerPubky: string): Promise<CommerceWatchlistSyncStatus> {
    if (getCommerceAdapterMode() === 'sandbox') return 'skipped';

    const capability = this.getWatchlistSyncCapability();
    if (capability === 'no_session') return 'skipped';
    if (capability === 'needs_reauth') return 'needs_reauth';

    const inFlight = this.watchlistSyncInFlight.get(ownerPubky);
    if (inFlight) {
      const outcome = await inFlight.run;
      // A round that started before the purchase session changed asked the
      // marketplace for the key without it (or with the old one), and one that
      // ended without the document while keys became available meanwhile
      // (another reader took custody of them) never read it. Its outcome says
      // nothing about the new state, so read the document again.
      const sessionChanged = inFlight.purchaseSession !== this.watchlistPurchaseSessionId();
      const keysArrived = outcome !== 'synced' && inFlight.keysEpoch !== CommercePrivKeyringApplication.getReadyEpoch();
      if (sessionChanged || keysArrived) return await this.syncWatchlist(ownerPubky);
      return outcome;
    }

    // Without a lock every tab shares, two rounds can interleave their
    // read-merge-write and one tab's change is lost. No lock, no remote work:
    // the list keeps working on this device and the outbox job stays.
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (typeof locks?.request !== 'function') return 'unsupported';

    const run = (async (): Promise<CommerceWatchlistSyncStatus> => {
      try {
        return await locks.request(`pubky-priv|watchlist|${ownerPubky}`, () => this.runWatchlistSync(ownerPubky));
      } catch (error) {
        Logger.warn('The watchlist sync lock was refused; the outbox job stays pending', privErrorSummary(error));
        return 'error';
      } finally {
        this.watchlistSyncInFlight.delete(ownerPubky);
      }
    })();
    this.watchlistSyncInFlight.set(ownerPubky, {
      run,
      purchaseSession: this.watchlistPurchaseSessionId(),
      keysEpoch: CommercePrivKeyringApplication.getReadyEpoch(),
    });
    return await run;
  }

  /** Test support: forgets in-flight rounds, as a second tab of the same origin would not see them. */
  static resetWatchlistSyncInFlight(): void {
    this.watchlistSyncInFlight.clear();
  }

  /**
   * The watchlist lives encrypted at an opaque v2 path. A plaintext v1
   * document (`watchlist.json`, written before encryption or by a cached
   * older build) is merged in, the merged state is written to v2 and read
   * back, and only then is v1 deleted. Without a key nothing is written:
   * no plaintext fallback and no empty overwrite.
   *
   * The outbox job is completed only if no change was staged after this
   * round read the local state; a later change keeps it pending.
   */
  private static async runWatchlistSync(ownerPubky: string): Promise<CommerceWatchlistSyncStatus> {
    const legacyUrl = CommerceRecordNormalizer.watchlistUri(ownerPubky);
    const jobId = this.watchlistSyncJobId(ownerPubky);
    try {
      const stagedAt = (await LocalCommerceService.getSyncJob(jobId))?.updated_at ?? null;
      const keys = await CommercePrivKeyringApplication.get(ownerPubky);
      if (keys.kind !== 'keys') return keys.kind === 'needs_reauth' ? 'needs_marketplace_approval' : keys.kind;
      const { keyring } = keys;

      let encrypted: CommerceWatchlistRecord | null = null;
      try {
        const payload = await CommercePrivStoreService.read(keyring, 'watchlist', WATCHLIST_PRIV_ENTRY_ID);
        if (payload !== null) encrypted = CommerceRecordNormalizer.watchlistRecord(payload);
      } catch (error) {
        if (this.isPrivateAccessDenied(error)) return 'needs_reauth';
        throw error;
      }
      let legacy: CommerceWatchlistRecord | null = null;
      try {
        const stored = await CommerceHomeserverService.fetchJsonIfFound(legacyUrl, PRIV_V1_LOG_PATH);
        if (stored.found) legacy = CommerceRecordNormalizer.watchlistRecord(stored.json);
      } catch (error) {
        if (this.isPrivateAccessDenied(error)) return 'needs_reauth';
        throw error;
      }

      const [favorites, tombstoneRows] = await Promise.all([
        LocalCommerceService.getFavorites(ownerPubky),
        LocalCommerceService.getWatchTombstones(ownerPubky),
      ]);
      const localState = localRowsToWatchlistState(favorites, tombstoneRows);
      const encryptedState = encrypted ? watchlistRecordToState(encrypted) : emptyWatchlistState();
      const remoteState = legacy
        ? mergeWatchlistStates(encryptedState, watchlistRecordToState(legacy))
        : encryptedState;
      const merged = mergeWatchlistStates(localState, remoteState);

      if (!watchlistStatesEqual(merged, localState)) {
        await LocalCommerceService.applyWatchlistState(ownerPubky, merged.items, merged.tombstones);
      }

      const isEmptyAndUnpublished = !encrypted && !legacy && merged.items.size === 0 && merged.tombstones.size === 0;
      const remoteNeedsWrite = !isEmptyAndUnpublished && (!encrypted || !watchlistStatesEqual(merged, encryptedState));
      if (remoteNeedsWrite) {
        const remote = encrypted ?? legacy;
        const nowIso = new Date().toISOString();
        const createdAt = remote?.createdAt ?? nowIso;
        // Guard against clock skew between devices: updatedAt must not
        // precede createdAt or the record fails its own validation.
        const updatedAt = Date.parse(createdAt) > Date.now() ? createdAt : nowIso;
        const body = watchlistStateToRecordBody({
          ownerPubky,
          state: merged,
          revision: Math.max(encrypted?.revision ?? 0, legacy?.revision ?? 0) + 1,
          createdAt,
          updatedAt,
        });
        // Validate through the vendored specs builder before sealing, the
        // same guarantee every other marketplace record gets.
        const { PubkySpecsBuilder } = await import('pubky-app-specs');
        const built = new PubkySpecsBuilder(ownerPubky).createWatchlist(body);
        const record = CommerceRecordNormalizer.watchlistRecord(built.watchlist.toJson());
        try {
          await CommercePrivStoreService.write(keyring, 'watchlist', WATCHLIST_PRIV_ENTRY_ID, { ...record });
        } catch (error) {
          if (this.isPrivateAccessDenied(error)) return 'needs_reauth';
          throw error;
        }
      }
      // v2 now holds a state that includes every v1 entry and tombstone.
      if (legacy) {
        assertPrivKeyringLive(keyring);
        await CommerceHomeserverService.delete(legacyUrl, PRIV_V1_LOG_PATH);
      }

      await LocalCommerceService.completeSyncJobIfUnchanged(jobId, stagedAt);
      return 'synced';
    } catch (error) {
      Logger.warn('Watchlist sync failed; the outbox job stays pending', privErrorSummary(error));
      return 'error';
    }
  }

  /**
   * 403 (scope refused) or 401 (session rejected) on the private document,
   * for a session that a step-up approval can widen. A grant session already
   * holds the full Shop grant (enforced at sign-in and restore), so a refusal
   * means its grant is no longer honored (revoked or expired), which no
   * step-up QR can fix: the round fails and retries on the next load.
   */
  private static isPrivateAccessDenied(error: unknown): boolean {
    const denied = hasHttpStatus(error, HttpStatusCode.FORBIDDEN) || hasHttpStatus(error, HttpStatusCode.UNAUTHORIZED);
    return denied && !HomeserverService.isCurrentSessionGrant();
  }

  // ---------------------------------------------------------------------
  // Portable order receipts (PRIVATE homeserver documents)
  // ---------------------------------------------------------------------

  /**
   * Session-scoped memo of encrypted receipt URLs confirmed present on the
   * owner's homeserver, so one browsing session re-reads each receipt entry
   * at most once. Keyed by the full owner-scoped URL, so an account switch
   * cannot bleed publication state across identities.
   */
  private static publishedReceiptUrls = new Set<string>();

  /** Test support: clears the session-scoped published-receipt memo. */
  static resetReceiptPublicationMemo(): void {
    this.publishedReceiptUrls.clear();
  }

  /**
   * Moves plaintext v1 receipts (`/priv/pubky.app/marketplace/v1/receipts/`)
   * into encrypted entries. Each one is parsed; when no sealed entry exists
   * it is written sealed and read back, and when one exists it must open to
   * exactly the same record. Only then is the plaintext deleted. A sealed
   * entry that differs, fails validation or does not open is never
   * overwritten, and both copies stay. One bounded batch per call; a file
   * that does not parse, or names another receipt than its path, stays in
   * place and leaves the pass incomplete.
   */
  private static async migratePlaintextReceipts(
    ownerPubky: string,
    keyring: PrivKeyring,
  ): Promise<'done' | 'incomplete' | 'needs_reauth'> {
    let urls: string[];
    try {
      urls = await CommerceHomeserverService.list(
        CommerceRecordNormalizer.orderReceiptDirectoryUri(ownerPubky),
        RECEIPT_MIGRATION_BATCH,
        PRIV_V1_LOG_PATH,
      );
    } catch (error) {
      if (this.isPrivateAccessDenied(error)) return 'needs_reauth';
      Logger.warn(
        'Listing plaintext order receipts failed; the move retries on the next orders load',
        privErrorSummary(error),
      );
      return 'incomplete';
    }
    let incomplete = urls.length >= RECEIPT_MIGRATION_BATCH;
    for (const url of urls) {
      const receiptId = url.slice(url.lastIndexOf('/') + 1);
      try {
        const sealedUrl = privEntryUrl(keyring, 'order_receipt', receiptId);
        const legacy = CommerceRecordNormalizer.orderReceiptRecord(
          await CommerceHomeserverService.fetchJson(url, PRIV_V1_LOG_PATH),
        );
        if (legacy.receiptId !== receiptId || legacy.ownerPubky !== ownerPubky) {
          incomplete = true;
          continue;
        }
        const sealed = await CommercePrivStoreService.read(keyring, 'order_receipt', receiptId);
        if (sealed === null) {
          await CommercePrivStoreService.write(keyring, 'order_receipt', receiptId, { ...legacy });
        } else if (!this.isSameReceipt(sealed, legacy)) {
          Logger.warn('A sealed order receipt differs from its plaintext copy; both are kept');
          incomplete = true;
          continue;
        }
        assertPrivKeyringLive(keyring);
        await CommerceHomeserverService.delete(url, PRIV_V1_LOG_PATH);
        if (this.verifiedSealedReceipt(sealed ?? legacy, ownerPubky, receiptId) !== null) {
          this.publishedReceiptUrls.add(sealedUrl);
        }
      } catch (error) {
        if (this.isPrivateAccessDenied(error)) return 'needs_reauth';
        if (isPrivKeyringRevoked(error)) return 'incomplete';
        Logger.warn(
          'Moving a plaintext order receipt failed; it retries on the next orders load',
          privErrorSummary(error),
        );
        incomplete = true;
      }
    }
    return incomplete ? 'incomplete' : 'done';
  }

  /** Whether a decrypted sealed receipt is exactly the validated plaintext one. */
  private static isSameReceipt(sealed: unknown, legacy: CommerceOrderReceiptRecord): boolean {
    try {
      return JSON.stringify(CommerceRecordNormalizer.orderReceiptRecord(sealed)) === JSON.stringify(legacy);
    } catch {
      return false;
    }
  }

  /**
   * A decrypted receipt counts as published only when it is a valid order
   * receipt of this owner, for this receipt id, whose attestations verify.
   */
  private static verifiedSealedReceipt(
    sealed: unknown,
    ownerPubky: string,
    receiptId: string,
  ): CommerceOrderReceiptRecord | null {
    let record: CommerceOrderReceiptRecord;
    try {
      record = CommerceRecordNormalizer.orderReceiptRecord(sealed);
    } catch {
      return null;
    }
    if (record.receiptId !== receiptId || record.ownerPubky !== ownerPubky) return null;
    if (verifyOwnOrderReceipt({ ...record }) === null) return null;
    if (record.editionAttestation !== undefined && verifyOwnDropEdition({ ...record }) === null) return null;
    return record;
  }

  /**
   * Publishes the portable order receipt (specs `0.6.2-marketplace.7`) for
   * every eligible paid order to the CURRENT user's own homeserver, sealed
   * at the opaque v2 entry for its receipt id, and first moves any
   * plaintext v1 receipts there — the "credible exit for orders" record: killing
   * the marketplace operator must still leave a signed, verifiable purchase
   * history on the participants' homeservers.
   *
   * The document embeds the service attestor's deterministic
   * `pubky-order-receipt+v1` JWS (re-fetchable idempotently), and the
   * record's fields are taken from the VERIFIED claims, never from local
   * projections, so record and attestation cannot disagree. The client
   * re-runs the offline verification recipe before every PUT and refuses to
   * publish anything that does not verify.
   *
   * Failure semantics mirror the watchlist document: capability is decided
   * from session facts, absence of an attestor is an honest `unavailable`,
   * and a failed PUT simply retries on the next orders-surface load (the
   * homeserver read is the durable "already published" check — no local
   * marker table to drift). The returned status is what the controller
   * mirrors into the store: a narrow (bridged or legacy) grant, or a
   * session the marketplace will not release the data key to, reports
   * `needs_reauth` instead of returning without a trace. Without a key
   * nothing is written; a sealed entry that does not decrypt is never
   * overwritten.
   */
  static async publishOrderReceipts(
    ownerPubky: string,
    orders: MarketplaceOrder[],
  ): Promise<CommerceReceiptPublicationStatus> {
    if (!isDurableCommerceMode(getCommerceAdapterMode())) return 'skipped';
    if (!HomeserverService.hasActiveSession()) return 'skipped';
    if (!HomeserverService.canCurrentSessionWrite(PRIVATE_APP_DATA_PATH)) return 'needs_reauth';

    let keys: MarketplacePrivKeysResult;
    try {
      keys = await CommercePrivKeyringApplication.get(ownerPubky);
    } catch (error) {
      Logger.warn(
        'The private data key could not be read; receipts retry on the next orders load',
        privErrorSummary(error),
      );
      return 'unavailable';
    }
    if (keys.kind !== 'keys') return keys.kind === 'needs_reauth' ? 'needs_marketplace_approval' : keys.kind;
    const { keyring } = keys;
    const migration = await this.migratePlaintextReceipts(ownerPubky, keyring);
    if (migration === 'needs_reauth') return 'needs_reauth';

    const eligible = orders.filter(
      (order) =>
        typeof order.receiptId === 'string' && (order.buyerPubky === ownerPubky || order.sellerPubky === ownerPubky),
    );

    // Derived now, while the keyring is known live; a revoked keyring stops here.
    let entryUrls: Map<string, string>;
    try {
      entryUrls = new Map(
        eligible.map((order) => [
          order.receiptId as string,
          privEntryUrl(keyring, 'order_receipt', order.receiptId as string),
        ]),
      );
    } catch (error) {
      if (isPrivKeyringRevoked(error)) return 'unavailable';
      throw error;
    }

    for (const order of eligible) {
      const receiptId = order.receiptId as string;
      const url = entryUrls.get(receiptId) as string;
      if (this.publishedReceiptUrls.has(url)) continue;
      try {
        let sealed: unknown;
        try {
          sealed = await CommercePrivStoreService.read(keyring, 'order_receipt', receiptId);
        } catch (error) {
          if (this.isPrivateAccessDenied(error)) return 'needs_reauth';
          throw error;
        }
        if (sealed !== null) {
          if (this.verifiedSealedReceipt(sealed, ownerPubky, receiptId) !== null) {
            this.publishedReceiptUrls.add(url);
          } else {
            Logger.warn('A sealed order receipt opens but does not verify; it is kept and not overwritten');
          }
          continue;
        }

        const attestation = await MarketplaceGatewayService.getReceiptAttestation(ownerPubky, receiptId);
        if (attestation === null) return 'unavailable';

        // Drop orders additionally carry a `pubky-drop-edition+v1` proof
        // ("edition N of M") in the same portable document (ADR 0026). Its
        // absence for a non-drop order is honest, not a failure.
        const editionAttestation =
          typeof order.dropAggregateId === 'string'
            ? await MarketplaceGatewayService.getEditionAttestation(ownerPubky, receiptId)
            : null;

        const { claims } = attestation;
        const wireBody = {
          schemaVersion: 1,
          recordType: 'order_receipt',
          ownerPubky,
          revision: 1,
          createdAt: claims.paidAt,
          updatedAt: claims.paidAt,
          role: claims.buyer === ownerPubky ? 'buyer' : 'seller',
          receiptId: claims.receipt,
          orderId: claims.order,
          buyerPubky: claims.buyer,
          sellerPubky: claims.seller,
          total:
            claims.v === 2
              ? {
                  amountMinor: claims.merchandiseTotal.amountMinor,
                  currency: claims.merchandiseTotal.currency,
                  exponent: claims.merchandiseTotal.exponent,
                }
              : { amountMinor: claims.totalMinor, currency: claims.currency, exponent: claims.exponent },
          ...(claims.v === 2 ? { settlementTotal: claims.settlementTotal } : {}),
          paidAt: claims.paidAt,
          receiptAttestation: attestation.jws,
          ...(editionAttestation !== null
            ? {
                editionAttestation: editionAttestation.jws,
                drop: {
                  dropId: editionAttestation.claims.drop,
                  edition: editionAttestation.claims.edition,
                  of: editionAttestation.claims.of,
                },
              }
            : {}),
        };
        const { PubkySpecsBuilder } = await import('pubky-app-specs');
        const provisional = new PubkySpecsBuilder(ownerPubky).createMarketplaceOrderReceipt(wireBody);
        const provisionalRecord = CommerceRecordNormalizer.orderReceiptRecord(provisional.order_receipt.toJson());
        const verifiedClaims = verifyOrderReceiptClaims({ ...provisionalRecord });
        if (
          verifiedClaims === null ||
          verifiedClaims.v !== claims.v ||
          (claims.v === 2 &&
            (verifiedClaims.v !== 2 ||
              JSON.stringify(verifiedClaims.merchandiseTotal) !== JSON.stringify(claims.merchandiseTotal) ||
              JSON.stringify(verifiedClaims.settlementTotal) !== JSON.stringify(claims.settlementTotal)))
        ) {
          throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'Receipt attestation claims are not verified.', {
            service: ErrorService.Marketplace,
            operation: 'publishOrderReceipts',
          });
        }
        const verifiedBody = {
          schemaVersion: 1,
          recordType: 'order_receipt',
          ownerPubky,
          revision: 1,
          createdAt: verifiedClaims.paidAt,
          updatedAt: verifiedClaims.paidAt,
          role: verifiedClaims.buyer === ownerPubky ? 'buyer' : 'seller',
          receiptId: verifiedClaims.receipt,
          orderId: verifiedClaims.order,
          buyerPubky: verifiedClaims.buyer,
          sellerPubky: verifiedClaims.seller,
          total:
            verifiedClaims.v === 2
              ? verifiedClaims.merchandiseTotal
              : {
                  amountMinor: verifiedClaims.totalMinor,
                  currency: verifiedClaims.currency,
                  exponent: verifiedClaims.exponent,
                },
          ...(verifiedClaims.v === 2 ? { settlementTotal: verifiedClaims.settlementTotal } : {}),
          paidAt: verifiedClaims.paidAt,
          receiptAttestation: attestation.jws,
          ...(editionAttestation !== null
            ? {
                editionAttestation: editionAttestation.jws,
                drop: {
                  dropId: editionAttestation.claims.drop,
                  edition: editionAttestation.claims.edition,
                  of: editionAttestation.claims.of,
                },
              }
            : {}),
        };
        const built = new PubkySpecsBuilder(ownerPubky).createMarketplaceOrderReceipt(verifiedBody);
        const record = CommerceRecordNormalizer.orderReceiptRecord(built.order_receipt.toJson());
        if (verifiedClaims.v === 2) record.settlementTotal = verifiedClaims.settlementTotal;
        if (verifyOwnOrderReceipt({ ...record }) === null) {
          Logger.warn('Refusing to publish an order receipt whose attestation does not verify');
          continue;
        }
        if (record.editionAttestation !== undefined && verifyOwnDropEdition({ ...record }) === null) {
          Logger.warn('Refusing to publish an order receipt whose edition attestation does not verify');
          continue;
        }
        try {
          await CommercePrivStoreService.write(keyring, 'order_receipt', receiptId, { ...record });
        } catch (error) {
          if (this.isPrivateAccessDenied(error)) return 'needs_reauth';
          throw error;
        }
        this.publishedReceiptUrls.add(url);
      } catch (error) {
        if (isPrivKeyringRevoked(error)) return 'unavailable';
        Logger.warn('Order receipt publication failed; it will retry on the next orders load', privErrorSummary(error));
      }
    }

    // A receipt that failed mid-flight (logged above), or a plaintext receipt
    // still waiting to move, retries on the next orders-surface load; report
    // that honestly instead of claiming done.
    const hasUnpublished = [...entryUrls.values()].some((url) => !this.publishedReceiptUrls.has(url));
    return hasUnpublished || migration === 'incomplete' ? 'unavailable' : 'published';
  }

  static async getWatchAlerts(ownerPubky: string): Promise<CommerceWatchAlertModelSchema[]> {
    return await LocalCommerceService.getWatchAlerts(ownerPubky);
  }

  static async getWatchSnapshots(ownerPubky: string): Promise<CommerceWatchSnapshotModelSchema[]> {
    return await LocalCommerceService.getWatchSnapshots(ownerPubky);
  }

  static async markWatchAlertsSeen(ownerPubky: string): Promise<void> {
    await LocalCommerceService.markWatchAlertsSeen(ownerPubky, Date.now());
  }

  static async getActivityReadCheckpoint(ownerPubky: string): Promise<number> {
    return await LocalCommerceService.getActivityReadCheckpoint(ownerPubky);
  }

  static async markActivityRead(ownerPubky: string): Promise<void> {
    await CommerceAttentionSeenApplication.markSeen(ownerPubky, 'activity');
  }

  static async markOrdersAttentionSeen(ownerPubky: string): Promise<void> {
    await CommerceAttentionSeenApplication.markSeen(ownerPubky, 'orders');
  }

  static async syncAttentionSeen(ownerPubky: string): Promise<void> {
    await CommerceAttentionSeenApplication.pull(ownerPubky);
  }

  /**
   * One bounded watchlist detection pass: re-observes the most recently
   * watched items and derives alerts from what actually changed against the
   * persisted per-item baselines (see `detectWatchAlerts` for the honesty
   * rules).
   *
   * Observation sources, per item:
   *
   * - Index: a per-listing Nexus read (`v0/listing/{seller}/{listing}`) —
   *   revision, price, state, auction deadline. Sandbox mode reads the
   *   locally seeded catalog instead (the sandbox never queries Nexus).
   *   Fresh Nexus rows are folded into the catalog cache, so the watchlist
   *   page renders the same freshness the detection observed.
   * - Projection: the transaction service's public listing projection —
   *   current bid, bid count, leader, sale state. Transactional modes only;
   *   a missing session or unreachable service yields no observation, never
   *   a fabricated one.
   *
   * An item where both reads failed is skipped entirely: no observation, no
   * claim, and the baseline stays where it was. The whole pass is bounded to
   * {@link COMMERCE_WATCH_CHECK_MAX_ITEMS} items and the caller enforces
   * spacing between passes — there is no background daemon.
   */
  static async runWatchlistDetection(ownerPubky: string): Promise<{ alertCount: number }> {
    const adapterMode = getCommerceAdapterMode();
    const favorites = await LocalCommerceService.getFavorites(ownerPubky);
    const watched = favorites.slice(-COMMERCE_WATCH_CHECK_MAX_ITEMS).reverse();
    if (watched.length === 0) return { alertCount: 0 };

    const baselines = new Map(
      (await LocalCommerceService.getWatchSnapshots(ownerPubky)).map((snapshot) => [snapshot.listing_id, snapshot]),
    );
    const now = Date.now();
    const freshEntries: CommerceCatalogEntryModelSchema[] = [];

    const observations = await Promise.all(
      watched.map(async (favorite): Promise<WatchObservation> => {
        const listingId = favorite.listing_id;
        const separator = listingId.indexOf(':');
        const sellerId = listingId.slice(0, separator);
        const id = listingId.slice(separator + 1);

        const [index, projection] = await Promise.all([
          this.observeWatchIndex(adapterMode, sellerId, id, listingId, freshEntries),
          this.observeWatchProjection(adapterMode, ownerPubky, sellerId, id),
        ]);
        return { ownerId: ownerPubky, listingId, sellerId, observedAt: now, index, projection };
      }),
    );

    const snapshots: CommerceWatchSnapshotModelSchema[] = [];
    const alerts: CommerceWatchAlertModelSchema[] = [];
    for (const observation of observations) {
      if (!observation.index && !observation.projection) continue;
      const result = detectWatchAlerts(baselines.get(observation.listingId) ?? null, observation, {
        endingSoonThresholdMs: COMMERCE_WATCH_ENDING_SOON_THRESHOLD_MS,
      });
      snapshots.push(result.snapshot);
      alerts.push(...result.alerts);
    }

    if (freshEntries.length > 0) {
      await LocalCommerceService.bulkUpsertCatalogEntries(freshEntries);
    }
    await LocalCommerceService.saveWatchDetection(ownerPubky, snapshots, alerts);
    return { alertCount: alerts.length };
  }

  private static async observeWatchIndex(
    adapterMode: ReturnType<typeof getCommerceAdapterMode>,
    sellerId: string,
    id: string,
    listingId: string,
    freshEntries: CommerceCatalogEntryModelSchema[],
  ): Promise<WatchIndexObservation | null> {
    if (adapterMode === 'sandbox') {
      // The sandbox catalog is seeded locally and never queries Nexus; its
      // local rows are the only index-shaped source that exists in this mode.
      const entry = await LocalCommerceService.getCatalogEntry(listingId);
      if (entry) {
        return {
          revision: entry.revision,
          state: entry.state,
          priceMinor: entry.price.amountMinor,
          currency: entry.price.currency,
          exponent: entry.price.exponent,
          auctionEndsAt: entry.auction?.endsAt ?? null,
          title: entry.title,
        };
      }
      const listing = await LocalCommerceService.getListing(listingId);
      if (!listing) return null;
      const record = listing.record;
      const price = record.sale.format === 'fixed_price' ? record.sale.unitPrice : record.sale.startingPrice;
      return {
        revision: listing.revision,
        state: listing.state,
        priceMinor: price.amountMinor,
        currency: price.currency,
        exponent: price.exponent,
        auctionEndsAt: record.sale.format === 'auction' ? record.sale.endsAt : null,
        title: record.title,
      };
    }

    try {
      const entry = CommerceRecordNormalizer.nexusListingDetails(
        await NexusMarketplaceService.fetchListingDetails({ seller_id: sellerId, listing_id: id }),
      );
      freshEntries.push(entry);
      return {
        revision: entry.revision,
        state: entry.state,
        priceMinor: entry.price.amountMinor,
        currency: entry.price.currency,
        exponent: entry.price.exponent,
        auctionEndsAt: entry.auction?.endsAt ?? null,
        title: entry.title,
      };
    } catch (error) {
      if (!(isAppError(error) && isNotFound(error))) {
        Logger.warn('Failed to observe a watched listing on the Nexus index', { listing: listingId, error });
      }
      // 404 (never/no-longer indexed) and transport failures alike: nothing
      // was observed, so nothing may be claimed.
      return null;
    }
  }

  private static async observeWatchProjection(
    adapterMode: ReturnType<typeof getCommerceAdapterMode>,
    ownerPubky: string,
    sellerId: string,
    id: string,
  ): Promise<WatchProjectionObservation | null> {
    if (!isTransactionalCommerceMode(adapterMode)) return null;
    try {
      const projection = await MarketplaceGatewayService.getListing(
        ownerPubky,
        buildMarketplaceListingAggregateId(sellerId, id),
      );
      if (!projection) return null;
      return {
        serverRevision: projection.serverRevision,
        state: projection.state,
        auction: projection.auction
          ? {
              endsAt: projection.auction.endsAt,
              currentPriceMinor: projection.auction.currentPrice.amountMinor,
              currency: projection.auction.currentPrice.currency,
              exponent: projection.auction.currentPrice.exponent,
              bidCount: projection.auction.bidCount,
              leaderPubky: projection.auction.leaderPubky,
            }
          : null,
      };
    } catch {
      // No session yet, service unreachable, or listing unregistered — not an
      // error at watch level, and never a fabricated observation.
      return null;
    }
  }

  static async getSavedSearches(ownerPubky: string): Promise<CommerceSavedSearchModelSchema[]> {
    return await LocalCommerceService.getSavedSearches(ownerPubky);
  }

  /**
   * Saves the current catalog filter/search combination. The initial
   * watermark must be the newest `updated_at` among the search's CURRENT
   * matches (the caller just rendered them), so nothing that already existed
   * at save time can ever be counted as NEW.
   */
  static async commitCreateSavedSearch(
    ownerPubky: string,
    name: string,
    params: CommerceSavedSearchParams,
    initialWatermarkUpdatedAt: number,
  ): Promise<void> {
    const existing = await LocalCommerceService.getSavedSearches(ownerPubky);
    if (existing.length >= COMMERCE_SAVED_SEARCH_MAX_PER_OWNER) {
      throw Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        `You can keep up to ${COMMERCE_SAVED_SEARCH_MAX_PER_OWNER} saved searches.`,
        {
          service: ErrorService.Local,
          operation: 'commitCreateSavedSearch',
        },
      );
    }
    const now = Date.now();
    await LocalCommerceService.createSavedSearch({
      id: crypto.randomUUID(),
      owner_id: ownerPubky,
      name,
      params,
      watermark_updated_at: initialWatermarkUpdatedAt,
      latest_match_updated_at: initialWatermarkUpdatedAt,
      new_count: 0,
      last_checked_at: now,
      created_at: now,
    });
  }

  static async commitDeleteSavedSearch(ownerPubky: string, id: string): Promise<void> {
    await this.assertSavedSearchOwner(ownerPubky, id);
    await LocalCommerceService.deleteSavedSearch(id);
  }

  static async recordSavedSearchCheck(
    ownerPubky: string,
    id: string,
    result: { newCount: number; latestMatchUpdatedAt: number; checkedAt: number },
  ): Promise<void> {
    await this.assertSavedSearchOwner(ownerPubky, id);
    await LocalCommerceService.recordSavedSearchCheck(id, result);
  }

  static async acknowledgeSavedSearch(ownerPubky: string, id: string): Promise<void> {
    await this.assertSavedSearchOwner(ownerPubky, id);
    await LocalCommerceService.acknowledgeSavedSearch(id);
  }

  private static async assertSavedSearchOwner(ownerPubky: string, id: string): Promise<void> {
    const searches = await LocalCommerceService.getSavedSearches(ownerPubky);
    if (!searches.some((search) => search.id === id)) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'Saved search does not belong to this account.', {
        service: ErrorService.Local,
        operation: 'assertSavedSearchOwner',
      });
    }
  }

  static async isShopFollowed(ownerPubky: string, sellerPubky: string): Promise<boolean> {
    return await LocalCommerceService.isShopFollowed(ownerPubky, sellerPubky);
  }

  static async getShopFollows(ownerPubky: string) {
    return await LocalCommerceService.getShopFollows(ownerPubky);
  }

  static async commitCreateShopFollow(ownerPubky: string, sellerPubky: string): Promise<void> {
    await LocalCommerceService.createShopFollow(ownerPubky, sellerPubky, Date.now());
  }

  static async commitDeleteShopFollow(ownerPubky: string, sellerPubky: string): Promise<void> {
    await LocalCommerceService.deleteShopFollow(ownerPubky, sellerPubky);
  }

  static async getAllCatalogEntries() {
    return await LocalCommerceService.getAllCatalogEntries();
  }

  static async getCatalogEntriesBySeller(sellerPubky: string) {
    return await LocalCommerceService.getCatalogEntriesBySeller(sellerPubky);
  }

  /**
   * Populates the local catalog cache from the Nexus marketplace index.
   *
   * The index now carries everything a catalog card renders (including
   * auction terms), so discovery validates the stream and stores the
   * normalized entries directly — one request, no per-listing homeserver
   * hydration. The canonical owner-signed record is fetched lazily, when a
   * listing is actually opened (`getOrFetchListing`), keeping the homeserver
   * canonical per ADR-0020. Shop profiles are the one card field the index
   * cannot supply, so sellers without a locally cached shop record are still
   * hydrated here (deduplicated, cache-first).
   *
   * Sandbox catalogs are seeded locally and stay self-contained: querying the
   * index there would blend real network listings into a demo catalog of
   * fictional sellers, so sandbox mode never reads from Nexus.
   *
   * Per-shop hydration failures are logged and skipped so one unreachable
   * seller cannot block the rest of the catalog (cards fall back to the
   * seller's pubky until the shop record is reachable).
   */
  static async fetchCatalogListings(filters: CommerceCatalogStreamFilters = {}): Promise<void> {
    if (getCommerceAdapterMode() === 'sandbox') return;

    const payload = await NexusMarketplaceService.fetchListingStream({
      state: 'active',
      limit: NEXUS_LISTINGS_PER_PAGE,
      ...(filters.saleFormat ? { sale_format: filters.saleFormat } : {}),
      ...(filters.condition ? { condition: filters.condition } : {}),
      ...(filters.endingSoonest ? { sorting: 'ends_at' as const, order: 'ascending' as const } : {}),
      ...(filters.country ? { country: filters.country } : {}),
      ...(filters.sellerId ? { seller_id: filters.sellerId } : {}),
    });
    const entries = CommerceRecordNormalizer.nexusListingStream(payload);
    await LocalCommerceService.bulkUpsertCatalogEntries(entries);
    await this.hydrateDiscoveredShops([...new Set(entries.map(({ seller_id }) => seller_id))]);
  }

  /**
   * Every seller whose stored configuration has `method` enabled, read page
   * by page from the service up to {@link PAYMENT_METHOD_SELLERS_MAX_PAGES}.
   * Stored config, never Paykit health: a degraded Paykit drops nobody.
   */
  static async fetchPaymentMethodSellers(method: PaymentMethodFilter): Promise<string[]> {
    const sellers: string[] = [];
    let after: string | null = null;
    for (let page = 0; page < PAYMENT_METHOD_SELLERS_MAX_PAGES; page++) {
      const result: PaymentMethodSellersPage = await MarketplaceGatewayService.getPaymentMethodSellers(method, after);
      sellers.push(...result.sellers);
      if (!result.nextAfter) break;
      after = result.nextAfter;
    }
    return sellers;
  }

  /**
   * Widens discovery to the listings of these sellers: one Nexus
   * `seller_id` stream page each, carrying the catalog's server-side
   * filters, {@link PAYMENT_METHOD_DISCOVERY_CONCURRENCY} at a time. One
   * unreachable seller does not stop the rest; the grid keeps rendering
   * whatever is cached for them.
   */
  static async fetchSellerSetCatalogListings(
    sellers: readonly string[],
    filters: Omit<CommerceCatalogStreamFilters, 'sellerId'> = {},
  ): Promise<void> {
    for (let start = 0; start < sellers.length; start += PAYMENT_METHOD_DISCOVERY_CONCURRENCY) {
      const batch = sellers.slice(start, start + PAYMENT_METHOD_DISCOVERY_CONCURRENCY);
      await Promise.allSettled(batch.map((sellerId) => this.fetchCatalogListings({ ...filters, sellerId })));
    }
  }

  /**
   * Populates the local catalog cache with one seller's active listings from
   * the Nexus index — what a direct visit to a shop page needs when the
   * visitor never browsed the main catalog. Sandbox catalogs are seeded
   * locally, so (as with {@link fetchCatalogListings}) sandbox mode never
   * reads from Nexus.
   */
  static async fetchSellerCatalogListings(
    sellerPubky: string,
    options: { strictIdentity?: boolean; paginate?: boolean } = {},
  ): Promise<void> {
    if (getCommerceAdapterMode() === 'sandbox') return;

    const entries = await this.collectSellerCatalogEntries(sellerPubky, options);
    await LocalCommerceService.bulkUpsertCatalogEntries(entries);
  }

  private static async collectSellerCatalogEntries(
    sellerPubky: string,
    options: { strictIdentity?: boolean; paginate?: boolean; states?: readonly NexusListingState[] } = {},
  ): Promise<ReturnType<typeof CommerceRecordNormalizer.nexusListingStream>[number][]> {
    const pages: NexusListingDetails[][] = [];
    const maxPages = options.paginate ? SELLER_REFRESH_MAX_PAGES : 1;
    for (const state of options.states ?? (['active'] as const)) {
      for (let page = 0; page < maxPages; page += 1) {
        const payload = await NexusMarketplaceService.fetchListingStream({
          seller_id: sellerPubky,
          state,
          limit: NEXUS_LISTINGS_PER_PAGE,
          ...(options.paginate && page > 0 ? { skip: page * NEXUS_LISTINGS_PER_PAGE } : {}),
        });
        if (!Array.isArray(payload)) {
          if (options.strictIdentity) throw this.invalidSellerCatalogIdentity();
          break;
        }
        this.validateSellerCatalogPage(payload, sellerPubky, options.strictIdentity);
        pages.push(payload);
        if (!options.paginate || payload.length < NEXUS_LISTINGS_PER_PAGE) break;
        if (page === maxPages - 1) {
          throw Err.validation(
            ValidationErrorCode.INVALID_INPUT,
            'Seller catalog refresh exceeded its bounded page limit.',
            {
              service: ErrorService.Nexus,
              operation: 'fetchSellerCatalogListings',
              context: { maxPages, state },
            },
          );
        }
      }
    }

    const entriesById = new Map<string, ReturnType<typeof CommerceRecordNormalizer.nexusListingStream>[number]>();
    for (const entry of CommerceRecordNormalizer.nexusListingStream(pages.flat())) {
      const prior = entriesById.get(entry.id);
      if (!prior || entry.revision > prior.revision) entriesById.set(entry.id, entry);
    }
    return [...entriesById.values()];
  }

  private static validateSellerCatalogPage(
    payload: NexusListingDetails[],
    sellerPubky: string,
    strictIdentity = false,
  ): void {
    if (
      strictIdentity &&
      payload.some(
        (entry) =>
          !entry ||
          typeof entry !== 'object' ||
          entry.owner_id !== sellerPubky ||
          entry.uri !== `pubky://${sellerPubky}/pub/pubky.app/marketplace/v1/listings/${entry.id}`,
      )
    ) {
      throw this.invalidSellerCatalogIdentity();
    }
  }

  private static invalidSellerCatalogIdentity() {
    return Err.validation(ValidationErrorCode.INVALID_INPUT, 'Seller catalog contains an invalid listing identity.', {
      service: ErrorService.Nexus,
      operation: 'fetchSellerCatalogListings',
      context: { ownerMatches: false },
    });
  }

  /**
   * Refreshes the catalog cache with recent active listings from the sellers
   * a viewer follows, for the home-feed "From sellers you follow" shelf.
   *
   * Cost model — the Nexus listing stream accepts one `seller_id` per
   * request, so intersecting a follow graph with the index can never be one
   * query. This method bounds the cost instead of hiding it:
   *
   * 1. ONE shared global page of the newest active listings (the same read
   *    the catalog grid does) — it both refreshes the cache and cheaply
   *    discovers followed accounts that recently listed something.
   * 2. Per-seller refreshes ONLY for follows already known to sell (cached
   *    shop record or cached index entry), capped at
   *    {@link MARKETPLACE_FOLLOWED_SHELF_MAX_SELLER_FETCHES} — never a
   *    request per follow (see {@link selectFollowedSellersToRefresh}).
   *
   * Degradation: a failed global page falls back to refreshing cache-known
   * sellers; failed per-seller refreshes are logged and skipped
   * (`allSettled`) so one unreachable seller cannot empty the shelf; when
   * everything fails the shelf renders whatever the cache honestly holds.
   * Sandbox catalogs are seeded locally and never read from Nexus.
   */
  static async fetchFollowedSellerCatalogListings(followedPubkys: string[]): Promise<void> {
    if (getCommerceAdapterMode() === 'sandbox') return;
    if (followedPubkys.length === 0) return;

    try {
      const payload = await NexusMarketplaceService.fetchListingStream({
        state: 'active',
        limit: NEXUS_LISTINGS_PER_PAGE,
      });
      await LocalCommerceService.bulkUpsertCatalogEntries(CommerceRecordNormalizer.nexusListingStream(payload));
    } catch (error) {
      Logger.warn('Failed to refresh the global listing page for the followed-sellers shelf; using cache only', {
        error,
      });
    }

    const [entries, shops] = await Promise.all([
      LocalCommerceService.getAllCatalogEntries(),
      LocalCommerceService.getAllShops(),
    ]);
    const knownSellerIds = new Set([
      ...entries.map(({ seller_id }) => seller_id),
      ...shops.map(({ owner_id }) => owner_id),
    ]);
    const sellersToRefresh = selectFollowedSellersToRefresh(
      followedPubkys,
      knownSellerIds,
      MARKETPLACE_FOLLOWED_SHELF_MAX_SELLER_FETCHES,
    );
    if (sellersToRefresh.length === 0) return;

    const results = await Promise.allSettled(
      sellersToRefresh.map((sellerId) => this.fetchSellerCatalogListings(sellerId)),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        Logger.warn('Failed to refresh a followed seller for the shelf; keeping their cached listings', {
          sellerId: sellersToRefresh[index],
          error: result.reason,
        });
      }
    });

    await this.hydrateDiscoveredShops(sellersToRefresh);
  }

  private static async hydrateDiscoveredShops(sellerIds: string[]): Promise<void> {
    const shopResults = await Promise.allSettled(sellerIds.map((sellerId) => this.getOrFetchShop(sellerId)));
    shopResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        Logger.warn('Failed to hydrate a discovered marketplace shop', {
          sellerId: sellerIds[index],
          error: result.reason,
        });
      }
    });
  }

  static async fetchListing(ownerPubky: string, listingId: string): Promise<CommerceListingRecord> {
    const url = CommerceRecordNormalizer.listingUri(ownerPubky, listingId);
    return this.canonicalListing(await CommerceHomeserverService.fetchJson(url), ownerPubky, listingId);
  }

  /** {@link fetchListing}, with a missing record answered as `null` instead of a reported 404. */
  private static async fetchListingIfFound(
    ownerPubky: string,
    listingId: string,
  ): Promise<CommerceListingRecord | null> {
    const stored = await CommerceHomeserverService.fetchJsonIfFound(
      CommerceRecordNormalizer.listingUri(ownerPubky, listingId),
    );
    return stored.found ? this.canonicalListing(stored.json, ownerPubky, listingId) : null;
  }

  private static canonicalListing(raw: unknown, ownerPubky: string, listingId: string): CommerceListingRecord {
    const record = CommerceRecordNormalizer.listing(raw);
    if (record.ownerPubky !== ownerPubky || record.listingId !== listingId) {
      throw Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        'Canonical listing identity does not match the requested seller and listing.',
        {
          service: ErrorService.Marketplace,
          operation: 'fetchListing',
          context: {
            ownerMatches: record.ownerPubky === ownerPubky,
            listingMatches: record.listingId === listingId,
          },
        },
      );
    }
    return record;
  }

  /**
   * Re-reads the canonical record from the owner's homeserver and replaces the
   * cached row with it, so the Shop shows what is published rather than a
   * revision a failed publish staged locally. Network first, then local:
   * `getOrFetchListing` would serve the staged row back.
   */
  static async refreshListing(ownerPubky: string, listingId: string): Promise<CommerceListingRecord> {
    const record = await this.fetchListing(ownerPubky, listingId);
    await LocalCommerceService.upsertListing(record, 'synced');
    return record;
  }

  /**
   * Returns the canonical listing record, fetching it from the owner
   * homeserver when it is not cached — or when the Nexus index has seen a
   * newer revision than the cache holds, so opening a listing always shows
   * the freshest record the network can supply. When a refresh fails but a
   * cached record exists, the cached record is returned (local-first
   * degradation, mirroring the catalog's behavior when Nexus is down).
   */
  static async getOrFetchListing(ownerPubky: string, listingId: string): Promise<CommerceListingRecord> {
    return this.readCachedListing(ownerPubky, listingId, () => this.fetchListing(ownerPubky, listingId));
  }

  /**
   * Optional metadata for an existing order: a missing canonical record is not
   * proof of deletion and is not reported as an error. Do not cache absence,
   * so later order polls can recover the listing and its digital lock.
   */
  static async getOrFetchListingIfFound(ownerPubky: string, listingId: string): Promise<CommerceListingRecord | null> {
    return this.readCachedListing(ownerPubky, listingId, () => this.fetchListingIfFound(ownerPubky, listingId));
  }

  private static async readCachedListing<T extends CommerceListingRecord | null>(
    ownerPubky: string,
    listingId: string,
    fetchCanonical: () => Promise<T>,
  ): Promise<CommerceListingRecord | T> {
    const compositeListingId = `${ownerPubky}:${listingId}`;
    const [local, indexed] = await Promise.all([
      LocalCommerceService.getListing(compositeListingId),
      LocalCommerceService.getCatalogEntry(compositeListingId),
    ]);
    if (local && (!indexed || local.revision >= indexed.revision)) return local.record;

    try {
      const record = await fetchCanonical();
      if (record === null) return local?.record ?? record;
      if (indexed && record.revision < indexed.revision) {
        throw Err.validation(
          ValidationErrorCode.INVALID_INPUT,
          'Canonical listing revision is older than the Nexus discovery revision.',
          {
            service: ErrorService.Marketplace,
            operation: 'getOrFetchListing',
            context: { canonicalRevision: record.revision, indexedRevision: indexed.revision },
          },
        );
      }
      await LocalCommerceService.upsertListing(record, 'synced');
      return record;
    } catch (error) {
      if (isAppError(error) && error.code === ValidationErrorCode.INVALID_INPUT) throw error;
      if (!local) throw error;
      Logger.warn('Failed to refresh a stale marketplace listing; serving the cached record', {
        listing: compositeListingId,
        error,
      });
      return local.record;
    }
  }

  /**
   * Whether a failed {@link getOrFetchListing} proves the seller deleted the
   * listing. Deletion is confirmed only when the owner homeserver answered
   * 404 for the canonical record AND the Nexus index, asked once without
   * retry, also answers 404. Every other outcome (transport failure, 5xx,
   * a homeserver 404 while Nexus still lists the record, a Nexus failure)
   * is unknown and returns `false`, so callers keep their generic
   * "could not be loaded" copy. Never throws.
   */
  static async isListingConfirmedRemoved(ownerPubky: string, listingId: string, fetchError: unknown): Promise<boolean> {
    if (!isAppError(fetchError) || fetchError.service !== ErrorService.Homeserver || !isNotFound(fetchError)) {
      return false;
    }
    try {
      await NexusMarketplaceService.fetchListingDetailsOnce({ seller_id: ownerPubky, listing_id: listingId });
      return false;
    } catch (nexusError) {
      return isAppError(nexusError) && nexusError.service === ErrorService.Nexus && isNotFound(nexusError);
    }
  }

  /**
   * The seller's standing amount-band consent (ratified D2, ADR 0024).
   * `null` means the running backend has no attestation support at all
   * (sandbox) — callers render absence, never a fake false.
   */
  static async getSellerAnnualLimit(actorPubky: string, sellerPubky: string) {
    return await MarketplaceGatewayService.getSellerAnnualLimit(actorPubky, sellerPubky);
  }

  static async getMarketplaceBandConsent(actorPubky: string, sellerPubky: string): Promise<boolean | null> {
    return await MarketplaceGatewayService.getBandConsent(actorPubky, sellerPubky);
  }

  /**
   * Session-scoped 404 memo so a remount of the same order card does not
   * re-GET a homeserver miss. Keyed by actor + order. Cleared with the
   * marketplace session so a later sign-in can hydrate a record published
   * after this session's miss.
   */
  private static ownReviewHomeserverMisses = new Set<string>();

  /**
   * Reviews this session deleted (composite IDs). A homeserver that still
   * serves a record just after its DEL must not write it back through a
   * refresh; a new publication of the review lifts the entry.
   */
  private static deletedOwnReviews = new Set<string>();

  /** Test support: clears the session-scoped own-review 404 memo and deleted set. */
  static resetOwnReviewHydrateMemo(): void {
    this.ownReviewHomeserverMisses.clear();
    this.deletedOwnReviews.clear();
  }

  private static ownReviewMissKey(actorPubky: string, orderId: string): string {
    return `${actorPubky}:${orderId}`;
  }

  /**
   * Live session pubky vs the identity captured when hydrate started.
   * Null (signed out) or a different account must not write `commerce_reviews`.
   */
  private static liveIdentityMatches(hydrateIdentity: string): boolean {
    return useAuthStore.getState().currentUserPubky === hydrateIdentity;
  }

  /**
   * The current user's own published review row for one order.
   * Local-first: a Dexie hit returns immediately. After a fresh sign-in the
   * local row is gone (wiped with identity) even when the homeserver record
   * is live — hydrate from the deterministic review URI (listing + subject
   * + role + the order's attested `order_ref`), and republish a review a
   * later order overwrote before per-order IDs, so the order card can resolve publication/attestation state
   * instead of waiting forever.
   */
  static async getOwnMarketplaceReview(
    actorPubky: string,
    order: MarketplaceOrder,
  ): Promise<CommerceReviewModelSchema | null> {
    const local = (await LocalCommerceService.getOwnReviewByOrder(actorPubky, order.id)) ?? null;
    if (local !== null) return local;
    if (this.ownReviewHomeserverMisses.has(this.ownReviewMissKey(actorPubky, order.id))) return null;
    return await this.hydrateOwnReviewFromHomeserver(actorPubky, order);
  }

  /** `listing:<sellerPubky>_<listingId>` on the first order line, or null. */
  private static listingIdFromOrder(order: MarketplaceOrder): string | null {
    const listingPrefix = `listing:${order.sellerPubky}_`;
    const listingAggregateId = order.lines[0]?.listingAggregateId ?? '';
    if (!listingAggregateId.startsWith(listingPrefix)) return null;
    const listingId = listingAggregateId.slice(listingPrefix.length);
    return listingId.length > 0 ? listingId : null;
  }

  /**
   * Specs hash ID for the review of this (listing, subject, role, order).
   * Dummy text/attestation are ignored by the hash — only listing URI,
   * subject, role and `orderRef` feed the id. Without `orderRef` it is the
   * legacy per-listing id that reviews published before per-order reviews
   * live at.
   */
  private static async ownReviewPathId(input: {
    actorPubky: string;
    listingOwnerPubky: string;
    listingId: string;
    subjectPubky: string;
    role: 'buyer_reviewing_seller' | 'seller_reviewing_buyer';
    orderRef?: string;
  }): Promise<string> {
    const { PubkySpecsBuilder } = await import('pubky-app-specs');
    const built = new PubkySpecsBuilder(input.actorPubky).createMarketplaceReview({
      schemaVersion: 1,
      recordType: 'review',
      ownerPubky: input.actorPubky,
      revision: 1,
      createdAt: '1970-01-01T00:00:00.000Z',
      updatedAt: '1970-01-01T00:00:00.000Z',
      reviewId: '',
      subjectPubky: input.subjectPubky,
      listingOwnerPubky: input.listingOwnerPubky,
      listingId: input.listingId,
      role: input.role,
      ratings: { overall: 1 },
      text: 'path-id-probe',
      eligibilityAttestation: 'A'.repeat(32),
      ...(input.orderRef === undefined ? {} : { orderRef: input.orderRef }),
    });
    return built.meta.id;
  }

  /**
   * Rebuilds the local own-review row from the reviewer's homeserver after
   * a cache miss. The only write to the homeserver is the one-time republish
   * of a review no record carries
   * ({@link republishOverwrittenOwnReview}). A 404 or identity mismatch stays
   * unresolved (the order card's waiting copy), never a false published
   * or unpublished claim.
   */
  private static async hydrateOwnReviewFromHomeserver(
    actorPubky: string,
    order: MarketplaceOrder,
  ): Promise<CommerceReviewModelSchema | null> {
    const hydrateIdentity = actorPubky;
    if (!this.liveIdentityMatches(hydrateIdentity)) return null;
    const read = await this.readOwnReviewFromHomeserver(actorPubky, order);
    if (read.kind === 'missing') {
      this.ownReviewHomeserverMisses.add(this.ownReviewMissKey(actorPubky, order.id));
      return null;
    }
    if (read.kind === 'overwritten') {
      return await this.republishOverwrittenOwnReview(actorPubky, order, read.attestation, hydrateIdentity);
    }
    if (read.kind !== 'found') return null;
    // Auth-cleanup may wipe `commerce_reviews` while this GET is in flight.
    // Do not re-seed another identity's private table; skip if the live
    // session pubky is no longer the one captured at hydrate start.
    if (!this.liveIdentityMatches(hydrateIdentity)) return null;
    try {
      // The user removed this review: a record still served (a DEL owed, or
      // not yet visible) must not be shown again.
      if (await this.ownReviewWithdrawn(actorPubky, order, read.model.record.listingId)) {
        this.ownReviewHomeserverMisses.add(this.ownReviewMissKey(actorPubky, order.id));
        return null;
      }
      await LocalCommerceService.upsertOwnReview(read.model);
    } catch (error) {
      Logger.warn('Own review homeserver hydrate failed; leaving publication status unresolved', {
        orderId: order.id,
        reviewId: read.model.review_id,
        error,
      });
      return null;
    }
    return read.model;
  }

  /**
   * A review a later order overwrote at the shared per-listing path before
   * per-order IDs: no homeserver record carries this order's attestation,
   * but the service still holds the review, so it is republished once at
   * this order's own path. Runs outside the order lock (the publish takes
   * it). A review the user removed is never republished: the service records
   * the withdrawal, so this holds on every device, not only the one that
   * removed it (see {@link commitPublishOwnReview}'s `repair`).
   */
  private static async republishOverwrittenOwnReview(
    actorPubky: string,
    order: MarketplaceOrder,
    attestation: z.infer<typeof marketplaceAttestationSchema>,
    hydrateIdentity: string,
  ): Promise<CommerceReviewModelSchema | null> {
    const miss = this.ownReviewMissKey(actorPubky, order.id);
    const listingId = this.listingIdFromOrder(order);
    const serviceReview = order.reviews?.find(({ reviewerPubky }) => reviewerPubky === actorPubky);
    if (
      listingId === null ||
      serviceReview === undefined ||
      serviceReview.text.trim().length === 0 ||
      serviceReview.publicRemoved === true ||
      (await LocalCommerceService.hasOwedOwnReviewRemoval(actorPubky, order.id, listingId))
    ) {
      this.ownReviewHomeserverMisses.add(miss);
      return null;
    }
    if (!this.liveIdentityMatches(hydrateIdentity)) return null;
    Logger.info('Republishing an own review no homeserver record carries', { orderId: order.id });
    const isBuyer = actorPubky === order.buyerPubky;
    return await this.commitPublishOwnReview({
      actorPubky,
      order,
      repair: true,
      stillCurrent: () => this.liveIdentityMatches(hydrateIdentity),
      result: {
        review: {
          reviewerPubky: actorPubky,
          reviewerRole: isBuyer ? 'buyer' : 'seller',
          subjectPubky: isBuyer ? order.sellerPubky : order.buyerPubky,
          rating: serviceReview.rating,
          text: serviceReview.text,
          createdAt: serviceReview.createdAt,
          updatedAt: serviceReview.updatedAt ?? serviceReview.createdAt,
        },
        attestation,
      },
    });
  }

  /**
   * Whether the service holds the actor's review of one listing of the order
   * as withdrawn, read fresh. `unknown` when the read fails or finds no
   * order: a caller about to publish must treat that as "do not".
   */
  private static async fetchOwnReviewRemovalState(
    actorPubky: string,
    orderId: string,
    listingId: string,
  ): Promise<'removed' | 'live' | 'unknown'> {
    try {
      const fresh = await MarketplaceGatewayService.getOrder(actorPubky, orderId);
      if (fresh === null) return 'unknown';
      return reviewOfListing(fresh, actorPubky, listingId)?.publicRemoved === true ? 'removed' : 'live';
    } catch (error) {
      Logger.warn('Could not read the order to check whether its review was removed', { orderId, listingId, error });
      return 'unknown';
    }
  }

  /**
   * True when the user removed their review of this listing of the order: an
   * owed removal on this device, or a withdrawal the service holds for that
   * listing (confirmed fresh when the order data says so, since that data may
   * predate a later edit). An old service sends no flag, which reads as not
   * removed.
   */
  private static async ownReviewWithdrawn(
    actorPubky: string,
    order: MarketplaceOrder,
    listingId: string,
  ): Promise<boolean> {
    if (await LocalCommerceService.hasOwedOwnReviewRemoval(actorPubky, order.id, listingId)) return true;
    if (reviewOfListing(order, actorPubky, listingId)?.publicRemoved !== true) return false;
    return (await this.fetchOwnReviewRemovalState(actorPubky, order.id, listingId)) !== 'live';
  }

  /**
   * Reads one of the actor's reviews of an order from their homeserver. With
   * `knownReviewId` (a local row's ID, possibly the legacy per-listing one)
   * the record is read at that path; without it the path comes from the
   * listing's attested `order_ref`: the order's first-line attestation, or
   * the listing's own entry of `attestations` (the order's per-listing
   * attestations) when those are given. `listingId` names the reviewed
   * listing and defaults to the order's first line. `missing` is an ordinary
   * 404, `unresolved` anything that makes no claim (a record that is not
   * this order's, a failed read).
   */
  private static async readOwnReviewFromHomeserver(
    actorPubky: string,
    order: MarketplaceOrder,
    options: {
      knownReviewId?: string;
      listingId?: string;
      attestations?: MarketplaceItemAttestation[];
    } = {},
  ): Promise<OwnReviewRead> {
    const { knownReviewId, attestations } = options;
    const firstLineListingId = this.listingIdFromOrder(order);
    const listingId = options.listingId ?? firstLineListingId;
    if (listingId === null) return { kind: 'unresolved' };
    const isBuyer = actorPubky === order.buyerPubky;
    const isSeller = actorPubky === order.sellerPubky;
    if (!isBuyer && !isSeller) return { kind: 'unresolved' };
    const role: 'buyer_reviewing_seller' | 'seller_reviewing_buyer' = isBuyer
      ? 'buyer_reviewing_seller'
      : 'seller_reviewing_buyer';
    const subjectPubky = isBuyer ? order.sellerPubky : order.buyerPubky;
    let reviewId = knownReviewId ?? '';
    try {
      let stored: { found: false } | { found: true; json: unknown };
      if (knownReviewId === undefined) {
        // The order's own attestation names its `order_ref`: no attestation
        // means nothing was ever published for this order.
        const attestation =
          attestations === undefined
            ? marketplaceAttestationSchema.safeParse(
                await MarketplaceGatewayService.getReviewAttestation(actorPubky, order.id),
              )
            : { success: true as const, data: attestations.find((candidate) => candidate.listingId === listingId) };
        if (!attestation.success || attestation.data === undefined) return { kind: 'missing' };
        const pathInput = { actorPubky, listingOwnerPubky: order.sellerPubky, listingId, subjectPubky, role };
        reviewId = await this.ownReviewPathId({ ...pathInput, orderRef: attestation.data.claims.orderRef });
        stored = await CommerceHomeserverService.fetchJsonIfFound(
          CommerceRecordNormalizer.reviewUri(actorPubky, reviewId),
        );
        if (!stored.found && listingId === firstLineListingId) {
          // A review published before per-order reviews lives at the legacy
          // per-listing path of the first line; it is this order's only when
          // it embeds this order's attestation.
          const legacyId = await this.ownReviewPathId(pathInput);
          const legacy = await CommerceHomeserverService.fetchJsonIfFound(
            CommerceRecordNormalizer.reviewUri(actorPubky, legacyId),
          );
          const legacyMatches =
            legacy.found &&
            (legacy.json as { eligibilityAttestation?: unknown } | null)?.eligibilityAttestation ===
              attestation.data.jws;
          if (!legacyMatches) return { kind: 'overwritten', attestation: attestation.data };
          reviewId = legacyId;
          stored = legacy;
        }
        if (!stored.found) return { kind: 'missing' };
      } else {
        stored = await CommerceHomeserverService.fetchJsonIfFound(
          CommerceRecordNormalizer.reviewUri(actorPubky, knownReviewId),
        );
        if (!stored.found) return { kind: 'missing' };
      }
      const record = CommerceRecordNormalizer.review(stored.json);
      if (
        record.ownerPubky !== actorPubky ||
        record.listingId !== listingId ||
        record.listingOwnerPubky !== order.sellerPubky ||
        record.role !== role ||
        record.subjectPubky !== subjectPubky ||
        record.reviewId !== reviewId
      ) {
        Logger.warn('Own review homeserver record identity did not match this order; leaving status unresolved', {
          orderId: order.id,
          reviewId,
        });
        return { kind: 'unresolved' };
      }
      const verifiedIss = verifyOwnReviewAttestation(record);
      return {
        kind: 'found',
        model: {
          id: `${actorPubky}:${reviewId}`,
          owner_id: actorPubky,
          review_id: reviewId,
          order_id: order.id,
          subject_id: record.subjectPubky,
          record,
          attestation_verified: verifiedIss !== null,
          attestation_iss: verifiedIss,
          sync_status: 'synced',
          updated_at: Date.now(),
        },
      };
    } catch (error) {
      if (isAppError(error) && isNotFound(error)) return { kind: 'missing' };
      Logger.warn('Own review homeserver read failed; leaving publication status unresolved', {
        orderId: order.id,
        reviewId,
        error,
      });
      return { kind: 'unresolved' };
    }
  }

  /**
   * The current user's published review rows of one order, one per reviewed
   * listing in line order. Local-first like {@link getOwnMarketplaceReview}:
   * rows in Dexie return at once, and a listing the service shows the user
   * reviewed but that has no local row (wiped with identity, or published
   * from another device) is hydrated from the reviewer's homeserver: the
   * order's per-listing attestations name each `order_ref`, and each record
   * is read from its deterministic path. GET only, never PUT; a missing
   * record stays unresolved instead of claiming unpublished.
   */
  static async getOwnMarketplaceOrderReviews(
    actorPubky: string,
    order: MarketplaceOrder,
  ): Promise<CommerceReviewModelSchema[]> {
    const local = await LocalCommerceService.getOwnReviewsByOrder(actorPubky, order.id);
    const reviewed = reviewsOfReviewer(order, actorPubky).flatMap((review) => {
      const aggregateId = reviewListingAggregateId(order, review);
      return aggregateId === null ? [] : [aggregateId];
    });
    const missing = orderReviewListings(order).filter(
      ({ listingAggregateId, listingId }) =>
        reviewed.includes(listingAggregateId) &&
        !local.some((row) => row.record.listingId === listingId) &&
        !this.ownReviewHomeserverMisses.has(this.ownReviewItemMissKey(actorPubky, order.id, listingId)),
    );
    const hydrated =
      missing.length === 0
        ? []
        : await this.hydrateOwnReviewItemsFromHomeserver(
            actorPubky,
            order,
            missing.map(({ listingId }) => listingId),
          );
    const lineOrder = orderReviewListings(order).map(({ listingId }) => listingId);
    return [...local, ...hydrated].sort(
      (a, b) => lineOrder.indexOf(a.record.listingId) - lineOrder.indexOf(b.record.listingId),
    );
  }

  private static ownReviewItemMissKey(actorPubky: string, orderId: string, listingId: string): string {
    return `${actorPubky}:${orderId}:${listingId}`;
  }

  /**
   * Rebuilds the local rows of the listings that have none, from one read of
   * the order's review attestations and one GET per record. Never a PUT.
   */
  private static async hydrateOwnReviewItemsFromHomeserver(
    actorPubky: string,
    order: MarketplaceOrder,
    listingIds: string[],
  ): Promise<CommerceReviewModelSchema[]> {
    if (!this.liveIdentityMatches(actorPubky)) return [];
    let attestations: MarketplaceItemAttestation[];
    try {
      attestations = extractReviewAttestations({
        attestations: (await MarketplaceGatewayService.getReviewAttestations(actorPubky, order.id)) ?? [],
      });
    } catch (error) {
      Logger.warn('Own review attestations read failed; leaving publication status unresolved', {
        orderId: order.id,
        error,
      });
      return [];
    }

    const hydrated: CommerceReviewModelSchema[] = [];
    for (const listingId of listingIds) {
      const read = await this.readOwnReviewFromHomeserver(actorPubky, order, { listingId, attestations });
      if (read.kind === 'missing') {
        this.ownReviewHomeserverMisses.add(this.ownReviewItemMissKey(actorPubky, order.id, listingId));
        continue;
      }
      if (read.kind === 'overwritten') {
        // Only a one-review order can predate per-order IDs, so the service's
        // single review of the reviewer is the one the repair republishes.
        if (reviewsOfReviewer(order, actorPubky).length !== 1) continue;
        const { jws, claims } = read.attestation;
        const repaired = await this.republishOverwrittenOwnReview(actorPubky, order, { jws, claims }, actorPubky);
        if (repaired !== null) hydrated.push(repaired);
        else this.ownReviewHomeserverMisses.add(this.ownReviewItemMissKey(actorPubky, order.id, listingId));
        continue;
      }
      if (read.kind !== 'found') continue;
      // Auth-cleanup may wipe `commerce_reviews` while the GET is in flight,
      // and a publication may have staged this record since: never re-seed
      // another identity's table or overwrite a newer local row.
      if (!this.liveIdentityMatches(actorPubky)) return hydrated;
      try {
        const current = await LocalCommerceService.getOwnReviewById(read.model.id);
        if (current !== undefined) {
          hydrated.push(current);
          continue;
        }
        // The user removed this item's review: a record still served (a DEL
        // owed, or not yet visible) must not be shown again.
        if (await this.ownReviewWithdrawn(actorPubky, order, listingId)) {
          this.ownReviewHomeserverMisses.add(this.ownReviewItemMissKey(actorPubky, order.id, listingId));
          continue;
        }
        await LocalCommerceService.upsertOwnReview(read.model);
        hydrated.push(read.model);
      } catch (error) {
        Logger.warn('Own review homeserver hydrate failed; leaving publication status unresolved', {
          orderId: order.id,
          listingId,
          error,
        });
      }
    }
    return hydrated;
  }

  /**
   * One order's review writes (publish, refresh, delete) take this lock, per
   * actor and order, so a read that raced a delete cannot write a review
   * back, a DEL cannot land after a newer publication, and two tabs
   * publishing one order revise its records in turn instead of at once.
   * Without Web Locks the writes queue in this tab only. The holder takes no
   * other lock.
   */
  private static async withOwnReviewLock<T>(actorPubky: string, orderId: string, body: () => Promise<T>): Promise<T> {
    return await withExclusiveLock(`pubky-review|${actorPubky}|${orderId}`, body);
  }

  /**
   * Re-reads the actor's own reviews of these orders from their homeserver
   * and refreshes the local rows, so an edit made on another device shows
   * without waiting for a cache miss. Only orders that already carry the
   * actor's review at the service are read, one record per local row (an
   * order with no local row reads its first line's record). A local row wins
   * over the homeserver while it is unsynced, owes a removal, or is not
   * older than the homeserver record; a homeserver 404 or a failed read
   * never clears a local row (reads lag acked writes). Returns the number of
   * rows changed.
   */
  static async refreshOwnReviews(actorPubky: string, orders: MarketplaceOrder[]): Promise<number> {
    let refreshed = 0;
    for (const order of orders) {
      if (!this.liveIdentityMatches(actorPubky)) break;
      if (!order.reviews?.some(({ reviewerPubky }) => reviewerPubky === actorPubky)) continue;
      refreshed += await this.withOwnReviewLock(actorPubky, order.id, async () => {
        const rows = await LocalCommerceService.getOwnReviewsByOrder(actorPubky, order.id);
        const targets = rows.length === 0 ? [undefined] : rows;
        let changed = 0;
        for (const local of targets) {
          if (local?.sync_status === 'pending') continue;
          const listingId = local?.record.listingId ?? this.listingIdFromOrder(order);
          if (listingId !== null && (await this.ownReviewWithdrawn(actorPubky, order, listingId))) {
            // Removed on another device: this device's copy of the item goes too.
            if (local === undefined || !this.liveIdentityMatches(actorPubky)) continue;
            await LocalCommerceService.abandonOwnReviewPublication(local);
            changed += 1;
            continue;
          }
          const read = await this.readOwnReviewFromHomeserver(actorPubky, order, {
            knownReviewId: local?.review_id,
            listingId: local?.record.listingId,
          });
          if (read.kind !== 'found') continue;
          if (this.deletedOwnReviews.has(read.model.id)) continue;
          if (!this.liveIdentityMatches(actorPubky)) continue;
          if (await LocalCommerceService.applyRefreshedOwnReview(read.model)) changed += 1;
        }
        return changed;
      });
    }
    return refreshed;
  }

  /**
   * Removes the actor's published reviews of one order. The local rows go at
   * once (one per reviewed listing), each with its own `remove` job in the
   * outbox, in one transaction per row. Then, one item at a time, the
   * service records that item's withdrawal (`review.withdraw` naming the
   * listing) and only then the homeserver DEL of its record; a failed step
   * keeps the job, and {@link resumeOwnReviewRemovals} retries both (each is
   * idempotent) instead of leaving a record public or republishable.
   * Returns `removed` once every record was withdrawn and deleted (one
   * already gone counts), `queued` while any removal is still owed, and
   * `absent` when there was no local review to remove. A review still
   * withheld by a double-blind window counts as one. The service keeps the
   * reviews themselves; this never re-opens the order for a new review.
   */
  static async commitDeleteOwnReview(actorPubky: string, orderId: string): Promise<OwnReviewDeleteOutcome> {
    return await this.withOwnReviewLock(actorPubky, orderId, async () => {
      const rows = await LocalCommerceService.getOwnReviewsByOrder(actorPubky, orderId);
      // A review still withheld by a double-blind window has no record: its
      // held terms are marked withdrawn first (so a release never publishes
      // them), and the service withdrawal follows below.
      const [withheld] = await LocalCommerceService.getAwaitingReleaseReviewJobs(actorPubky, orderId);
      if (rows.length === 0 && withheld === undefined) return 'absent';
      if (withheld !== undefined) {
        const held = awaitingReleasePayloadSchema.safeParse(withheld.payload);
        await LocalCommerceService.stageAwaitingReleaseReview({
          ...withheld,
          payload: {
            ...(held.success
              ? held.data
              : { orderId, sellerPubky: '', firstListingId: null, releaseAt: null, result: {} }),
            withdrawn: true,
          } as CommerceJsonValue,
          updated_at: Math.max(Date.now(), withheld.updated_at + 1),
        });
      }
      const removals: { jobId: string; url: string; listingId: string }[] = [];
      for (const local of rows) {
        const listingId = local.record.listingId;
        const url = CommerceRecordNormalizer.reviewUri(actorPubky, local.review_id);
        const job = this.createSyncJob({
          ownerId: actorPubky,
          entityType: 'review',
          entityId: local.review_id,
          operation: 'remove',
          payload: { url, orderId, listingId },
          now: Date.now(),
        });
        this.deletedOwnReviews.add(local.id);
        await LocalCommerceService.stageOwnReviewRemoval(local, job);
        removals.push({ jobId: job.id, url, listingId });
      }
      // Every item is cleared locally and owed before the first network call,
      // so an interrupted removal resumes from the outbox. Then one item at a
      // time: its withdrawal, then its DEL.
      let outcome: OwnReviewDeleteOutcome = 'removed';
      for (const { jobId, url, listingId } of removals) {
        if (!(await this.sendOwnReviewRemoval(actorPubky, jobId, url, orderId, listingId))) outcome = 'queued';
      }
      if (withheld !== undefined && !(await this.finishWithdrawnAwaitingReview(actorPubky, withheld.id, orderId))) {
        outcome = 'queued';
      }
      return outcome;
    });
  }

  /**
   * Sends one staged removal in its fixed order: the service records the
   * withdrawal FIRST, then the homeserver DEL. A repair that PUT before the
   * withdrawal is erased by the DEL that follows; one that PUT after the DEL
   * sees the withdrawal and retracts its own record. Both steps are
   * idempotent (a withdrawal already recorded and a 404 both count as done),
   * so the job simply retries from the top. Any other failure keeps the job,
   * with its attempt count and cause recorded.
   */
  private static async sendOwnReviewRemoval(
    actorPubky: string,
    jobId: string,
    url: string,
    orderId: string,
    listingId?: string,
  ): Promise<boolean> {
    const withdrawal = await this.withdrawOwnReviewAtService(actorPubky, orderId, listingId);
    if (withdrawal !== null) {
      Logger.warn('Own review withdrawal failed; the outbox job stays and retries', { jobId, code: withdrawal });
      await LocalCommerceService.recordSyncJobFailure(jobId, withdrawal);
      return false;
    }
    try {
      await CommerceHomeserverService.delete(url);
    } catch (error) {
      if (!(isAppError(error) && isNotFound(error))) {
        Logger.warn('Own review removal failed; the outbox job stays and retries', { jobId, error });
        await LocalCommerceService.recordSyncJobFailure(jobId, isAppError(error) ? String(error.code) : null);
        return false;
      }
    }
    await LocalCommerceService.completeSyncJob(jobId);
    return true;
  }

  /**
   * `review.withdraw` for the actor's review of one listing of an order (the
   * order's reviews as a whole when no listing is named, as on a job staged
   * before per-item reviews). Reads the order first: no such review, or one
   * already withdrawn, is done without a command; otherwise the command
   * carries the order's current revision, and a revision conflict re-reads
   * and tries again. `listing_id` is sent only when the service names the
   * listing of its review. Returns `null` when the withdrawal stands, else a
   * short failure code.
   */
  private static async withdrawOwnReviewAtService(
    actorPubky: string,
    orderId: string,
    listingId?: string,
  ): Promise<string | null> {
    try {
      for (let attempt = 0; attempt < OWN_REVIEW_WITHDRAW_ATTEMPTS; attempt += 1) {
        const order = await MarketplaceGatewayService.getOrder(actorPubky, orderId);
        if (order === null) return 'ORDER_NOT_FOUND';
        const own =
          listingId === undefined
            ? reviewsOfReviewer(order, actorPubky)
            : [reviewOfListing(order, actorPubky, listingId)].filter((review) => review !== undefined);
        if (own.length === 0 || own.every(({ publicRemoved }) => publicRemoved === true)) return null;
        const itemListingId =
          listingId !== undefined && own[0]?.listingAggregateId !== undefined ? listingId : undefined;
        const response = await MarketplaceGatewayService.execute(
          actorPubky,
          CommerceRecordNormalizer.marketplaceCommand({
            version: 1,
            commandId: crypto.randomUUID(),
            aggregateId: buildMarketplaceOrderAggregateId(orderId),
            expectedRevision: order.revision,
            issuedAt: new Date().toISOString(),
            kind: 'review.withdraw',
            payload: itemListingId === undefined ? { orderId } : { orderId, listingId: itemListingId },
          }),
        );
        if (response.ok) return null;
        if (response.error.code === 'INVALID_STATE') return null;
        if (response.error.code !== 'REVISION_CONFLICT') return String(response.error.code);
      }
      return 'REVISION_CONFLICT';
    } catch (error) {
      return isAppError(error) ? String(error.code) : 'UNKNOWN';
    }
  }

  /**
   * Retries every removal whose service withdrawal or homeserver DEL never
   * landed. Each job is
   * re-read under its order's lock first, so two tabs retrying one job send
   * one DEL. Returns the number of removals that completed.
   */
  static async resumeOwnReviewRemovals(actorPubky: string): Promise<number> {
    const jobs = await LocalCommerceService.getOwnReviewRemovalJobs(actorPubky);
    let removed = 0;
    for (const queued of jobs) {
      const target = ownReviewRemovalTarget(queued.payload);
      if (target === null) continue;
      const { orderId, listingId } = target;
      removed += await this.withOwnReviewLock(actorPubky, orderId, async () => {
        const job = await LocalCommerceService.getSyncJob(queued.id);
        const url = job ? ownReviewRemovalUrl(job.payload) : null;
        if (!job || url === null) return 0;
        return (await this.sendOwnReviewRemoval(actorPubky, job.id, url, orderId, listingId)) ? 1 : 0;
      });
    }
    return removed;
  }

  /**
   * Publishes the reviewer-owned public review record after a successful
   * `review.create`/`review.update` (trust & reputation plan P1.6): builds
   * the `PubkyAppMarketplaceReview` via the specs builder (deterministic
   * hash ID), embeds the service-issued purchase attestation verbatim in
   * `eligibilityAttestation`, and PUTs it to the reviewer's homeserver with
   * the staged-job outbox pattern listing publication established — a failed
   * PUT leaves a visible pending row that
   * {@link resumeOwnReviewPublications} retries.
   *
   * This publishes the one record of a result that names no listing: the
   * `review` and first-line `attestation` of v1 terms. Results of per-item
   * terms go through {@link commitPublishOwnReviews}.
   *
   * Returns `null` (publishing nothing) when the command result carries no
   * attestation: the record's `eligibilityAttestation` is required, so a
   * deployment without an attestor keeps reviews service-only — an honest
   * absence, not a failure.
   */
  static async commitPublishOwnReview(input: {
    actorPubky: string;
    order: MarketplaceOrder;
    result: Record<string, unknown>;
    /** Checked right before each write; a publish not started by the user stops when the signed-in identity changes. */
    stillCurrent?: () => boolean;
    /**
     * A repair of a review the service holds, not the user's own act: it
     * yields to a removal made on this device, and returns a local row that
     * appeared meanwhile instead of writing over it.
     */
    repair?: boolean;
  }): Promise<CommerceReviewModelSchema | null> {
    const { actorPubky, order, result } = input;
    const stillCurrent = input.stillCurrent ?? (() => true);
    const attestation = extractReviewAttestation(result);
    if (attestation === null) return null;
    const review = reviewResultSchema.parse(result.review);

    const listingId = this.listingIdFromOrder(order);
    if (listingId === null) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'Order lines carry no parseable listing identity.', {
        service: ErrorService.Marketplace,
        operation: 'commitPublishOwnReview',
        context: { orderId: order.id },
      });
    }
    return await this.withOwnReviewLock(actorPubky, order.id, () =>
      this.publishReviewRecord({
        actorPubky,
        order,
        listingId,
        review,
        attestation,
        stillCurrent,
        repair: input.repair === true,
      }),
    );
  }

  /**
   * Publishes one record per reviewed listing of a review command result:
   * each `reviews[]` entry is paired with the attestation the service issued
   * for its listing and written to the reviewer's homeserver, so an edit of
   * one item revises only that item's record. The buyer's seller ratings
   * ride on every record the command wrote. A result without per-item
   * entries publishes its single v1 record.
   *
   * The order's records are published under a cross-tab lock and in line
   * order. A record whose PUT fails stays pending for the resume; the others
   * are still published, and the first failure is thrown once all were
   * attempted.
   */
  static async commitPublishOwnReviews(input: {
    actorPubky: string;
    order: MarketplaceOrder;
    result: Record<string, unknown>;
  }): Promise<CommerceReviewModelSchema[]> {
    const { actorPubky, order, result } = input;
    const withheld = readReviewResultPending(result);
    if (withheld !== null) {
      await this.stageAwaitingReleaseReview(actorPubky, order, result, withheld.releaseAt);
      return [];
    }
    const items = this.reviewItemsOf(order, result, extractReviewAttestations(result));
    if (items.length === 0) {
      const single = await this.commitPublishOwnReview(input);
      return single === null ? [] : [single];
    }

    return await this.withOwnReviewLock(actorPubky, order.id, async () => {
      const published: CommerceReviewModelSchema[] = [];
      let firstFailure: unknown;
      for (const item of items) {
        try {
          const record = await this.publishReviewRecord({ actorPubky, order, ...item });
          if (record !== null) published.push(record);
        } catch (error) {
          firstFailure ??= error;
        }
      }
      if (firstFailure !== undefined) throw firstFailure;
      return published;
    });
  }

  /**
   * The per-item reviews of a command result, each paired with the attestation
   * the service issued for its listing, in the result's order. Reviews of
   * listings without an attestation are left out.
   */
  private static reviewItemsOf(
    order: MarketplaceOrder,
    result: Record<string, unknown>,
    attestations: MarketplaceItemAttestation[],
  ) {
    const entries = Array.isArray(result.reviews)
      ? result.reviews.flatMap((entry) => {
          const parsed = reviewItemResultSchema.safeParse(entry);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
    return entries.flatMap((review) => {
      const listingId = listingIdFromAggregate(order.sellerPubky, review.listingAggregateId);
      const attestation = attestations.find((candidate) => candidate.listingId === listingId);
      return listingId === null || attestation === undefined ? [] : [{ listingId, review, attestation }];
    });
  }

  /** Builds, stages and PUTs the record of one reviewed listing; the caller holds the order's publication lock. */
  private static async publishReviewRecord(input: {
    actorPubky: string;
    order: MarketplaceOrder;
    listingId: string;
    review: z.infer<typeof reviewResultSchema>;
    attestation: MarketplaceAttestation;
    stillCurrent?: () => boolean;
    repair?: boolean;
  }): Promise<CommerceReviewModelSchema | null> {
    const { actorPubky, order, listingId, review, attestation } = input;
    const stillCurrent = input.stillCurrent ?? (() => true);
    const role = review.reviewerRole === 'buyer' ? 'buyer_reviewing_seller' : 'seller_reviewing_buyer';
    // A review published before per-order IDs lives at the per-listing path
    // without `orderRef`; its edits revise it there instead of forking a
    // second record for the same order.
    const existing = await LocalCommerceService.getOwnReviewByOrder(actorPubky, order.id, listingId);
    if (input.repair === true) {
      if (await LocalCommerceService.hasOwedOwnReviewRemoval(actorPubky, order.id, listingId)) return null;
      if (existing !== undefined) return existing;
    }
    const orderRef =
      existing !== undefined && existing.record.orderRef === undefined ? undefined : attestation.claims.orderRef;
    // The seller ratings are one per order: both or neither, on every item record.
    const sellerRatings =
      review.shipping != null && review.communication != null
        ? { shipping: review.shipping, communication: review.communication }
        : {};

    const build = async (revision: number, createdAt: string) => {
      const { PubkySpecsBuilder } = await import('pubky-app-specs');
      const built = new PubkySpecsBuilder(actorPubky).createMarketplaceReview({
        schemaVersion: 1,
        recordType: 'review',
        ownerPubky: actorPubky,
        revision,
        createdAt,
        updatedAt: review.updatedAt,
        reviewId: '',
        subjectPubky: review.subjectPubky,
        listingOwnerPubky: order.sellerPubky,
        listingId,
        role,
        ratings: { overall: review.rating, ...sellerRatings },
        text: review.text,
        eligibilityAttestation: attestation.jws,
        ...(orderRef === undefined ? {} : { orderRef }),
      });
      return {
        record: commerceReviewRecordSchema.parse(built.marketplace_review.toJson()),
        reviewId: built.meta.id,
      };
    };

    // The hash ID is deterministic per (listing, subject, role, order): an
    // edit of this item's review bumps `revision` and keeps the original
    // `createdAt`; another item or order gets its own record.
    const probe = await build(1, review.createdAt);
    const prior = await LocalCommerceService.getOwnReviewById(`${actorPubky}:${probe.reviewId}`);
    const { record, reviewId } =
      prior === undefined ? probe : await build(prior.record.revision + 1, prior.record.createdAt);

    const verifiedIss = verifyOwnReviewAttestation(record);
    const model: CommerceReviewModelSchema = {
      id: `${actorPubky}:${reviewId}`,
      owner_id: actorPubky,
      review_id: reviewId,
      order_id: order.id,
      subject_id: record.subjectPubky,
      record,
      attestation_verified: verifiedIss !== null,
      attestation_iss: verifiedIss,
      sync_status: 'pending',
      updated_at: Date.now(),
    };
    const url = CommerceRecordNormalizer.reviewUri(actorPubky, reviewId);
    const job = this.createSyncJob({
      ownerId: actorPubky,
      entityType: 'review',
      entityId: reviewId,
      operation: 'publish',
      payload: { url },
      now: Date.now(),
    });

    if (!stillCurrent()) return null;
    if (input.repair !== true) this.deletedOwnReviews.delete(model.id);
    await LocalCommerceService.stageOwnReviewSync(model, job);
    if (!stillCurrent()) return null;
    if (input.repair === true && (await this.fetchOwnReviewRemovalState(actorPubky, order.id, listingId)) !== 'live') {
      // Removed since the order was read, or not checkable: publish nothing.
      await LocalCommerceService.abandonOwnReviewPublication(model);
      return null;
    }
    await CommerceHomeserverService.putJson(url, { ...record });
    if (input.repair === true) {
      // A withdrawal sets its flag before its DEL, so a flag that appeared
      // during the PUT means the DEL may have missed this record: take it
      // back. A check that cannot answer leaves the row pending; the retry
      // checks again before it writes anything.
      const after = await this.fetchOwnReviewRemovalState(actorPubky, order.id, listingId);
      if (after === 'removed') {
        await this.retractRepublishedOwnReview(model, url);
        return null;
      }
      if (after === 'unknown') return model;
    }
    const synced: CommerceReviewModelSchema = { ...model, sync_status: 'synced', updated_at: Date.now() };
    if (!stillCurrent()) return null;
    await LocalCommerceService.upsertOwnReview(synced);
    await LocalCommerceService.completeSyncJob(job.id);
    return synced;
  }

  /**
   * Takes back a publication a withdrawal overtook: DELs the record (a 404
   * counts) and drops the row and its jobs. A failed DEL leaves the pending
   * row for the next retry, which finds the withdrawal again.
   */
  private static async retractRepublishedOwnReview(row: CommerceReviewModelSchema, url: string): Promise<void> {
    try {
      await CommerceHomeserverService.delete(url);
    } catch (error) {
      if (!(isAppError(error) && isNotFound(error))) {
        Logger.warn('Could not take back a review that was removed meanwhile; it stays pending', {
          reviewId: row.review_id,
          error,
        });
        return;
      }
    }
    await LocalCommerceService.abandonOwnReviewPublication(row);
  }

  /**
   * Retries every own-review record whose homeserver PUT never landed (the
   * visible retryable outbox): re-publishes the staged record verbatim and
   * marks it synced, and re-reads the attestations of reviews a double-blind
   * window still withheld ({@link resumeAwaitingReleaseReviews}). Called when
   * the orders surface loads, so a failed publication heals on the next visit
   * instead of rotting silently.
   */
  static async resumeOwnReviewPublications(actorPubky: string): Promise<number> {
    const pending = await LocalCommerceService.getPendingOwnReviews(actorPubky);
    let published = await this.resumeAwaitingReleaseReviews(actorPubky);
    for (const queued of pending) {
      const url = CommerceRecordNormalizer.reviewUri(queued.owner_id, queued.review_id);
      published += await this.withOwnReviewLock(queued.owner_id, queued.order_id, async () => {
        // Re-read under the lock: a removal or a newer publication since the
        // scan owns the review now.
        const row = await LocalCommerceService.getOwnReviewById(queued.id);
        if (row === undefined || row.sync_status !== 'pending') return 0;
        if (await LocalCommerceService.hasOwedOwnReviewRemoval(row.owner_id, row.order_id, row.record.listingId)) {
          return 0;
        }
        // The user may have removed this item's review elsewhere since it was staged.
        const removal = await this.fetchOwnReviewRemovalState(row.owner_id, row.order_id, row.record.listingId);
        if (removal === 'unknown') return 0;
        if (removal === 'removed') {
          await this.retractRepublishedOwnReview(row, url);
          return 0;
        }
        try {
          await CommerceHomeserverService.putJson(url, { ...row.record });
          await LocalCommerceService.upsertOwnReview({ ...row, sync_status: 'synced', updated_at: Date.now() });
          await LocalCommerceService.completeOwnReviewPublishJobs(row.owner_id, row.review_id);
          return 1;
        } catch (error) {
          Logger.warn('Own review publication retry failed; the row stays pending', {
            reviewId: row.review_id,
            error,
          });
          return 0;
        }
      });
    }
    return published;
  }

  /**
   * Holds a review the service withheld behind a double-blind window: it
   * issued no attestation, so there is no record to build yet. The terms of
   * the result wait in the outbox as one `awaiting_release` job per order
   * (not a failure: no attempts, no backoff), and an edit made meanwhile
   * replaces the item it edits. Nothing is published before release.
   */
  private static async stageAwaitingReleaseReview(
    actorPubky: string,
    order: MarketplaceOrder,
    result: Record<string, unknown>,
    releaseAt: string | null,
  ): Promise<void> {
    const review = reviewResultSchema.safeParse(result.review);
    const reviews = Array.isArray(result.reviews)
      ? result.reviews.flatMap((entry) => {
          const parsed = reviewItemResultSchema.safeParse(entry);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
    if (!review.success && reviews.length === 0) {
      Logger.warn('A withheld review result carried no review terms; nothing was held for release', {
        orderId: order.id,
      });
      return;
    }
    await this.withOwnReviewLock(actorPubky, order.id, async () => {
      const [earlier] = await LocalCommerceService.getAwaitingReleaseReviewJobs(actorPubky, order.id);
      const held = earlier === undefined ? null : awaitingReleasePayloadSchema.safeParse(earlier.payload);
      const before = held?.success === true && held.data.withdrawn !== true ? held.data.result : null;
      const merged = [...(before?.reviews ?? [])];
      for (const next of reviews) {
        const at = merged.findIndex(({ listingAggregateId }) => listingAggregateId === next.listingAggregateId);
        if (at === -1) merged.push(next);
        else merged[at] = next;
      }
      const lineOf = (aggregateId: string) => order.lines.findIndex((line) => line.listingAggregateId === aggregateId);
      merged.sort((left, right) => lineOf(left.listingAggregateId) - lineOf(right.listingAggregateId));
      const payload: AwaitingReleasePayload = {
        orderId: order.id,
        sellerPubky: order.sellerPubky,
        firstListingId: this.listingIdFromOrder(order),
        releaseAt: releaseAt ?? (held?.success === true ? held.data.releaseAt : null),
        result: {
          ...(review.success ? { review: review.data } : before?.review ? { review: before.review } : {}),
          ...(merged.length > 0 ? { reviews: merged } : {}),
        },
      };
      const now = Date.now();
      await LocalCommerceService.stageAwaitingReleaseReview({
        ...this.createSyncJob({
          ownerId: actorPubky,
          entityType: 'review',
          entityId: order.id,
          operation: 'publish',
          payload: payload as CommerceJsonValue,
          now,
        }),
        status: 'awaiting_release',
        created_at: earlier?.created_at ?? now,
      });
    });
  }

  /** The reviews the user wrote that a double-blind window still withholds, newest terms first-written first; withdrawn ones are gone. */
  static async getAwaitingReleaseReviews(actorPubky: string): Promise<AwaitingReleaseReview[]> {
    const jobs = await LocalCommerceService.getAwaitingReleaseReviewJobs(actorPubky);
    return jobs.flatMap((job) => {
      const parsed = awaitingReleasePayloadSchema.safeParse(job.payload);
      if (!parsed.success || parsed.data.withdrawn === true) return [];
      const { orderId, sellerPubky, firstListingId, releaseAt, result } = parsed.data;
      const reviews = result.reviews ?? (result.review === undefined ? [] : [result.review]);
      const items = [
        ...(result.reviews ?? []).map((review) => ({
          listingId: listingIdFromAggregate(sellerPubky, review.listingAggregateId),
          review,
        })),
        ...((result.reviews ?? []).length === 0 && result.review !== undefined
          ? [{ listingId: firstListingId, review: result.review }]
          : []),
      ].flatMap(({ listingId, review }) =>
        listingId === null
          ? []
          : [
              {
                listingOwnerPubky: sellerPubky,
                listingId,
                rating: review.rating,
                text: review.text,
                updatedAt: review.updatedAt,
              },
            ],
      );
      const role = reviews[0]?.reviewerRole;
      return role === undefined || items.length === 0 ? [] : [{ orderId, releaseAt, reviewerRole: role, items }];
    });
  }

  /**
   * Retries the reviews a double-blind window withheld: each order's job is
   * re-read under that order's lock (two tabs retrying one job publish one
   * set of records), and the attestations are asked for again. Still
   * withheld leaves the job as it is, a released answer publishes the item
   * records in line order, and a review the user removed meanwhile never
   * publishes. With `orderId` only that order is retried. Returns the number
   * of records published.
   */
  static async resumeAwaitingReleaseReviews(actorPubky: string, orderId?: string): Promise<number> {
    const jobs = await LocalCommerceService.getAwaitingReleaseReviewJobs(actorPubky, orderId);
    let published = 0;
    for (const queued of jobs) {
      if (!this.liveIdentityMatches(actorPubky)) break;
      published += await this.withOwnReviewLock(actorPubky, queued.entity_id, () =>
        this.releaseAwaitingReview(actorPubky, queued.id),
      );
    }
    return published;
  }

  /** One retry of a withheld review; the caller holds its order's publication lock. */
  private static async releaseAwaitingReview(actorPubky: string, jobId: string): Promise<number> {
    const job = await LocalCommerceService.getSyncJob(jobId);
    if (job === undefined || job === null || job.status !== 'awaiting_release') return 0;
    const orderId = job.entity_id;
    const parsed = awaitingReleasePayloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      Logger.warn('A withheld review job carries unreadable terms; dropping it', { orderId });
      await LocalCommerceService.completeSyncJob(job.id);
      return 0;
    }
    const payload = parsed.data;
    if (payload.withdrawn === true) {
      await this.finishWithdrawnAwaitingReview(actorPubky, job.id, orderId);
      return 0;
    }

    let order: MarketplaceOrder | null;
    let attestations: MarketplaceItemAttestation[];
    try {
      order = await MarketplaceGatewayService.getOrder(actorPubky, orderId);
      if (order === null) return 0;
      const read = await this.readAwaitingReleaseAttestations(actorPubky, order, payload);
      if (read === 'unavailable') return 0;
      if (read.kind === 'pending') {
        if (read.releaseAt !== payload.releaseAt) {
          await LocalCommerceService.stageAwaitingReleaseReview({
            ...job,
            payload: { ...payload, releaseAt: read.releaseAt } as CommerceJsonValue,
            updated_at: Math.max(Date.now(), job.updated_at + 1),
          });
        }
        return 0;
      }
      attestations = read.attestations;
    } catch (error) {
      Logger.warn('Could not re-read the attestations of a withheld review; it stays held', { orderId, error });
      return 0;
    }

    if (attestations.length === 0) {
      // Released, and this deployment issues no attestations: the review stays
      // service-only, as when no attestor is configured.
      await LocalCommerceService.completeSyncJob(job.id);
      return 0;
    }
    const stillCurrent = () => this.liveIdentityMatches(actorPubky);
    const items = this.awaitingReleaseItems(order, payload, attestations);
    let published = 0;
    let keepJob = false;
    for (const item of items) {
      if (!stillCurrent()) return published;
      if (await LocalCommerceService.hasOwedOwnReviewRemoval(actorPubky, orderId, item.listingId)) continue;
      try {
        const record = await this.publishReviewRecord({ actorPubky, order, ...item, stillCurrent, repair: true });
        if (record === null) {
          // Nothing was written. A removal is final; anything else (a read that
          // could not answer, an identity change) is retried.
          if ((await this.fetchOwnReviewRemovalState(actorPubky, orderId, item.listingId)) !== 'removed') {
            keepJob = true;
          }
        } else if (record.sync_status === 'synced') {
          published += 1;
        }
      } catch (error) {
        Logger.warn('A released review could not be published yet', { orderId, listingId: item.listingId, error });
        // The row staged before the failed PUT carries on from the outbox;
        // before that, the held terms are the only copy.
        if ((await LocalCommerceService.getOwnReviewByOrder(actorPubky, orderId, item.listingId)) === undefined) {
          keepJob = true;
        }
      }
    }
    if (!keepJob && stillCurrent()) await LocalCommerceService.completeSyncJob(job.id);
    return published;
  }

  /**
   * Re-reads the attestations of a withheld review: one per held item on
   * the per-item route, or the single first-line one for a review held
   * without per-item terms. `pending` carries the window end the service
   * answered with; `unavailable` means the service knows no such order.
   */
  private static async readAwaitingReleaseAttestations(
    actorPubky: string,
    order: MarketplaceOrder,
    payload: AwaitingReleasePayload,
  ): Promise<
    | { kind: 'pending'; releaseAt: string | null }
    | { kind: 'released'; attestations: MarketplaceItemAttestation[] }
    | 'unavailable'
  > {
    const perItem = (payload.result.reviews?.length ?? 0) > 0;
    const raw = perItem
      ? await MarketplaceGatewayService.getReviewAttestations(actorPubky, order.id)
      : await MarketplaceGatewayService.getReviewAttestation(actorPubky, order.id);
    if (raw === null) return 'unavailable';
    const pending = readReviewAttestationPending(raw);
    if (pending !== null) return { kind: 'pending', releaseAt: pending.releaseAt };
    if (perItem) {
      return { kind: 'released', attestations: extractReviewAttestations({ attestations: raw }) };
    }
    const single = marketplaceAttestationSchema.safeParse(raw);
    const listingId = this.listingIdFromOrder(order);
    return {
      kind: 'released',
      attestations: single.success && listingId !== null ? [{ ...single.data, listingId }] : [],
    };
  }

  /** The held terms paired with the released attestations, in line order. */
  private static awaitingReleaseItems(
    order: MarketplaceOrder,
    payload: AwaitingReleasePayload,
    attestations: MarketplaceItemAttestation[],
  ) {
    if ((payload.result.reviews?.length ?? 0) > 0) {
      return this.reviewItemsOf(order, { reviews: payload.result.reviews }, attestations);
    }
    const [single] = attestations;
    return payload.result.review === undefined || single === undefined
      ? []
      : [{ listingId: single.listingId, review: payload.result.review, attestation: single }];
  }

  /**
   * Finishes the removal of a review withdrawn while it was withheld: the
   * service withdrawal, then the job. Nothing was ever published, so there is
   * no homeserver record to delete. A withdrawal that does not land leaves
   * the (already withdrawn-marked) job for the next retry.
   */
  private static async finishWithdrawnAwaitingReview(
    actorPubky: string,
    jobId: string,
    orderId: string,
  ): Promise<boolean> {
    const failure = await this.withdrawOwnReviewAtService(actorPubky, orderId);
    if (failure !== null) {
      Logger.warn('Withdrawal of a withheld review failed; the outbox job stays and retries', { orderId, failure });
      return false;
    }
    await LocalCommerceService.completeSyncJob(jobId);
    return true;
  }

  /**
   * One product's own rating (buyer reviews of this listing only), from the
   * Nexus listing projection. `null` when the index answered and holds no
   * reviews for it (the page shows "No rating yet"); `unavailable` when the
   * index did not answer, has not indexed the listing, or sent a malformed
   * projection, so the page makes no claim. A single attempt, so a listing
   * Nexus has not indexed yet does not wait out the 404 backoff.
   *
   * The request names the effective trust list's windows (`attestors=`), so
   * an index with trust buckets also serves the exact counted figure, carried
   * on the snippet as `scoped`; older indexes ignore the parameter.
   */
  static async fetchListingRating(
    sellerPubky: string,
    listingId: string,
  ): Promise<CommerceReputationSnippet | null | 'unavailable'> {
    if (getCommerceAdapterMode() === 'sandbox') return 'unavailable';
    try {
      const attestors = attestorWindowsParam();
      const details = await NexusMarketplaceService.fetchListingDetailsOnce({
        seller_id: sellerPubky,
        listing_id: listingId,
        ...(attestors !== null && { attestors }),
      });
      const rating = CommerceRecordNormalizer.nexusListingDetails(details).listing_reputation;
      const scoped = CommerceRecordNormalizer.nexusScopedListingReputation(details);
      return rating === null || scoped === undefined ? rating : { ...rating, scoped };
    } catch {
      return 'unavailable';
    }
  }

  /**
   * The seller's public reputation overview for rating headers, with the
   * old-deployment ambiguity resolved honestly: the reputation endpoint
   * answers 404 both when the subject has no indexed reviews AND when the
   * Nexus deployment predates reputation indexing (unknown route). Claiming
   * "New seller" against an old index would be a fabrication, so a 404 is
   * only trusted as the New-seller state after the review-list endpoint
   * answers 200 (proving the deployment indexes reviews at all). Anything
   * else degrades to `unavailable`, which renders NO reputation surface —
   * absence, never a fake state.
   *
   * The request names the effective trust list's windows (`attestors=`), so
   * an index with trust buckets also serves the exact counted figure
   * (`scoped`); older indexes ignore the parameter.
   */
  static async fetchSellerReputationOverview(sellerPubky: string): Promise<CommerceSellerReputationOverview> {
    if (getCommerceAdapterMode() === 'sandbox') return { status: 'unavailable' };

    try {
      const attestors = attestorWindowsParam();
      const payload = await NexusMarketplaceService.fetchShopReputation({
        seller_id: sellerPubky,
        ...(attestors !== null && { attestors }),
      });
      return { status: 'rated', summary: CommerceRecordNormalizer.nexusReputationSummary(payload) };
    } catch (error) {
      if (!(isAppError(error) && isNotFound(error))) {
        Logger.warn('Seller reputation fetch failed; rendering no reputation surface', { sellerPubky, error });
        return { status: 'unavailable' };
      }
    }

    try {
      await NexusMarketplaceService.fetchShopReviews({ seller_id: sellerPubky, limit: 1 });
      return { status: 'new_seller' };
    } catch (error) {
      Logger.warn('Review index probe failed; rendering no reputation surface', { sellerPubky, error });
      return { status: 'unavailable' };
    }
  }

  /**
   * A page of indexed reviews about a seller (with joined seller responses),
   * newest-indexed first unless the page names a sort. `unavailable` means
   * the index does not serve review routes (old deployment or unreachable) —
   * callers render no review section rather than an empty one.
   */
  static async fetchSellerReviews(
    sellerPubky: string,
    page: CommerceReviewsPage = {},
  ): Promise<CommerceIndexedReviewsResult> {
    if (getCommerceAdapterMode() === 'sandbox') return { status: 'unavailable' };
    try {
      const payload = await NexusMarketplaceService.fetchShopReviews({ seller_id: sellerPubky, ...page });
      return reviewsResult(payload, page);
    } catch (error) {
      Logger.warn('Seller reviews fetch failed; rendering no review section', { sellerPubky, error });
      return { status: 'unavailable' };
    }
  }

  /** A page of indexed buyer reviews of one listing (with joined seller responses). */
  static async fetchListingReviews(
    sellerPubky: string,
    listingId: string,
    page: CommerceReviewsPage = {},
  ): Promise<CommerceIndexedReviewsResult> {
    if (getCommerceAdapterMode() === 'sandbox') return { status: 'unavailable' };
    try {
      const payload = await NexusMarketplaceService.fetchListingReviews({
        seller_id: sellerPubky,
        listing_id: listingId,
        ...page,
      });
      return reviewsResult(payload, page);
    } catch (error) {
      Logger.warn('Listing reviews fetch failed; rendering no review section', { sellerPubky, listingId, error });
      return { status: 'unavailable' };
    }
  }

  /**
   * The current user's own published review rows (local-first: the user owns
   * these records, so the list renders from the local copies with their
   * publication + verification state — no index round-trip).
   */
  static async getOwnReviews(actorPubky: string): Promise<CommerceReviewModelSchema[]> {
    return await LocalCommerceService.getOwnReviews(actorPubky);
  }

  /** The current user's own response row for one review, or null. */
  static async getOwnReviewResponse(
    actorPubky: string,
    reviewId: string,
  ): Promise<CommerceReviewResponseModelSchema | null> {
    return (await LocalCommerceService.getOwnReviewResponse(actorPubky, reviewId)) ?? null;
  }

  /**
   * Publishes (or revises) the current user's response to a review they are
   * the subject of — a `PubkyAppReviewResponse` record on the user's OWN
   * homeserver (ratified D7: subject-only, one revisable response per
   * review; the path ID equals the review's ID). There is no service
   * command for responses: the record is the whole mechanism, and Nexus
   * indexes it with the structural `owner == subjectPubky` check. Publication
   * uses the same staged-job retryable outbox as reviews and listings.
   *
   * `priorRevision` carries the newest revision the caller has seen from the
   * index (a response written on another device); the new revision always
   * moves past both it and the local copy.
   */
  static async commitPublishReviewResponse(input: {
    actorPubky: string;
    review: CommerceIndexedReview;
    text: string;
    priorRevision?: number | null;
    priorCreatedAt?: string | null;
  }): Promise<CommerceReviewResponseModelSchema> {
    const { actorPubky, review, text } = input;
    if (review.subjectId !== actorPubky) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'Only the review subject may respond to a review.', {
        service: ErrorService.Local,
        operation: 'commitPublishReviewResponse',
        context: { reviewId: review.reviewId },
      });
    }

    const prior = await LocalCommerceService.getOwnReviewResponse(actorPubky, review.reviewId);
    const baseRevision = Math.max(prior?.record.revision ?? 0, input.priorRevision ?? 0);
    const nowIso = new Date().toISOString();
    const createdAt = prior?.record.createdAt ?? input.priorCreatedAt ?? nowIso;

    const { PubkySpecsBuilder } = await import('pubky-app-specs');
    const built = new PubkySpecsBuilder(actorPubky).createReviewResponse({
      schemaVersion: 1,
      recordType: 'review_response',
      ownerPubky: actorPubky,
      revision: baseRevision + 1,
      createdAt,
      updatedAt: nowIso,
      reviewId: review.reviewId,
      reviewUri: CommerceRecordNormalizer.reviewUri(review.reviewerId, review.reviewId),
      text,
    });
    const record = CommerceRecordNormalizer.reviewResponse(built.review_response.toJson());

    const model: CommerceReviewResponseModelSchema = {
      id: `${actorPubky}:${review.reviewId}`,
      owner_id: actorPubky,
      review_id: review.reviewId,
      reviewer_id: review.reviewerId,
      record,
      sync_status: 'pending',
      updated_at: Date.now(),
    };
    const url = CommerceRecordNormalizer.reviewResponseUri(actorPubky, review.reviewId);
    const job = this.createSyncJob({
      ownerId: actorPubky,
      entityType: 'review_response',
      entityId: review.reviewId,
      operation: 'publish',
      payload: { url },
      now: Date.now(),
    });

    await LocalCommerceService.stageOwnReviewResponseSync(model, job);
    await CommerceHomeserverService.putJson(url, { ...record });
    const synced: CommerceReviewResponseModelSchema = { ...model, sync_status: 'synced', updated_at: Date.now() };
    await LocalCommerceService.upsertOwnReviewResponse(synced);
    await LocalCommerceService.completeSyncJob(job.id);
    return synced;
  }

  /**
   * Retries every own review-response record whose homeserver PUT never
   * landed — the same visible retryable outbox reviews use.
   */
  static async resumeOwnReviewResponsePublications(actorPubky: string): Promise<number> {
    const pending = await LocalCommerceService.getPendingOwnReviewResponses(actorPubky);
    let published = 0;
    for (const row of pending) {
      const url = CommerceRecordNormalizer.reviewResponseUri(row.owner_id, row.review_id);
      try {
        await CommerceHomeserverService.putJson(url, { ...row.record });
        await LocalCommerceService.upsertOwnReviewResponse({ ...row, sync_status: 'synced', updated_at: Date.now() });
        published += 1;
      } catch (error) {
        Logger.warn('Own review response publication retry failed; the row stays pending', {
          reviewId: row.review_id,
          error,
        });
      }
    }
    return published;
  }

  /**
   * Whether a seller has no storefront (`shop.json`) yet: no local row (saved
   * or mid-save) and no published record. An unreadable homeserver throws
   * rather than being taken as "no shop".
   */
  static async needsDefaultShop(ownerPubky: string): Promise<boolean> {
    if (await LocalCommerceService.getShop(ownerPubky)) return false;
    const published = await CommerceHomeserverService.fetchJsonIfFound(CommerceRecordNormalizer.shopUri(ownerPubky));
    return !published.found;
  }

  /**
   * Publishes a default storefront for a seller who has none, so apps that
   * only trust sellers with a storefront (Bitkit's Shop contacts) see them.
   * The final absence check and the write run in the seller's shop-write
   * queue, so a settings save queued first wins and one queued after
   * replaces the default.
   */
  static async commitCreateDefaultShop({
    ownerPubky,
    profile,
    location,
  }: TCommitCreateDefaultShopParams): Promise<void> {
    // Listings published before the country field was checked may carry UK or a code that names no country:
    // the shop takes the ISO code of the first real country, or none.
    const namesCountry = (candidate: CommerceShopRecord['location'] | undefined) =>
      candidate !== undefined && isAssignedCountryCode(publishedCountryCode(candidate.countryCode));
    const source = namesCountry(location)
      ? location
      : (await LocalCommerceService.getListingsBySeller(ownerPubky))
          .map((row) => row.record.location)
          .find(namesCountry);
    const shipsFrom = source ? { ...source, countryCode: publishedCountryCode(source.countryCode) } : undefined;
    // Nothing says where this shop is, so it would fall back to the default country. A blocked default
    // must not be published for the seller: they choose a country in shop settings instead.
    if (!shipsFrom && getRegionPolicy().modeOf(DEFAULT_SHOP_COUNTRY_CODE) === 'blocked') return;
    const record = buildDefaultShopRecord({ ownerPubky, profile, location: shipsFrom, now: new Date() });
    await this.queueShopWrite(ownerPubky, async () => {
      if (await LocalCommerceService.getShop(ownerPubky)) return;
      // A failed default leaves no pending row, which would read as a settings save and block every retry.
      await this.writeShop(record, { discardOnFailure: true });
    });
  }

  static async commitUpsertShop(record: CommerceShopRecord): Promise<void> {
    await this.queueShopWrite(record.ownerPubky, () => this.writeShop(record));
  }

  /** Runs a seller's shop writes in this tab one at a time, in call order. */
  private static async queueShopWrite(ownerPubky: string, write: () => Promise<void>): Promise<void> {
    const previous = this.shopWrites.get(ownerPubky) ?? Promise.resolve();
    const current = previous.then(write);
    const tail = current.catch(() => undefined);
    this.shopWrites.set(ownerPubky, tail);
    try {
      await current;
    } finally {
      if (this.shopWrites.get(ownerPubky) === tail) this.shopWrites.delete(ownerPubky);
    }
  }

  private static async writeShop(
    record: CommerceShopRecord,
    { discardOnFailure = false }: { discardOnFailure?: boolean } = {},
  ): Promise<void> {
    const now = Date.now();
    const url = CommerceRecordNormalizer.shopUri(record.ownerPubky);
    const job = this.createSyncJob({
      ownerId: record.ownerPubky,
      entityType: 'shop',
      entityId: record.ownerPubky,
      operation: 'publish',
      payload: { url },
      now,
    });

    await LocalCommerceService.stageShopSync(record, job);
    try {
      await CommerceHomeserverService.putJson(url, { ...record });
    } catch (error) {
      // The write error is the one to surface; a failed discard reports itself at its origin.
      if (discardOnFailure) await LocalCommerceService.discardStagedShopSync(record, job.id).catch(() => undefined);
      throw error;
    }
    await LocalCommerceService.upsertShop(record, 'synced');
    await LocalCommerceService.completeSyncJob(job.id);
  }

  /**
   * Publishes a listing revision. While it runs, {@link ensureListingRegistered}
   * declines the same listing: a heal that settled the row between this
   * publish's staging and its write would advance the row's generation, and the
   * publish would then fail as "The listing changed" without ever writing.
   */
  static async commitUpsertListing(
    record: CommerceListingRecord,
    reservePrice?: CommerceMoney | null,
  ): Promise<{ registered: boolean; verified: boolean }> {
    const compositeListingId = `${record.ownerPubky}:${record.listingId}`;
    this.listingPublishesInFlight.set(
      compositeListingId,
      (this.listingPublishesInFlight.get(compositeListingId) ?? 0) + 1,
    );
    try {
      return await this.publishListing(record, reservePrice);
    } finally {
      const remaining = (this.listingPublishesInFlight.get(compositeListingId) ?? 1) - 1;
      if (remaining > 0) this.listingPublishesInFlight.set(compositeListingId, remaining);
      else this.listingPublishesInFlight.delete(compositeListingId);
    }
  }

  private static async publishListing(
    record: CommerceListingRecord,
    reservePrice?: CommerceMoney | null,
  ): Promise<{ registered: boolean; verified: boolean }> {
    // A pause without a session keeps the row's registration status; the next publish or heal with a
    // session registers it.
    const missingDurableSession =
      isDurableCommerceMode(getCommerceAdapterMode()) && !this.hasActiveMarketplaceSession();
    const pausingWithoutSession =
      missingDurableSession &&
      !listingPublishNeedsMarketplaceSession(
        (await LocalCommerceService.getListing(`${record.ownerPubky}:${record.listingId}`))?.record,
        record,
      );
    if (missingDurableSession && !pausingWithoutSession) {
      throw Err.auth(AuthErrorCode.SESSION_EXPIRED, 'Connect a marketplace session to publish a listing.', {
        service: ErrorService.Marketplace,
        operation: 'commitUpsertListing',
      });
    }
    // Before anything is staged locally, so a refused listing leaves no sync job behind.
    assertPublishableListingStock(record, 'commitUpsertListing');
    const now = Date.now();
    const url = CommerceRecordNormalizer.listingUri(record.ownerPubky, record.listingId);
    const publishJob = this.createSyncJob({
      ownerId: record.ownerPubky,
      entityType: 'listing',
      entityId: record.listingId,
      operation: 'publish',
      payload: { url },
      now,
    });

    const mode = getCommerceAdapterMode();
    const attempt = this.beginListingRegistration(record.ownerPubky, record.listingId);
    const registering = mode !== 'unavailable' && this.canCoordinateListingRegistration();
    const registrationStatus =
      mode === 'unavailable' ? 'unavailable' : pausingWithoutSession ? undefined : 'unregistered';
    this.assertListingRegistrationFence(attempt);
    attempt.observed = await LocalCommerceService.stageListingSync(record, publishJob, registrationStatus);
    if (registering && record.sale.format === 'auction' && isDurableCommerceMode(mode)) {
      // The command is chosen before the public write, so a reserve conflict leaves the homeserver untouched.
      await this.sweepOwnAuctionReserves(record.ownerPubky);
      await this.withListingRegistrationLock(attempt, 'publish', async () => {
        await this.assertRowHoldsPublish(attempt);
        attempt.signal = AbortSignal.timeout(LISTING_REGISTRATION_TIMEOUT_MS);
        const prepared = await this.prepareAuctionRegistration(record, attempt, reservePrice);
        if (prepared === 'superseded') throw this.listingChangedConflict();
      });
    }
    const verified = await this.putVerifiedPublicListing(record, url, attempt, async () => {
      await this.assertRowHoldsPublish(attempt);
    });
    this.assertListingRegistrationFence(attempt);
    const synced = await LocalCommerceService.markPublishedListingSynced(record, attempt.observed, !verified);
    if (synced === null) throw this.listingChangedConflict();
    attempt.observed = synced;

    // Registration is idempotent (skipped when the aggregate already has a server
    // revision), so retrying the whole commit after a failure here is safe.
    // Every transactional mode needs it: without registration the service has
    // no aggregate for the listing, so checkout/offers/bids dead-end. (This
    // was sandbox-only once — a relic that left durable-mode listings
    // unregistered and therefore un-buyable.)
    //
    // A registration failure must NOT unwind the publish that already
    // happened: the record is on the homeserver, and reporting the whole
    // commit as failed made sellers retry into duplicate listings. The
    // truths (published / verified / registered) are returned separately; an
    // unregistered listing self-heals through ensureListingRegistered /
    // listing.sync once a marketplace session exists.
    if (mode === 'unavailable' || pausingWithoutSession) {
      await LocalCommerceService.completeSyncJob(publishJob.id);
      return { registered: false, verified };
    }
    // Without Web Locks nothing registers; the listing stays `unregistered`.
    if (!registering) return { registered: false, verified };
    // The homeserver acked the write but is not serving it yet, so the publish
    // job is done. The row carries `read_back_pending_since`: within the
    // window no 404 settles it, and it stays `unregistered` for
    // ensureListingRegistered to heal.
    if (!verified) {
      await LocalCommerceService.completeSyncJob(publishJob.id);
      return { registered: false, verified };
    }
    return {
      registered: await this.runListingRegistration(record, attempt, 'publish', publishJob.id),
      verified,
    };
  }

  /**
   * Self-heal for listings published while registration failed or was skipped
   * (e.g. records created before durable-mode registration existed): registers
   * the listing when the service has no aggregate for it. Idempotent; callers
   * invoke it from owner-facing surfaces where a session is available. Gives
   * up without a request when another attempt holds the listing's lock or the
   * browser has no Web Locks.
   */
  static async ensureListingRegistered(record: CommerceListingRecord): Promise<boolean> {
    if (getCommerceAdapterMode() === 'unavailable' || !this.canCoordinateListingRegistration()) return false;
    // The publish registers the listing itself once its write is verified.
    if (this.listingPublishesInFlight.has(`${record.ownerPubky}:${record.listingId}`)) return false;
    const attempt = this.beginListingRegistration(record.ownerPubky, record.listingId);
    attempt.observed = await LocalCommerceService.getListingRowGeneration(attempt.compositeListingId);
    return await this.runListingRegistration(record, attempt, 'heal', null);
  }

  /** Whether this browser can register listings: registration needs Web Locks to have one owner per listing. */
  static canCoordinateListingRegistration(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';
  }

  private static beginListingRegistration(ownerPubky: string, listingId: string): ListingRegistrationAttempt {
    return {
      compositeListingId: `${ownerPubky}:${listingId}`,
      aggregateId: buildMarketplaceListingAggregateId(ownerPubky, listingId),
      ...this.listingSessionBinding(),
      observed: null,
    };
  }

  private static listingSessionBinding(): Pick<ListingRegistrationAttempt, 'authEpoch' | 'pubky' | 'sessionToken'> {
    return {
      authEpoch: readAuthEpoch(),
      pubky: useAuthStore.getState().currentUserPubky,
      sessionToken: MarketplaceSessionService.getActiveSession()?.token ?? null,
    };
  }

  private static listingRegistrationFenceHolds(attempt: ListingRegistrationAttempt): boolean {
    const now = this.listingSessionBinding();
    return (
      now.authEpoch === attempt.authEpoch && now.pubky === attempt.pubky && now.sessionToken === attempt.sessionToken
    );
  }

  private static listingChangedConflict() {
    return Err.client(ClientErrorCode.CONFLICT, 'The listing changed. Reload and try again.', {
      service: ErrorService.Marketplace,
      operation: 'commitUpsertListing',
    });
  }

  /**
   * A publish acts only while the local row is still exactly its own
   * generation: the `write_id` captured atomically at staging, advanced only
   * by the publish's own writes. A delete, or another tab's publish, even of
   * the same revision, since then wins.
   */
  private static async assertRowHoldsPublish(attempt: ListingRegistrationAttempt): Promise<void> {
    const stillOwn = await this.listingRowStillObserved(attempt);
    this.assertListingRegistrationFence(attempt);
    if (!stillOwn) throw this.listingChangedConflict();
  }

  /**
   * Runs one homeserver write of a listing as the listing's lock holder, so
   * it never overlaps that listing's registration, publish or delete. The
   * body makes a single attempt; callers back off outside the lock. Without
   * Web Locks nothing registers in this browser, and the write runs
   * unlocked.
   */
  private static async withListingWriteLock(
    attempt: ListingRegistrationAttempt,
    body: () => Promise<void>,
  ): Promise<void> {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    this.assertListingRegistrationFence(attempt);
    const run = async () => {
      this.assertListingRegistrationFence(attempt);
      await body();
    };
    if (typeof locks?.request !== 'function') {
      await run();
      return;
    }
    await locks.request(`${LISTING_REGISTRATION_LOCK_PREFIX}${attempt.aggregateId}`, run);
  }

  /** Checked after every await and before every request or write of an attempt. */
  private static assertListingRegistrationFence(attempt: ListingRegistrationAttempt): void {
    if (this.listingRegistrationFenceHolds(attempt)) return;
    throw Err.auth(AuthErrorCode.SESSION_EXPIRED, 'Signed out during listing registration.', {
      service: ErrorService.Marketplace,
      operation: 'registerListing',
      context: { reason: 'auth_epoch_changed' },
    });
  }

  /**
   * Runs `body` as the listing's single registration owner. `publish` waits
   * for the lock; `heal` returns null at once when another attempt holds it.
   * Also null without Web Locks. The body requests no other lock.
   */
  private static async withListingRegistrationLock<T>(
    attempt: ListingRegistrationAttempt,
    owner: ListingRegistrationOwner,
    body: () => Promise<T>,
  ): Promise<T | null> {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (typeof locks?.request !== 'function') return null;
    this.assertListingRegistrationFence(attempt);
    const name = `${LISTING_REGISTRATION_LOCK_PREFIX}${attempt.aggregateId}`;
    const run = async (): Promise<T> => {
      this.assertListingRegistrationFence(attempt);
      try {
        return await body();
      } finally {
        attempt.signal = undefined;
      }
    };
    if (owner === 'publish') return await locks.request(name, run);
    return await locks.request(name, { ifAvailable: true }, async (lock) => (lock ? await run() : null));
  }

  /**
   * One registration attempt. Outside the lock: the stock rule and the
   * homeserver precheck (a single read, or the read-back retry schedule for a
   * row whose acked write was never read back). Under the lock: the fence, the row
   * generation check, the service reads that shape the command, one timed
   * command request, and the compare-and-write settle. Nothing waits or
   * retries under the lock; a failed attempt stays pending for the next one.
   */
  private static async runListingRegistration(
    record: CommerceListingRecord,
    attempt: ListingRegistrationAttempt,
    owner: ListingRegistrationOwner,
    publishJobId: string | null,
  ): Promise<boolean> {
    const settle = async (outcome: Parameters<typeof LocalCommerceService.settleListingRegistration>[2]) => {
      this.assertListingRegistrationFence(attempt);
      await LocalCommerceService.settleListingRegistration(attempt.compositeListingId, attempt.observed, outcome);
    };
    const takeRow = async (): Promise<boolean> => {
      // Both owners act only on the exact generation they hold: for a publish, the row it staged and
      // marked synced. A delete or another tab's publish since then leaves nothing to register.
      const stillObserved = await this.listingRowStillObserved(attempt);
      this.assertListingRegistrationFence(attempt);
      return stillObserved;
    };
    // A heal of a listing the service already holds (re-syncing a stale projection) leaves its row as it
    // is: a failure must not offer registration again, and an unchanged success need not rewrite it.
    const healsRegisteredRow = async (): Promise<boolean> => {
      if (owner !== 'heal') return false;
      const { registrationStatus } = await LocalCommerceService.getListingRegistrationState(attempt.compositeListingId);
      this.assertListingRegistrationFence(attempt);
      return registrationStatus === 'registered';
    };
    try {
      assertPublishableListingStock(record, 'registerListing');
      if (isDurableCommerceMode(getCommerceAdapterMode())) {
        this.assertListingRegistrationFence(attempt);
        const published = await this.precheckPublishedListingRecord(record, attempt);
        this.assertListingRegistrationFence(attempt);
        if (!published) {
          await this.withListingRegistrationLock(attempt, owner, async () => {
            if (await takeRow()) await this.settleUnregistrableListing(attempt, 'record_deleted');
          });
          return false;
        }
      }
      const registered = await this.withListingRegistrationLock(attempt, owner, async () => {
        if (!(await takeRow())) return false;
        attempt.signal = AbortSignal.timeout(LISTING_REGISTRATION_TIMEOUT_MS);
        try {
          const outcome = await this.registerListing(record, attempt);
          this.assertListingRegistrationFence(attempt);
          if (outcome === 'superseded') return false;
          if (outcome !== 'registered') {
            await this.settleUnregistrableListing(attempt, outcome);
            return false;
          }
          if (!(await healsRegisteredRow())) await settle({ status: 'registered' });
          if (publishJobId) {
            this.assertListingRegistrationFence(attempt);
            await LocalCommerceService.completeSyncJob(publishJobId);
          }
          return true;
        } catch (error) {
          if (!this.listingRegistrationFenceHolds(attempt)) return false;
          if (!(await healsRegisteredRow())) await settle({ status: 'unregistered' });
          Logger.warn('Listing registration failed; it stays pending for the next attempt', { error });
          return false;
        }
      });
      return registered ?? false;
    } catch (error) {
      if (!this.listingRegistrationFenceHolds(attempt)) return false;
      // Best effort: a refused lock or a sign-out here leaves the row as it is, which is already pending.
      await this.withListingRegistrationLock(attempt, 'heal', async () => {
        if ((await this.listingRowStillObserved(attempt)) && !(await healsRegisteredRow())) {
          await settle({ status: 'unregistered' });
        }
      }).catch(() => null);
      Logger.warn('Listing registration failed before it reached the service; it stays pending', { error });
      return false;
    }
  }

  private static async listingRowStillObserved(attempt: ListingRegistrationAttempt): Promise<boolean> {
    const { generation } = await LocalCommerceService.getListingRegistrationState(attempt.compositeListingId);
    return generation !== null && attempt.observed !== null && generation.writeId === attempt.observed.writeId;
  }

  /**
   * Ends the pending registration of a listing the service cannot accept,
   * if the row is still the attempt's generation. A deleted record removes a
   * synced cache so no owner surface offers it again; a row with pending
   * publication state, or a `NOT_FOUND` refusal, is kept and taken out of
   * pending. The same compare-and-write clears the persisted auction command.
   */
  private static async settleUnregistrableListing(
    attempt: ListingRegistrationAttempt,
    outcome: 'record_deleted' | 'service_not_found',
  ): Promise<void> {
    if (outcome === 'service_not_found') {
      Logger.warn('Listing registration stopped: the service found no homeserver record');
    }
    this.assertListingRegistrationFence(attempt);
    await LocalCommerceService.settleListingRegistration(
      attempt.compositeListingId,
      attempt.observed,
      outcome === 'record_deleted' ? { recordDeleted: true } : { status: 'not_found' },
    );
  }

  /**
   * The registration precheck. A row still within its read-back window was
   * acked but never served back, so its 404 is retried on the read-back schedule; one
   * that outlasts it still answers false, and the settle keeps that row
   * pending rather than `not_found`.
   */
  private static async precheckPublishedListingRecord(
    record: CommerceListingRecord,
    attempt: ListingRegistrationAttempt,
  ): Promise<boolean> {
    const { readBackPending } = await LocalCommerceService.getListingRegistrationState(attempt.compositeListingId);
    for (let retry = 0; ; retry += 1) {
      if (await this.hasPublishedListingRecord(record)) return true;
      if (!readBackPending) return false;
      if (retry >= LISTING_READ_BACK_RETRY_DELAYS_MS.length) {
        Logger.warn('Listing record is still not served back after an acked write; registration stays pending', {
          listing: attempt.compositeListingId,
        });
        return false;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, LISTING_READ_BACK_RETRY_DELAYS_MS[retry]);
      });
      this.assertListingRegistrationFence(attempt);
    }
  }

  /**
   * Whether the seller's homeserver still holds the listing record. Only a
   * 404 answers false, without reporting it; any other failure throws, so the
   * caller stays pending.
   */
  private static async hasPublishedListingRecord(listing: CommerceListingRecord): Promise<boolean> {
    return (await this.fetchListingIfFound(listing.ownerPubky, listing.listingId)) !== null;
  }

  /**
   * Buyer-side heal (`listing.sync`, durable modes only): asks the
   * transaction service to fetch the canonical seller-signed record from the
   * seller's homeserver itself and register (or refresh) the aggregate from
   * it. Unlike {@link ensureListingRegistered}, the actor need NOT be the
   * seller — provenance comes from the service's homeserver fetch, not from
   * the session — so any signed-in user can heal a listing published before
   * durable-mode registration existed. Convergent: `expectedRevision` is
   * always 0 and a pre-existing aggregate is a no-op success.
   */
  // ---------------------------------------------------------------------
  // Drops (ADR 0026)
  // ---------------------------------------------------------------------

  /** Fetches the canonical seller-signed drop record from the homeserver. */
  static async fetchDrop(ownerPubky: string, dropId: string): Promise<CommerceDropRecord> {
    const url = CommerceRecordNormalizer.dropUri(ownerPubky, dropId);
    return CommerceRecordNormalizer.drop(await CommerceHomeserverService.fetchJson(url));
  }

  /**
   * Enumerates the drop ids published on an owner's homeserver by listing
   * the drops directory — the authoritative enumeration (works across
   * devices, unlike any local publish memo). Ids only; callers hydrate each
   * record/projection themselves and render read failures per row.
   */
  static async listOwnDropIds(ownerPubky: string): Promise<string[]> {
    const baseDirectory = `pubky://${ownerPubky}/pub/pubky.app/marketplace/v1/drops/`;
    const urls = await HomeserverService.listAll({ baseDirectory });
    return urls.map((url) => url.slice(baseDirectory.length)).filter((id) => id.length > 0 && !id.includes('/'));
  }

  /**
   * The transaction service's authoritative drop state (public projection,
   * stock redaction server-side, `serverTime` for countdown correction).
   * Null when unregistered or in sandbox mode — callers render absence.
   */
  static async getPublicDrop(sellerPubky: string, dropId: string) {
    return await MarketplaceGatewayService.getPublicDrop(sellerPubky, dropId);
  }

  /**
   * Public stock state of a listing, readable with no marketplace session.
   * Null in sandbox mode or when the listing is unknown or removed.
   */
  static async getPublicListingAvailability(sellerPubky: string, listingId: string) {
    return await MarketplaceGatewayService.getPublicListingAvailability(sellerPubky, listingId);
  }

  static async getSellerDrop(actorPubky: string, sellerPubky: string, dropId: string) {
    return await MarketplaceGatewayService.getDrop(actorPubky, buildMarketplaceDropAggregateId(sellerPubky, dropId));
  }

  static async getDropReadyCheck(actorPubky: string, sellerPubky: string, dropId: string) {
    return await MarketplaceGatewayService.getDropReadyCheck(
      actorPubky,
      buildMarketplaceDropAggregateId(sellerPubky, dropId),
    );
  }

  /**
   * Publishes the seller-signed drop record to the seller's own homeserver.
   * The record is validated through the vendored specs builder before the
   * PUT (the same guarantee every published marketplace record gets); the
   * caller follows up with {@link syncDropRegistration} so the transaction
   * service registers the enforced schedule — the studio renders the two
   * truths (record published / service registered) separately.
   */
  static async commitPublishDrop(record: CommerceDropRecord): Promise<void> {
    const { PubkySpecsBuilder } = await import('pubky-app-specs');
    const built = new PubkySpecsBuilder(record.ownerPubky).createMarketplaceDrop({ ...record });
    const validated = CommerceRecordNormalizer.drop(built.marketplace_drop.toJson());
    const url = CommerceRecordNormalizer.dropUri(validated.ownerPubky, validated.dropId);
    await CommerceHomeserverService.putJson(url, { ...validated });
  }

  /**
   * Convergent drop registration from the seller-signed homeserver record —
   * `listing.sync`'s doctrine applied to drops. Any authenticated actor.
   */
  static async syncDropRegistration(
    actorPubky: string,
    sellerPubky: string,
    dropId: string,
  ): Promise<MarketplaceCommandResponse> {
    if (!isDurableCommerceMode(getCommerceAdapterMode())) {
      throw Err.client(ClientErrorCode.BAD_REQUEST, 'Drops require the durable transaction service.', {
        service: ErrorService.Marketplace,
        operation: 'syncDropRegistration',
      });
    }
    const command = CommerceRecordNormalizer.marketplaceCommand({
      version: 1,
      commandId: crypto.randomUUID(),
      aggregateId: buildMarketplaceDropAggregateId(sellerPubky, dropId),
      expectedRevision: 0,
      issuedAt: new Date().toISOString(),
      kind: 'drop.sync',
      payload: { sellerPubky, dropId },
    });
    return await MarketplaceGatewayService.execute(actorPubky, command);
  }

  /**
   * Seller-only drop lifecycle commands, both CAS-guarded with the freshly
   * read revision: `drop.cancel` (kill switch, announced/live) and
   * `drop.release_listings` (return an ENDED drop's listings to open sale).
   */
  static async cancelDrop(
    actorPubky: string,
    dropId: string,
    expectedRevision: number,
  ): Promise<MarketplaceCommandResponse> {
    return await this.executeDropLifecycleCommand(actorPubky, dropId, expectedRevision, 'drop.cancel');
  }

  static async releaseDropListings(
    actorPubky: string,
    dropId: string,
    expectedRevision: number,
  ): Promise<MarketplaceCommandResponse> {
    return await this.executeDropLifecycleCommand(actorPubky, dropId, expectedRevision, 'drop.release_listings');
  }

  private static async executeDropLifecycleCommand(
    actorPubky: string,
    dropId: string,
    expectedRevision: number,
    kind: 'drop.cancel' | 'drop.release_listings',
  ): Promise<MarketplaceCommandResponse> {
    if (!isDurableCommerceMode(getCommerceAdapterMode())) {
      throw Err.client(ClientErrorCode.BAD_REQUEST, 'Drops require the durable transaction service.', {
        service: ErrorService.Marketplace,
        operation: kind,
      });
    }
    const command = CommerceRecordNormalizer.marketplaceCommand({
      version: 1,
      commandId: crypto.randomUUID(),
      aggregateId: buildMarketplaceDropAggregateId(actorPubky, dropId),
      expectedRevision,
      issuedAt: new Date().toISOString(),
      kind,
      payload: {},
    });
    return await MarketplaceGatewayService.execute(actorPubky, command);
  }

  static async syncListingRegistration(
    actorPubky: string,
    sellerPubky: string,
    listingId: string,
  ): Promise<MarketplaceCommandResponse> {
    if (!isDurableCommerceMode(getCommerceAdapterMode())) {
      throw Err.client(ClientErrorCode.BAD_REQUEST, 'Listing sync requires the durable transaction service.', {
        service: ErrorService.Marketplace,
        operation: 'syncListingRegistration',
      });
    }
    const command = CommerceRecordNormalizer.marketplaceCommand({
      version: 1,
      commandId: crypto.randomUUID(),
      aggregateId: buildMarketplaceListingAggregateId(sellerPubky, listingId),
      expectedRevision: 0,
      issuedAt: new Date().toISOString(),
      kind: 'listing.sync',
      payload: { sellerPubky, listingId },
    });
    return await MarketplaceGatewayService.execute(actorPubky, command);
  }

  /**
   * Deletes a listing the current user owns: removes the owner-signed record
   * from the homeserver (the canonical copy indexers read), then clears every
   * local cache of it. Media files are deleted afterwards as best-effort
   * cleanup — a media file that outlives its record is unreferenced bytes,
   * not a live listing, so media failures never block the deletion.
   */
  /**
   * A listing is a homeserver record the service can only follow, so the check that keeps an auction
   * with bids from being deleted out from under its bidders has to run here, before the DELETE. The
   * service's bid count is the authority; where it can't be read the delete waits, because an auction
   * that has not ended may have bids this device does not know of. Nothing is asked for a listing that
   * is not an auction, an auction that has ended, or a deployment without a transaction service.
   */
  private static async assertNoLiveAuctionBids(
    ownerPubky: string,
    listingId: string,
    local: CommerceListingModelSchema | null | undefined,
  ): Promise<void> {
    if (!local || local.record.sale.format !== 'auction') return;
    if (!isDurableCommerceMode(getCommerceAdapterMode())) return;
    if (isAuctionSaleEnded(local.record.sale, Date.now())) return;
    const projection = await MarketplaceGatewayService.getListing(
      ownerPubky,
      buildMarketplaceListingAggregateId(ownerPubky, listingId),
    );
    const bids = bidsBlockingDelete(projection?.auction, false);
    if (bids === 0) return;
    throw Err.client(ClientErrorCode.CONFLICT, AUCTION_HAS_BIDS_MESSAGE, {
      service: ErrorService.Marketplace,
      operation: 'commitDeleteListing',
      context: { refusal: AUCTION_HAS_BIDS_REFUSAL, bidCount: bids },
    });
  }

  static async commitDeleteListing(ownerPubky: string, listingId: string): Promise<void> {
    const compositeListingId = `${ownerPubky}:${listingId}`;
    const local = await LocalCommerceService.getListing(compositeListingId);
    const url = CommerceRecordNormalizer.listingUri(ownerPubky, listingId);
    const job = this.createSyncJob({
      ownerId: ownerPubky,
      entityType: 'listing',
      entityId: listingId,
      operation: 'remove',
      payload: { url },
      now: Date.now(),
    });

    await this.assertNoLiveAuctionBids(ownerPubky, listingId, local);

    const attempt = this.beginListingRegistration(ownerPubky, listingId);
    this.assertListingRegistrationFence(attempt);
    await LocalCommerceService.upsertSyncJob(job);
    // One DELETE per hold of the listing lock, the local rows removed in the same hold, so a queued
    // registration or publish finds no row; a retryable failure backs off outside the lock.
    await retryHomeserverWrite(HttpMethod.DELETE, () =>
      this.withListingWriteLock(attempt, async () => {
        await CommerceHomeserverService.delete(url, undefined, { singleAttempt: true });
        this.assertListingRegistrationFence(attempt);
        await LocalCommerceService.deleteListing(compositeListingId);
      }),
    );
    this.assertListingRegistrationFence(attempt);
    await LocalCommerceService.completeSyncJob(job.id);

    if (local) {
      const mediaResults = await Promise.allSettled(
        local.record.media.map((media) => CommerceHomeserverService.delete(media.url)),
      );
      mediaResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          Logger.warn('Failed to delete an orphaned listing media file', {
            mediaUrl: local.record.media[index].url,
            error: result.reason,
          });
        }
      });
    }
  }

  static async commitCreateMedia(ownerPubky: string, mediaId: string, bytes: Uint8Array): Promise<string> {
    const url = CommerceRecordNormalizer.mediaUri(ownerPubky, mediaId);
    await CommerceHomeserverService.putMedia(url, bytes);
    return url;
  }

  /** GET→merge→PUT for Inventory Studio import. Does not go through commitUpsertListing. */
  static async putPublicListingForImport(record: CommerceListingRecord): Promise<void> {
    const url = CommerceRecordNormalizer.listingUri(record.ownerPubky, record.listingId);
    await this.putVerifiedPublicListing(
      record,
      url,
      this.beginListingRegistration(record.ownerPubky, record.listingId),
    );
  }

  static async getMarketplaceMediaOwnerHomeserver(ownerPubky: string): Promise<string | null> {
    return await MarketplaceMediaService.getOwnerHomeserver(ownerPubky);
  }

  static async fetchMarketplaceMedia(uri: string): Promise<Blob> {
    return await MarketplaceMediaService.fetchMedia(uri);
  }

  /**
   * The only write of a public listing record: every Shop publisher, Inventory
   * Studio included, reaches it.
   *
   * The PUT runs as the listing's lock holder, one attempt per hold, after
   * `guard` (the publish's row check) passes under the same hold; a
   * retryable failure backs off outside the lock. Reads before and after
   * stay outside it.
   *
   * Returns true when the homeserver served the written record back and it
   * matched the candidate. Returns false when the write was acked but the
   * homeserver has not made the record readable yet — reads lag just-acked
   * writes (production 2026-09-30: a publish read back 410ms after the record
   * was created still got a 404, and the same record served fine about a
   * second later). A lag is reported as `false`, never thrown: a published
   * listing must not read as a failed publish, or the seller re-posts it as a
   * duplicate. Proven divergence — the homeserver serving something other than
   * what was written — still throws.
   *
   * A PUT the homeserver refuses with its publish conflict starts over from
   * the read: the record changed after it was checked.
   */
  private static async putVerifiedPublicListing(
    record: CommerceListingRecord,
    url: string,
    attempt: ListingRegistrationAttempt,
    guard?: () => Promise<void>,
  ): Promise<boolean> {
    return await retryHomeserverWriteAfterReread(() => this.putVerifiedPublicListingOnce(record, url, attempt, guard));
  }

  private static async putVerifiedPublicListingOnce(
    record: CommerceListingRecord,
    url: string,
    attempt: ListingRegistrationAttempt,
    guard?: () => Promise<void>,
  ): Promise<boolean> {
    assertPublishableListingStock(record, 'putVerifiedPublicListing');
    let current: Record<string, unknown> = {};
    let exists = false;
    const published = await CommerceHomeserverService.fetchJsonIfFound(url);
    if (published.found) {
      if (!isPlainRecord(published.json)) {
        throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'The published listing is not a JSON object.', {
          service: ErrorService.Homeserver,
          operation: 'putVerifiedPublicListing',
        });
      }
      current = published.json;
      exists = true;
    } else if (record.revision !== 1) {
      // Only a first publish may find nothing: an edit whose base record is gone is a real failure.
      throw Err.client(ClientErrorCode.NOT_FOUND, 'The published listing is missing. Reload and try again.', {
        service: ErrorService.Homeserver,
        operation: 'putVerifiedPublicListing',
        context: { statusCode: HttpStatusCode.NOT_FOUND },
      });
    }

    const scrubbed = stripForbiddenPublicReserveKeys(current);
    const candidate = mergeOpenWorldRecords(isPlainRecord(scrubbed) ? scrubbed : {}, record);
    assertReserveFreePublicRecord(candidate);
    if (exists) {
      if (current.ownerPubky !== record.ownerPubky || current.listingId !== record.listingId) {
        throw Err.client(ClientErrorCode.CONFLICT, 'The published listing identity changed. Reload and try again.', {
          service: ErrorService.Homeserver,
          operation: 'putVerifiedPublicListing',
        });
      }
      const currentRevision = current.revision;
      const expectedBaseRevision = record.revision - 1;
      if (currentRevision === record.revision) {
        if (canonicalJson(scrubbed) !== canonicalJson(candidate)) {
          throw Err.client(ClientErrorCode.CONFLICT, 'The published listing changed. Reload and try again.', {
            service: ErrorService.Homeserver,
            operation: 'putVerifiedPublicListing',
          });
        }
      } else if (currentRevision !== expectedBaseRevision) {
        throw Err.client(ClientErrorCode.CONFLICT, 'The published listing changed. Reload and try again.', {
          service: ErrorService.Homeserver,
          operation: 'putVerifiedPublicListing',
        });
      }
    }

    const requiresPut =
      !exists || current.revision !== record.revision || findForbiddenPublicReserveKey(current) !== null;
    if (requiresPut) {
      if (exists) {
        const latest = await CommerceHomeserverService.fetchJson(url);
        if (canonicalJson(latest) !== canonicalJson(current)) {
          throw Err.client(ClientErrorCode.CONFLICT, 'The published listing changed. Reload and try again.', {
            service: ErrorService.Homeserver,
            operation: 'putVerifiedPublicListing',
          });
        }
      } else if ((await CommerceHomeserverService.fetchJsonIfFound(url)).found) {
        throw Err.client(ClientErrorCode.CONFLICT, 'The published listing changed. Reload and try again.', {
          service: ErrorService.Homeserver,
          operation: 'putVerifiedPublicListing',
        });
      }
      await retryHomeserverWrite(
        HttpMethod.PUT,
        () =>
          this.withListingWriteLock(attempt, async () => {
            await guard?.();
            await CommerceHomeserverService.putJson(url, candidate, { singleAttempt: true });
          }),
        { retryPublishConflict: false },
      );
    }

    let verified: unknown;
    if (requiresPut) {
      const readBack = await this.readBackAckedWrite(url, record);
      if (readBack === undefined) {
        Logger.warn('Listing write was acked but the homeserver has not served the record back yet', {
          listing: `${record.ownerPubky}:${record.listingId}`,
        });
        return false;
      }
      verified = readBack.record;
    } else {
      verified = current;
    }
    assertReserveFreePublicRecord(verified);
    if (
      !isPlainRecord(verified) ||
      verified.ownerPubky !== record.ownerPubky ||
      verified.listingId !== record.listingId ||
      verified.revision !== record.revision
    ) {
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'The published listing could not be verified.', {
        service: ErrorService.Homeserver,
        operation: 'putVerifiedPublicListing',
      });
    }
    if (canonicalJson(verified) !== canonicalJson(candidate)) {
      throw Err.server(
        ServerErrorCode.INVALID_RESPONSE,
        'The published listing did not match the verified candidate.',
        {
          service: ErrorService.Homeserver,
          operation: 'putVerifiedPublicListing',
        },
      );
    }
    return true;
  }

  /**
   * Reads back an acked listing write until the homeserver serves the written
   * revision, or reports that it cannot confirm the write.
   *
   * Reads can lag a just-acked write by a moment, so the two lag signatures —
   * the record is not readable yet, or the previous revision is still being
   * served — are retried (250ms, 500ms, 1s) before they are believed.
   * Returning `undefined` means "acked but unconfirmed": a truth to report,
   * not a failure to raise. Everything else — a readable record at the written
   * revision, a concurrent writer's newer revision, an auth or transport
   * error — is returned or thrown for the caller's normal checks.
   */
  private static async readBackAckedWrite(
    url: string,
    record: CommerceListingRecord,
  ): Promise<{ record: unknown } | undefined> {
    for (let attempt = 0; ; attempt += 1) {
      const lastAttempt = attempt >= LISTING_READ_BACK_RETRY_DELAYS_MS.length;
      const read = await CommerceHomeserverService.fetchJsonIfFound(url);
      if (read.found) {
        const staleLag = isPlainRecord(read.json) && read.json.revision === record.revision - 1;
        if (!staleLag || lastAttempt) return staleLag ? undefined : { record: read.json };
      } else if (lastAttempt) {
        return undefined;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, LISTING_READ_BACK_RETRY_DELAYS_MS[attempt]);
      });
    }
  }

  /**
   * Deletes the signed-in seller's own leftover `auction_reserves/` files.
   * Listing is enough to find them; the file body is not read. A list or
   * delete failure does not throw.
   */
  static async sweepOwnAuctionReserves(ownerPubky: string): Promise<number> {
    if (useAuthStore.getState().currentUserPubky !== ownerPubky) return 0;
    if (!HomeserverService.canCurrentSessionWrite(PRIVATE_APP_DATA_PATH)) return 0;
    const directory = CommerceRecordNormalizer.auctionReserveDirectoryUri(ownerPubky);
    let entries: string[] = [];
    try {
      entries = await HomeserverService.listAll({ baseDirectory: directory });
    } catch (error) {
      Logger.warn('Auction reserve sweep could not list the owner directory', { error });
      return 0;
    }
    let deleted = 0;
    for (const entry of entries) {
      const url = ownAuctionReserveFileUrl(directory, entry);
      if (!url) continue;
      try {
        await CommerceHomeserverService.delete(url);
        deleted += 1;
      } catch (error) {
        if (isAppError(error) && isNotFound(error)) continue;
        Logger.warn('Auction reserve sweep could not delete an owner file', { error });
      }
    }
    return deleted;
  }

  /**
   * Chooses the auction's `listing.register` command under the listing's
   * lock: the command persisted on the row is replayed while it still
   * matches this revision and the service's reserve record; otherwise a new
   * one is stored on the row (compare-and-write) before it is sent, so a
   * reload or another tab replays the same command id.
   */
  private static async prepareAuctionRegistration(
    listing: CommerceListingRecord,
    attempt: ListingRegistrationAttempt,
    reservePrice?: CommerceMoney | null,
  ): Promise<MarketplaceCommand | 'superseded'> {
    if (listing.sale.format !== 'auction') {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'Auction reserve requires an auction listing.', {
        service: ErrorService.Marketplace,
        operation: 'prepareAuctionRegistration',
      });
    }
    this.assertListingRegistrationFence(attempt);
    const projection = await MarketplaceGatewayService.getSellerListing(listing.ownerPubky, attempt.aggregateId, {
      signal: attempt.signal,
    });
    this.assertListingRegistrationFence(attempt);
    const serviceRecordRevision = projection?.reserveRecordRevision ?? 0;
    const state = await LocalCommerceService.getListingRegistrationState(attempt.compositeListingId);
    this.assertListingRegistrationFence(attempt);
    if (state.generation === null || state.generation.writeId !== attempt.observed?.writeId) return 'superseded';
    const pending = state.auctionRegistration;
    const reusingPending =
      pending !== null &&
      pending.listing_revision === listing.revision &&
      pending.record_revision === serviceRecordRevision + 1;
    const replayingAcknowledged =
      pending !== null &&
      projection !== null &&
      pending.listing_revision === listing.revision &&
      pending.record_revision === serviceRecordRevision &&
      projection.lastReserveCommandId === pending.command_id;
    if ((reusingPending || replayingAcknowledged) && pending) {
      if (reservePrice !== undefined && canonicalJson(reservePrice) !== canonicalJson(pending.reserve_price)) {
        throw Err.client(
          ClientErrorCode.CONFLICT,
          'The pending reserve differs from this edit. Reload and try again.',
          {
            service: ErrorService.Marketplace,
            operation: 'prepareAuctionRegistration',
          },
        );
      }
      return this.auctionRegisterCommand(listing, pending);
    }

    const chosenReserve = reservePrice !== undefined ? reservePrice : (projection?.reservePrice ?? null);
    const command: CommerceAuctionRegistrationCommand = {
      command_id: crypto.randomUUID(),
      issued_at: new Date().toISOString(),
      listing_revision: listing.revision,
      reserve_price: chosenReserve,
      expected_service_revision: projection?.serverRevision ?? 0,
      expected_record_revision: serviceRecordRevision,
      record_revision: serviceRecordRevision + 1,
    };
    this.assertListingRegistrationFence(attempt);
    const stored = await LocalCommerceService.persistAuctionRegistration(
      attempt.compositeListingId,
      attempt.observed,
      command,
    );
    this.assertListingRegistrationFence(attempt);
    if (stored === null) return 'superseded';
    attempt.observed = stored;
    return this.auctionRegisterCommand(listing, command);
  }

  private static auctionRegisterCommand(
    listing: CommerceListingRecord,
    pending: CommerceAuctionRegistrationCommand,
  ): MarketplaceCommand {
    const unitPrice = listing.sale.format === 'auction' ? listing.sale.startingPrice : listing.sale.unitPrice;
    const command = CommerceRecordNormalizer.marketplaceCommand({
      version: 1,
      commandId: pending.command_id,
      aggregateId: buildMarketplaceListingAggregateId(listing.ownerPubky, listing.listingId),
      expectedRevision: pending.expected_service_revision,
      issuedAt: pending.issued_at,
      kind: 'listing.register',
      payload: {
        sellerPubky: listing.ownerPubky,
        listingId: listing.listingId,
        title: listing.title,
        listingRevision: listing.revision,
        contentHash: listing.media[0].contentHash,
        quantity: listing.variants.reduce((total, variant) => total + variant.quantity, 0),
        ...registerVariantsField(listing),
        unitPrice,
        shippingMinor: commerceListingShippingMinor(listing.shippingOptions),
        saleFormat: 'auction',
        fulfillmentMethods: commerceListingFulfillmentMethods(listing.fulfillmentMethods),
        auctionTerms:
          listing.sale.format === 'auction'
            ? {
                startsAt: listing.sale.startsAt,
                endsAt: listing.sale.endsAt,
                minimumIncrement: listing.sale.minimumIncrement,
                antiSnipingWindowSeconds: listing.sale.antiSnipingWindowSeconds,
                antiSnipingExtensionSeconds: listing.sale.antiSnipingExtensionSeconds,
              }
            : undefined,
        auctionReserve: {
          expectedRecordRevision: pending.expected_record_revision,
          recordRevision: pending.record_revision,
          reservePrice: pending.reserve_price,
        },
      },
    });
    return command;
  }

  /**
   * The service half of one attempt, run under the listing's lock after the
   * homeserver precheck found the record: a service 404 for a deleted
   * listing is never answered with `listing.register` blind. Every service
   * request carries the attempt's deadline, and the fence is checked after
   * each one.
   */
  private static async registerListing(
    listing: CommerceListingRecord,
    attempt: ListingRegistrationAttempt,
  ): Promise<ListingRegistrationOutcome> {
    const aggregateId = attempt.aggregateId;
    const durable = isDurableCommerceMode(getCommerceAdapterMode());
    const send = async (command: MarketplaceCommand) => {
      this.assertListingRegistrationFence(attempt);
      const response = await MarketplaceGatewayService.execute(listing.ownerPubky, command, { signal: attempt.signal });
      this.assertListingRegistrationFence(attempt);
      return response;
    };
    if (listing.sale.format === 'auction' && durable) {
      const command = await this.prepareAuctionRegistration(listing, attempt);
      if (command === 'superseded') return 'superseded';
      const response = await send(command);
      if (isListingRecordNotFoundResponse(response, aggregateId, command.commandId)) return 'service_not_found';
      if (!isSuccessfulListingRegistrationResponse(response, aggregateId, command.commandId)) {
        throw listingRegistrationRefusal(response);
      }
      return 'registered';
    }
    this.assertListingRegistrationFence(attempt);
    const existing = await MarketplaceGatewayService.getListing(listing.ownerPubky, aggregateId, {
      signal: attempt.signal,
    });
    this.assertListingRegistrationFence(attempt);
    // `listing.register` carries no Locks lock, so a Locks listing registered with it would sell as a
    // digital item without its lock. `listing.sync` derives the lock from the seller-signed record.
    const locksListing = durable && listing.digitalLock !== undefined;
    if (existing?.serverRevision || locksListing) {
      // Already registered: EDITS must still reach the authority. `listing.sync`
      // is convergent — the service re-reads the seller-signed record and
      // updates the aggregate's terms when the record revision advanced, or
      // no-ops when nothing changed. Skipping here (the old behavior) left
      // the service charging a stale price after every edit. The sandbox has
      // no homeserver to sync from, so it keeps the skip.
      if (durable) {
        const command = this.createListingSyncCommand(listing.ownerPubky, listing.listingId);
        const response = await send(command);
        if (isListingRecordNotFoundResponse(response, aggregateId, command.commandId)) return 'service_not_found';
        if (
          !isSuccessfulListingRegistrationResponse(
            response,
            aggregateId,
            command.commandId,
            Boolean(existing?.serverRevision),
          )
        ) {
          throw listingRegistrationRefusal(response);
        }
      }
      return 'registered';
    }
    const unitPrice = listing.sale.format === 'fixed_price' ? listing.sale.unitPrice : listing.sale.startingPrice;
    const command = CommerceRecordNormalizer.marketplaceCommand({
      version: 1,
      commandId: crypto.randomUUID(),
      aggregateId,
      expectedRevision: 0,
      issuedAt: new Date().toISOString(),
      kind: 'listing.register',
      payload: {
        sellerPubky: listing.ownerPubky,
        listingId: listing.listingId,
        title: listing.title,
        listingRevision: listing.revision,
        contentHash: listing.media[0].contentHash,
        quantity: listing.variants.reduce((total, variant) => total + variant.quantity, 0),
        ...registerVariantsField(listing),
        unitPrice,
        shippingMinor: commerceListingShippingMinor(listing.shippingOptions),
        saleFormat: listing.sale.format,
        // The service-facing fulfillment methods (§A1), derived from the
        // record exactly as the service's own homeserver derivation would.
        fulfillmentMethods: commerceListingFulfillmentMethods(listing.fulfillmentMethods),
        auctionTerms:
          listing.sale.format === 'auction'
            ? {
                startsAt: listing.sale.startsAt,
                endsAt: listing.sale.endsAt,
                minimumIncrement: listing.sale.minimumIncrement,
                antiSnipingWindowSeconds: listing.sale.antiSnipingWindowSeconds,
                antiSnipingExtensionSeconds: listing.sale.antiSnipingExtensionSeconds,
              }
            : undefined,
        auctionReserve:
          listing.sale.format === 'auction'
            ? {
                expectedRecordRevision: 0,
                recordRevision: 1,
                reservePrice: null,
              }
            : undefined,
      },
    });
    const response = await send(command);
    if (isListingRecordNotFoundResponse(response, aggregateId, command.commandId)) return 'service_not_found';
    if (!isSuccessfulListingRegistrationResponse(response, aggregateId, command.commandId)) {
      if (!isCorrelatedBenignListingRegistrationResponse(response, aggregateId, command.commandId)) {
        throw listingRegistrationRefusal(response);
      }
      const confirmed = await MarketplaceGatewayService.getListing(listing.ownerPubky, aggregateId, {
        signal: attempt.signal,
      });
      this.assertListingRegistrationFence(attempt);
      if (
        !isSuccessfulListingRegistrationResponse(
          response,
          aggregateId,
          command.commandId,
          Boolean(confirmed?.serverRevision),
        )
      ) {
        throw listingRegistrationRefusal(response);
      }
    }
    return 'registered';
  }

  private static createSyncJob({
    ownerId,
    entityType,
    entityId,
    operation,
    payload,
    now,
  }: {
    ownerId: string;
    entityType: CommerceSyncJobModelSchema['entity_type'];
    entityId: string;
    operation: CommerceSyncJobModelSchema['operation'];
    payload: CommerceSyncJobModelSchema['payload'];
    now: number;
  }): CommerceSyncJobModelSchema {
    return {
      id: crypto.randomUUID(),
      owner_id: ownerId,
      entity_type: entityType,
      entity_id: entityId,
      operation,
      status: 'pending',
      attempts: 0,
      next_attempt_at: now,
      last_error_code: null,
      payload,
      created_at: now,
      updated_at: now,
    };
  }

  private static createListingSyncCommand(sellerPubky: string, listingId: string) {
    return CommerceRecordNormalizer.marketplaceCommand({
      version: 1,
      commandId: crypto.randomUUID(),
      aggregateId: buildMarketplaceListingAggregateId(sellerPubky, listingId),
      expectedRevision: 0,
      issuedAt: new Date().toISOString(),
      kind: 'listing.sync',
      payload: { sellerPubky, listingId },
    });
  }
}

function listingRegistrationRefusal(response: MarketplaceCommandResponse) {
  const variantCopy = response.ok ? null : variantRefusalMessage(response.error);
  return Err.client(ClientErrorCode.BAD_REQUEST, variantCopy ?? 'Market listing registration was refused.', {
    service: ErrorService.Marketplace,
    operation: 'registerListing',
  });
}

function registerVariantsField(listing: CommerceListingRecord): { variants?: RegisterListingVariant[] } {
  const variants = buildRegisterVariants(listing.variants);
  return variants ? { variants } : {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeOpenWorldRecords(
  existing: Record<string, unknown>,
  managed: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(managed)) {
    const prior = merged[key];
    if (isPlainRecord(prior) && isPlainRecord(value)) {
      merged[key] = mergeOpenWorldRecords(prior, value);
    } else if (Array.isArray(prior) && Array.isArray(value)) {
      merged[key] = mergeOpenWorldRecordArray(prior, value);
    } else {
      merged[key] = structuredClone(value);
    }
  }
  return merged;
}

function mergeOpenWorldRecordArray(existing: unknown[], managed: unknown[]): unknown[] {
  const hasStableIds = managed.every((value) => isPlainRecord(value) && typeof value.id === 'string');
  if (!hasStableIds) return structuredClone(managed);

  const existingById = new Map(
    existing
      .filter((value): value is Record<string, unknown> => isPlainRecord(value) && typeof value.id === 'string')
      .map((value) => [value.id as string, value]),
  );
  return managed.map((value) => {
    const managedRecord = value as Record<string, unknown>;
    const prior = existingById.get(managedRecord.id as string);
    return prior ? mergeOpenWorldRecords(prior, managedRecord) : structuredClone(managedRecord);
  });
}

function ownAuctionReserveFileUrl(directory: string, entry: string): string | null {
  const name = entry.startsWith(directory) ? entry.slice(directory.length) : entry;
  if (
    name.length === 0 ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..') ||
    !name.endsWith('.json')
  ) {
    return null;
  }
  if (entry.includes('://') && !entry.startsWith(directory)) return null;
  return entry.startsWith(directory) ? entry : `${directory}${name}`;
}

/**
 * Matches what `JSON.stringify` writes: an object key whose value is
 * `undefined` is omitted (the homeserver never sees it), while an
 * `undefined` array element is `null`.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
