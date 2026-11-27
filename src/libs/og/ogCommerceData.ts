import { Client, resolvePubky } from '@synonymdev/pubky';
import {
  type CommerceListingRecord,
  commerceListingRecordSchema,
  type CommerceShopRecord,
  commerceShopRecordSchema,
  marketplacePublicUriSchema,
} from '@/libs/commerce/marketplace-records';
import { commerceEntityIdSchema, commercePubkySchema } from '@/libs/commerce/transaction-contracts';
import { Logger } from '@/libs/logger/logger';
import { getPkarrRelays } from '@/libs/runtime-config/runtime-config';
import { fetchImageAsDataUri } from './ogData';

/**
 * Server-only fetchers for canonical marketplace records, used by
 * `generateMetadata` and the `opengraph-image` routes. Same constraints as
 * `ogData.ts`: no client/Dexie imports — only the pure record schemas and the
 * runtime config.
 *
 * Records are read from each seller's homeserver through the configured PKARR
 * relays, using the same `pubky://` resolution path as client reads. Both path
 * segments are validated against the commerce schemas before any URL is built,
 * so route params can never steer the server-side fetch outside the marketplace
 * namespace.
 */

/**
 * Revalidation window (seconds) for marketplace record/media fetches feeding
 * metadata and OG images. Shorter than the social OG_REVALIDATE hour because
 * listings change state (paused/ended/price) and stale previews would misstate
 * purchasability; still long enough that crawler bursts and SSR catalog hits
 * stay cached instead of hammering seller homeservers.
 */
export const OG_COMMERCE_REVALIDATE = 300;
export const OG_COMMERCE_CACHE_TTL_MS = OG_COMMERCE_REVALIDATE * 1_000;
export const OG_COMMERCE_NOT_FOUND_TTL_MS = 60_000;
export const OG_COMMERCE_CACHE_MAX_ENTRIES = 500;
export const OG_COMMERCE_CACHE_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
export const OG_RECORD_MAX_BYTES = 256 * 1024;
export const OG_MEDIA_CACHE_MAX_ENTRIES = 50;
export const OG_MEDIA_CACHE_MAX_ENTRY_BYTES = 1024 * 1024;
export const OG_MEDIA_CACHE_MAX_TOTAL_BYTES = 16 * 1024 * 1024;

export interface BoundedTtlCacheOptions {
  maxEntries: number;
  maxTotalBytes: number;
  maxEntryBytes?: number;
}

export class BoundedTtlCache<V> {
  private readonly entries = new Map<string, { value: V; bytes: number; expiresAt: number }>();
  private totalBytes = 0;
  private readonly maxEntries: number;
  private readonly maxTotalBytes: number;
  private readonly maxEntryBytes: number;

  constructor({ maxEntries, maxTotalBytes, maxEntryBytes = maxTotalBytes }: BoundedTtlCacheOptions) {
    this.maxEntries = maxEntries;
    this.maxTotalBytes = maxTotalBytes;
    this.maxEntryBytes = Math.min(maxEntryBytes, maxTotalBytes);
  }

  get(key: string, now = Date.now()): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      this.totalBytes = Math.max(0, this.totalBytes - entry.bytes);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number, bytes: number, now = Date.now()): boolean {
    const entryBytes = Math.max(1, bytes);
    if (entryBytes > this.maxEntryBytes) return false;
    const previous = this.entries.get(key);
    if (previous) {
      this.entries.delete(key);
      this.totalBytes = Math.max(0, this.totalBytes - previous.bytes);
    }
    while (
      this.entries.size > 0 &&
      (this.entries.size >= this.maxEntries || this.totalBytes + entryBytes > this.maxTotalBytes)
    ) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (oldest) this.totalBytes = Math.max(0, this.totalBytes - oldest.bytes);
    }
    if (this.entries.size >= this.maxEntries || this.totalBytes + entryBytes > this.maxTotalBytes) {
      return false;
    }
    this.entries.set(key, { value, bytes: entryBytes, expiresAt: now + ttlMs });
    this.totalBytes += entryBytes;
    return true;
  }

  get byteSize(): number {
    return this.totalBytes;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }
}

const listingCache = new BoundedTtlCache<MetadataFetchResult<CommerceListingRecord>>({
  maxEntries: OG_COMMERCE_CACHE_MAX_ENTRIES,
  maxTotalBytes: OG_COMMERCE_CACHE_MAX_TOTAL_BYTES,
  maxEntryBytes: OG_RECORD_MAX_BYTES,
});
const listingInFlight = new Map<string, Promise<MetadataFetchResult<CommerceListingRecord>>>();
const shopCache = new BoundedTtlCache<MetadataFetchResult<CommerceShopRecord>>({
  maxEntries: OG_COMMERCE_CACHE_MAX_ENTRIES,
  maxTotalBytes: OG_COMMERCE_CACHE_MAX_TOTAL_BYTES,
  maxEntryBytes: OG_RECORD_MAX_BYTES,
});
const shopInFlight = new Map<string, Promise<MetadataFetchResult<CommerceShopRecord>>>();
const mediaCache = new BoundedTtlCache<string>({
  maxEntries: OG_MEDIA_CACHE_MAX_ENTRIES,
  maxTotalBytes: OG_MEDIA_CACHE_MAX_TOTAL_BYTES,
  maxEntryBytes: OG_MEDIA_CACHE_MAX_ENTRY_BYTES,
});
const mediaInFlight = new Map<string, Promise<string | null>>();

/** Clears all in-process OG/SSR record and media caches (for tests). */
export function resetOgCommerceCacheForTests(): void {
  listingCache.clear();
  listingInFlight.clear();
  shopCache.clear();
  shopInFlight.clear();
  mediaCache.clear();
  mediaInFlight.clear();
}

/**
 * Cache-Control for the rendered marketplace OG PNGs, matching the record
 * revalidate window (the social default in `OG_CACHE_HEADERS` is an hour).
 */
export const OG_COMMERCE_CACHE_HEADERS = {
  'cache-control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400',
} as const;

export const OG_NO_STORE_CACHE_HEADERS = {
  'cache-control': 'no-store',
} as const;

const MARKETPLACE_RECORD_BASE_PATH = '/pub/pubky.app/marketplace/v1';

const metadataClient = new Client({
  pkarr: {
    relays: getPkarrRelays(),
    requestTimeout: 4_000,
  },
});

const PUBKY_PROTOCOL = 'pubky://';

function buildRecordUrl(ownerPubky: string, recordPath: string): string {
  return resolvePubky(`pubky://${ownerPubky}${MARKETPLACE_RECORD_BASE_PATH}/${recordPath}`);
}

export type MetadataFetchResult<T> =
  | { kind: 'found'; record: T }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; reason: string };

type RecordFetchResult = { kind: 'found'; value: unknown } | Exclude<MetadataFetchResult<never>, { kind: 'found' }>;

function reasonForError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timeout';
  if (error instanceof Error && error.name === 'AbortError') return 'timeout';
  if (error instanceof Error && error.message) return error.message;
  return 'request_failed';
}

/** Default bound on PKARR resolution plus the record fetch for SSR. */
export const RECORD_FETCH_TIMEOUT_MS = 4_000;

export interface RecordFetchOptions {
  timeoutMs?: number;
}

type BoundedTextBody = { text: string } | { overCap: true };

async function readBoundedTextBody(res: Response, maxBytes: number): Promise<BoundedTextBody> {
  const contentLength = res.headers.get('content-length');
  if (contentLength !== null) {
    const parsedLength = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      return { overCap: true };
    }
  }

  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) return { overCap: true };
    return { text };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return { text: Buffer.concat(chunks).toString('utf8') };
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { overCap: true };
      }
      chunks.push(value);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Preserve the original read failure.
    }
    throw error;
  }
}

async function readRecordJson(url: string, operation: string, signal: AbortSignal): Promise<RecordFetchResult> {
  try {
    const res = await metadataClient.fetch(url, { credentials: 'include', signal });
    if (res.status === 404) return { kind: 'not_found' };
    if (!res.ok) {
      const reason = `http_${res.status}`;
      Logger.warn(`[ogCommerceData] ${operation} unavailable`, { status: res.status, reason });
      return { kind: 'unavailable', reason };
    }
    const body = await readBoundedTextBody(res, OG_RECORD_MAX_BYTES);
    if ('overCap' in body) {
      Logger.warn(`[ogCommerceData] ${operation} unavailable`, {
        reason: 'too_large',
        maxBytes: OG_RECORD_MAX_BYTES,
      });
      return { kind: 'unavailable', reason: 'too_large' };
    }
    return { kind: 'found', value: JSON.parse(body.text) as unknown };
  } catch (error) {
    if (signal.aborted) return { kind: 'unavailable', reason: 'timeout' };
    const reason = reasonForError(error);
    Logger.warn(`[ogCommerceData] ${operation} unavailable`, { reason });
    return { kind: 'unavailable', reason };
  }
}

async function fetchRecordJson(
  url: string,
  operation: string,
  { timeoutMs = RECORD_FETCH_TIMEOUT_MS }: RecordFetchOptions = {},
): Promise<RecordFetchResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The deadline settles the wait even when the client does not settle after the abort.
  const deadline = new Promise<RecordFetchResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      Logger.warn(`[ogCommerceData] ${operation} unavailable`, { reason: 'timeout' });
      resolve({ kind: 'unavailable', reason: 'timeout' });
    }, timeoutMs);
  });
  try {
    return await Promise.race([readRecordJson(url, operation, controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeMoney<T extends { amountMinor: number; currency: string; exponent: number }>(money: T): T {
  return {
    amountMinor: money.amountMinor,
    currency: money.currency,
    exponent: money.exponent,
  } as T;
}

function sanitizeLocation(location: CommerceShopRecord['location']): CommerceShopRecord['location'] {
  return {
    countryCode: location.countryCode,
    ...(location.region !== undefined ? { region: location.region } : {}),
  };
}

/** Strips open-world `.passthrough()` keys before storing a validated shop in process memory. */
function sanitizeShopForCache(record: CommerceShopRecord): CommerceShopRecord {
  return {
    schemaVersion: record.schemaVersion,
    recordType: record.recordType,
    ownerPubky: record.ownerPubky,
    revision: record.revision,
    name: record.name,
    bio: record.bio,
    location: sanitizeLocation(record.location),
    ...(record.avatarUrl !== undefined ? { avatarUrl: record.avatarUrl } : {}),
    ...(record.bannerUrl !== undefined ? { bannerUrl: record.bannerUrl } : {}),
    shippingPolicy: record.shippingPolicy,
    returnPolicy: record.returnPolicy,
    vacationMode: record.vacationMode,
    ...(record.transactionService !== undefined ? { transactionService: record.transactionService } : {}),
    ...(record.deliveryAssumeDays !== undefined ? { deliveryAssumeDays: record.deliveryAssumeDays } : {}),
    ...(record.autoCompleteDays !== undefined ? { autoCompleteDays: record.autoCompleteDays } : {}),
    ...(record.shipsToCountries !== undefined ? { shipsToCountries: [...record.shipsToCountries] } : {}),
    ...(record.sellerStatus !== undefined ? { sellerStatus: record.sellerStatus } : {}),
    ...(record.sellerStatusConfirmedAt !== undefined
      ? { sellerStatusConfirmedAt: record.sellerStatusConfirmedAt }
      : {}),
    ...(record.bitcoinConfirmation !== undefined ? { bitcoinConfirmation: record.bitcoinConfirmation } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Strips open-world `.passthrough()` keys before storing a validated listing in process memory. */
function sanitizeListingForCache(record: CommerceListingRecord): CommerceListingRecord {
  const sale: CommerceListingRecord['sale'] =
    record.sale.format === 'fixed_price'
      ? {
          format: 'fixed_price',
          unitPrice: sanitizeMoney(record.sale.unitPrice),
          acceptsOffers: record.sale.acceptsOffers,
        }
      : {
          format: 'auction',
          startingPrice: sanitizeMoney(record.sale.startingPrice),
          ...(record.sale.buyNowPrice !== undefined ? { buyNowPrice: sanitizeMoney(record.sale.buyNowPrice) } : {}),
          minimumIncrement: sanitizeMoney(record.sale.minimumIncrement),
          startsAt: record.sale.startsAt,
          endsAt: record.sale.endsAt,
          antiSnipingWindowSeconds: record.sale.antiSnipingWindowSeconds,
          antiSnipingExtensionSeconds: record.sale.antiSnipingExtensionSeconds,
        };

  return {
    schemaVersion: record.schemaVersion,
    recordType: record.recordType,
    ownerPubky: record.ownerPubky,
    revision: record.revision,
    listingId: record.listingId,
    state: record.state,
    title: record.title,
    description: record.description,
    taxonomyVersion: record.taxonomyVersion,
    categoryId: record.categoryId,
    ...(record.attributes !== undefined ? { attributes: { ...record.attributes } } : {}),
    condition: record.condition,
    ...(record.conditionDetails !== undefined ? { conditionDetails: record.conditionDetails } : {}),
    tags: [...record.tags],
    location: sanitizeLocation(record.location),
    media: record.media.map((item) => ({
      id: item.id,
      type: item.type,
      url: item.url,
      contentHash: item.contentHash,
      mimeType: item.mimeType,
      byteSize: item.byteSize,
      width: item.width,
      height: item.height,
      ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
      altText: item.altText,
    })),
    variants: record.variants.map((variant) => ({
      id: variant.id,
      ...(variant.sku !== undefined ? { sku: variant.sku } : {}),
      options: { ...variant.options },
      ...(variant.priceOverride !== undefined ? { priceOverride: sanitizeMoney(variant.priceOverride) } : {}),
      quantity: variant.quantity,
      mediaIds: [...variant.mediaIds],
      enabled: variant.enabled,
    })),
    sale,
    fulfillmentMethods: [...record.fulfillmentMethods],
    ...(record.package !== undefined
      ? {
          package: {
            weightGrams: record.package.weightGrams,
            lengthMillimeters: record.package.lengthMillimeters,
            widthMillimeters: record.package.widthMillimeters,
            heightMillimeters: record.package.heightMillimeters,
          },
        }
      : {}),
    shippingOptions: record.shippingOptions.map((option) => {
      if (option.pricing === 'free') {
        return {
          id: option.id,
          pricing: 'free' as const,
          label: option.label,
          estimatedMinDays: option.estimatedMinDays,
          estimatedMaxDays: option.estimatedMaxDays,
        };
      }
      if (option.pricing === 'flat') {
        return {
          id: option.id,
          pricing: 'flat' as const,
          label: option.label,
          price: sanitizeMoney(option.price),
          estimatedMinDays: option.estimatedMinDays,
          estimatedMaxDays: option.estimatedMaxDays,
        };
      }
      return {
        id: option.id,
        pricing: 'calculated' as const,
        label: option.label,
        provider: option.provider,
        serviceCode: option.serviceCode,
        estimatedMinDays: option.estimatedMinDays,
        estimatedMaxDays: option.estimatedMaxDays,
      };
    }),
    ...(record.shippingProfileId !== undefined ? { shippingProfileId: record.shippingProfileId } : {}),
    ...(record.shippingZones !== undefined
      ? {
          shippingZones: record.shippingZones.map((zone) => ({
            zoneId: zone.zoneId,
            name: zone.name,
            countries: [...zone.countries],
            ...(zone.restOfWorld !== undefined ? { restOfWorld: zone.restOfWorld } : {}),
            rates: zone.rates.map((rate) => {
              if (rate.pricing === 'free') {
                return {
                  rateId: rate.rateId,
                  label: rate.label,
                  estimatedMinDays: rate.estimatedMinDays,
                  estimatedMaxDays: rate.estimatedMaxDays,
                  pricing: 'free' as const,
                };
              }
              if (rate.pricing === 'flat') {
                return {
                  rateId: rate.rateId,
                  label: rate.label,
                  estimatedMinDays: rate.estimatedMinDays,
                  estimatedMaxDays: rate.estimatedMaxDays,
                  pricing: 'flat' as const,
                  amountMinor: rate.amountMinor,
                };
              }
              return {
                rateId: rate.rateId,
                label: rate.label,
                estimatedMinDays: rate.estimatedMinDays,
                estimatedMaxDays: rate.estimatedMaxDays,
                pricing: 'per_item' as const,
                firstMinor: rate.firstMinor,
                additionalMinor: rate.additionalMinor,
              };
            }),
          })),
        }
      : {}),
    returnPolicy: {
      acceptsReturns: record.returnPolicy.acceptsReturns,
      ...(record.returnPolicy.returnWindowDays !== undefined
        ? { returnWindowDays: record.returnPolicy.returnWindowDays }
        : {}),
      buyerPaysReturnShipping: record.returnPolicy.buyerPaysReturnShipping,
      ...(record.returnPolicy.details !== undefined ? { details: record.returnPolicy.details } : {}),
    },
    ...(record.digitalLock !== undefined
      ? {
          digitalLock: {
            policyUri: record.digitalLock.policyUri,
            criterionId: record.digitalLock.criterionId,
            contentPath: record.digitalLock.contentPath,
            resourceHash: record.digitalLock.resourceHash,
            minimumConfirmations: record.digitalLock.minimumConfirmations,
          },
        }
      : {}),
    adultOnly: record.adultOnly,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function estimateMetadataResultBytes<T>(result: MetadataFetchResult<T>): number {
  if (result.kind !== 'found') return 64;
  return Buffer.byteLength(JSON.stringify(result.record), 'utf8');
}

/**
 * Fetches marketplace media through the homeserver resolved from the media
 * owner's PKARR record. Plain HTTP(S) media keeps the shared OG fetch path.
 */
export async function fetchOgMediaAsDataUri(uri: string | null | undefined): Promise<string | null> {
  if (!uri) return null;
  const cached = mediaCache.get(uri);
  if (cached !== undefined) return cached;
  const existing = mediaInFlight.get(uri);
  if (existing) return await existing;

  const load = async (): Promise<string | null> => {
    if (uri.startsWith('http://') || uri.startsWith('https://')) return await fetchImageAsDataUri(uri);
    if (!uri.startsWith(PUBKY_PROTOCOL)) return null;
    const parsedUri = marketplacePublicUriSchema.safeParse(uri);
    if (!parsedUri.success) return null;

    try {
      const url = resolvePubky(parsedUri.data);
      return await fetchImageAsDataUri(url, (_input, init) =>
        metadataClient.fetch(url, {
          ...init,
          credentials: 'include',
          signal: AbortSignal.timeout(4_000),
        }),
      );
    } catch (error) {
      const reason = reasonForError(error);
      Logger.warn('[ogCommerceData] Marketplace media unavailable', { uri, reason });
      return null;
    }
  };

  const promise = load()
    .then((dataUri) => {
      if (dataUri !== null) {
        mediaCache.set(uri, dataUri, OG_COMMERCE_CACHE_TTL_MS, Buffer.byteLength(dataUri, 'utf8'));
      }
      return dataUri;
    })
    .finally(() => {
      if (mediaInFlight.get(uri) === promise) mediaInFlight.delete(uri);
    });
  mediaInFlight.set(uri, promise);
  return await promise;
}

/**
 * Fetches and validates the canonical listing record for metadata / OG image
 * generation. Returns `not_found` — the callers' cue to fall back to the generic
 * marketplace card — when the seller/listing params are malformed, the record
 * is missing, or the listing is in the `removed` state (a removed listing must
 * never be advertised in a preview). Network and validation failures return an
 * unavailable result so callers can preserve the page and avoid caching a
 * generic OG fallback.
 */
export async function fetchListingForMetadata(
  sellerPubky: string,
  listingId: string,
): Promise<MetadataFetchResult<CommerceListingRecord>> {
  const seller = commercePubkySchema.safeParse(sellerPubky);
  const id = commerceEntityIdSchema.safeParse(listingId);
  if (!seller.success || !id.success) return { kind: 'not_found' };

  const cacheKey = `${seller.data}:${id.data}`;
  const cached = listingCache.get(cacheKey);
  if (cached) return cached;
  const existing = listingInFlight.get(cacheKey);
  if (existing) return await existing;

  const load = async (): Promise<MetadataFetchResult<CommerceListingRecord>> => {
    let url: string;
    try {
      url = buildRecordUrl(seller.data, `listings/${id.data}`);
    } catch (error) {
      const reason = reasonForError(error);
      Logger.warn('[ogCommerceData] fetchListingRecord unavailable', { reason });
      return { kind: 'unavailable', reason };
    }
    const fetched = await fetchRecordJson(url, 'fetchListingRecord');
    if (fetched.kind !== 'found') return fetched;

    const record = commerceListingRecordSchema.safeParse(fetched.value);
    if (!record.success) {
      const reason = 'validation';
      Logger.warn('[ogCommerceData] Listing record failed validation', {
        issueCount: record.error.issues.length,
        reason,
      });
      return { kind: 'unavailable', reason };
    }
    if (record.data.state === 'removed') return { kind: 'not_found' };
    return { kind: 'found', record: sanitizeListingForCache(record.data) };
  };

  const promise = load()
    .then((result) => {
      if (result.kind === 'found') {
        listingCache.set(cacheKey, result, OG_COMMERCE_CACHE_TTL_MS, estimateMetadataResultBytes(result));
      } else if (result.kind === 'not_found') {
        listingCache.set(cacheKey, result, OG_COMMERCE_NOT_FOUND_TTL_MS, estimateMetadataResultBytes(result));
      }
      return result;
    })
    .finally(() => {
      if (listingInFlight.get(cacheKey) === promise) listingInFlight.delete(cacheKey);
    });
  listingInFlight.set(cacheKey, promise);
  return await promise;
}

async function waitWithTimeout<T>(
  promise: Promise<MetadataFetchResult<T>>,
  timeoutMs: number,
): Promise<MetadataFetchResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<MetadataFetchResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'unavailable', reason: 'timeout' }), timeoutMs);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches and validates the canonical shop record (`shop.json`) for metadata /
 * OG image generation. Returns `not_found` on malformed params or a missing
 * record, and `unavailable` for fetch or validation failures.
 *
 * Shared single-flight reads always run with `RECORD_FETCH_TIMEOUT_MS` (4s) so
 * a shorter-timeout catalog SSR caller cannot starve a concurrent `/shop`
 * metadata caller; callers passing a shorter `timeoutMs` settle at their own
 * budget while allowing the shared read to warm `shopCache`.
 */
export async function fetchShopForMetadata(
  sellerPubky: string,
  options: RecordFetchOptions = {},
): Promise<MetadataFetchResult<CommerceShopRecord>> {
  const seller = commercePubkySchema.safeParse(sellerPubky);
  if (!seller.success) return { kind: 'not_found' };

  const cacheKey = seller.data;
  const cached = shopCache.get(cacheKey);
  if (cached) return cached;

  const callerTimeoutMs = options.timeoutMs ?? RECORD_FETCH_TIMEOUT_MS;
  let promise = shopInFlight.get(cacheKey);
  if (!promise) {
    const load = async (): Promise<MetadataFetchResult<CommerceShopRecord>> => {
      let url: string;
      try {
        url = buildRecordUrl(seller.data, 'shop.json');
      } catch (error) {
        const reason = reasonForError(error);
        Logger.warn('[ogCommerceData] fetchShopRecord unavailable', { reason });
        return { kind: 'unavailable', reason };
      }
      const fetched = await fetchRecordJson(url, 'fetchShopRecord', { timeoutMs: RECORD_FETCH_TIMEOUT_MS });
      if (fetched.kind !== 'found') return fetched;

      const record = commerceShopRecordSchema.safeParse(fetched.value);
      if (!record.success) {
        const reason = 'validation';
        Logger.warn('[ogCommerceData] Shop record failed validation', {
          issueCount: record.error.issues.length,
          reason,
        });
        return { kind: 'unavailable', reason };
      }
      return { kind: 'found', record: sanitizeShopForCache(record.data) };
    };

    const created = load()
      .then((result) => {
        if (result.kind === 'found') {
          shopCache.set(cacheKey, result, OG_COMMERCE_CACHE_TTL_MS, estimateMetadataResultBytes(result));
        } else if (result.kind === 'not_found') {
          shopCache.set(cacheKey, result, OG_COMMERCE_NOT_FOUND_TTL_MS, estimateMetadataResultBytes(result));
        }
        return result;
      })
      .finally(() => {
        if (shopInFlight.get(cacheKey) === created) shopInFlight.delete(cacheKey);
      });
    shopInFlight.set(cacheKey, created);
    promise = created;
  }

  return callerTimeoutMs < RECORD_FETCH_TIMEOUT_MS ? await waitWithTimeout(promise, callerTimeoutMs) : await promise;
}
