import { NEXUS_LISTINGS_PER_PAGE } from '@/config/nexus';
import {
  catalogItemFromCatalogEntry,
  type MarketplaceCatalogItem,
} from '@/hooks/useMarketplaceCatalog/useMarketplaceCatalog.utils';
import type { CommerceShopRecord } from '@/libs/commerce/marketplace-records';
import { NEXUS_STREAM_LISTINGS_ROUTE } from '@/libs/commerce/nexus-routes';
import { Logger } from '@/libs/logger/logger';
import { getCommerceAdapterMode, getMarketplaceNexusUrl } from '@/libs/runtime-config/runtime-config';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
import {
  fetchShopForMetadata,
  OG_COMMERCE_CACHE_TTL_MS,
  OG_COMMERCE_REVALIDATE,
  readBoundedTextBody,
  resetOgCommerceCacheForTests,
} from './ogCommerceData';

export interface MarketplaceCatalogSsrPayload {
  listings: MarketplaceCatalogItem[];
  shops: CommerceShopRecord[];
}

export const CATALOG_LISTINGS_FETCH_TIMEOUT_MS = 4_000;
export const CATALOG_LISTINGS_MAX_BYTES = 1024 * 1024;

const CATALOG_CACHE_MAX_ENTRIES = 16;
const catalogListingsCache = new Map<string, { listings: MarketplaceCatalogItem[]; expiresAt: number }>();
const catalogListingsInFlight = new Map<string, Promise<MarketplaceCatalogItem[]>>();

/** Clears in-process SSR catalog and shop caches (for tests). */
export function resetOgCatalogCacheForTests(): void {
  catalogListingsCache.clear();
  catalogListingsInFlight.clear();
  resetOgCommerceCacheForTests();
}

function readCachedCatalogListings(key: string): MarketplaceCatalogItem[] | undefined {
  const entry = catalogListingsCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    catalogListingsCache.delete(key);
    return undefined;
  }
  catalogListingsCache.delete(key);
  catalogListingsCache.set(key, entry);
  return entry.listings;
}

function writeCachedCatalogListings(key: string, listings: MarketplaceCatalogItem[]): void {
  if (catalogListingsCache.has(key)) {
    catalogListingsCache.delete(key);
  } else if (catalogListingsCache.size >= CATALOG_CACHE_MAX_ENTRIES) {
    const oldestKey = catalogListingsCache.keys().next().value;
    if (oldestKey !== undefined) catalogListingsCache.delete(oldestKey);
  }
  catalogListingsCache.set(key, { listings, expiresAt: Date.now() + OG_COMMERCE_CACHE_TTL_MS });
}

async function readCatalogListingsFromNexus(
  cacheKey: string,
  url: string,
  signal: AbortSignal,
): Promise<MarketplaceCatalogItem[]> {
  try {
    const res = await fetch(url, { next: { revalidate: OG_COMMERCE_REVALIDATE }, signal });
    if (!res.ok) {
      Logger.warn('[ogCatalogData] Listing stream failed', { url, status: res.status });
      return [];
    }

    const body = await readBoundedTextBody(res, CATALOG_LISTINGS_MAX_BYTES, signal);
    if ('overCap' in body) {
      Logger.warn('[ogCatalogData] Listing stream exceeded byte cap', {
        url,
        maxBytes: CATALOG_LISTINGS_MAX_BYTES,
      });
      return [];
    }
    if ('unreadable' in body) {
      Logger.warn('[ogCatalogData] Listing stream body was unreadable', { url });
      return [];
    }

    const json: unknown = JSON.parse(body.text);
    const boundedJson = Array.isArray(json) ? json.slice(0, NEXUS_LISTINGS_PER_PAGE) : json;
    const listings = CommerceRecordNormalizer.nexusListingStream(boundedJson).map(catalogItemFromCatalogEntry);
    if (!signal.aborted) {
      writeCachedCatalogListings(cacheKey, listings);
    }
    return listings;
  } catch (error) {
    if (signal.aborted) return [];
    Logger.warn('[ogCatalogData] Failed to fetch marketplace listing stream', { error });
    return [];
  }
}

async function fetchCatalogListings(cacheKey: string, nexusUrl: string): Promise<MarketplaceCatalogItem[]> {
  const cached = readCachedCatalogListings(cacheKey);
  if (cached) return cached;

  const existing = catalogListingsInFlight.get(cacheKey);
  if (existing) return await existing;

  const query = new URLSearchParams({
    state: 'active',
    limit: String(NEXUS_LISTINGS_PER_PAGE),
  });
  const url = `${nexusUrl}/${NEXUS_STREAM_LISTINGS_ROUTE}?${query.toString()}`;

  const load = async (): Promise<MarketplaceCatalogItem[]> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<MarketplaceCatalogItem[]>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        Logger.warn('[ogCatalogData] Listing stream timed out', {
          url,
          timeoutMs: CATALOG_LISTINGS_FETCH_TIMEOUT_MS,
        });
        resolve([]);
      }, CATALOG_LISTINGS_FETCH_TIMEOUT_MS);
    });
    try {
      return await Promise.race([readCatalogListingsFromNexus(cacheKey, url, controller.signal), deadline]);
    } finally {
      clearTimeout(timer);
    }
  };

  const promise = load().finally(() => {
    if (catalogListingsInFlight.get(cacheKey) === promise) catalogListingsInFlight.delete(cacheKey);
  });
  catalogListingsInFlight.set(cacheKey, promise);
  return await promise;
}

/**
 * Server-only first page of the public Nexus marketplace listing stream for
 * the `/marketplace` catalog HTML, plus shop records for the distinct sellers
 * on that page so SSR cards render the shop name (not the pubky fallback).
 *
 * The listing stream is cached in-process for `OG_COMMERCE_REVALIDATE` seconds
 * with single-flight deduplication and a bounded request/body deadline, while
 * seller shop records are resolved via `ogCommerceData`'s bounded TTL cache so
 * warm sellers resolve in O(1) without network IO and transient shop
 * failures/timeouts recover on subsequent hits instead of pinning pubky
 * fallbacks for 5 minutes.
 *
 * Sandbox deployments never query Nexus (seeded local catalogs only).
 */
export async function fetchMarketplaceCatalogForSsr(): Promise<MarketplaceCatalogSsrPayload> {
  const adapterMode = getCommerceAdapterMode();
  if (adapterMode === 'sandbox') return { listings: [], shops: [] };

  const nexusUrl = getMarketplaceNexusUrl();
  const cacheKey = `${adapterMode}:${nexusUrl}`;
  const listings = await fetchCatalogListings(cacheKey, nexusUrl);
  if (listings.length === 0) return { listings: [], shops: [] };
  const shops = await fetchShopsForCatalogSellers(listings);
  return { listings, shops };
}

/**
 * Per-seller budget for catalog shop names. A seller whose record misses it
 * renders with the pubky fallback instead of holding up the catalog HTML.
 * One page caps the fan-out at `NEXUS_LISTINGS_PER_PAGE` sellers, and warm
 * reads hit the 5-minute in-process cache in `ogCommerceData` without network IO.
 */
export const CATALOG_SHOP_FETCH_TIMEOUT_MS = 1_200;

async function fetchShopsForCatalogSellers(listings: MarketplaceCatalogItem[]): Promise<CommerceShopRecord[]> {
  const sellers = [...new Set(listings.map((listing) => listing.sellerId))];
  const settled = await Promise.allSettled(
    sellers.map((seller) => fetchShopForMetadata(seller, { timeoutMs: CATALOG_SHOP_FETCH_TIMEOUT_MS })),
  );
  return settled.flatMap((result) => {
    if (result.status !== 'fulfilled' || result.value.kind !== 'found') return [];
    return [result.value.record];
  });
}
