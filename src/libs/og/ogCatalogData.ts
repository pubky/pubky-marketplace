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
  resetOgCommerceCacheForTests,
} from './ogCommerceData';

export interface MarketplaceCatalogSsrPayload {
  listings: MarketplaceCatalogItem[];
  shops: CommerceShopRecord[];
}

const CATALOG_CACHE_MAX_ENTRIES = 16;
const catalogCache = new Map<string, { payload: MarketplaceCatalogSsrPayload; expiresAt: number }>();
const catalogInFlight = new Map<string, Promise<MarketplaceCatalogSsrPayload>>();

/** Clears in-process SSR catalog and shop caches (for tests). */
export function resetOgCatalogCacheForTests(): void {
  catalogCache.clear();
  catalogInFlight.clear();
  resetOgCommerceCacheForTests();
}

function readCachedCatalog(key: string): MarketplaceCatalogSsrPayload | undefined {
  const entry = catalogCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    catalogCache.delete(key);
    return undefined;
  }
  catalogCache.delete(key);
  catalogCache.set(key, entry);
  return entry.payload;
}

function writeCachedCatalog(key: string, payload: MarketplaceCatalogSsrPayload): void {
  if (catalogCache.has(key)) {
    catalogCache.delete(key);
  } else if (catalogCache.size >= CATALOG_CACHE_MAX_ENTRIES) {
    const oldestKey = catalogCache.keys().next().value;
    if (oldestKey !== undefined) catalogCache.delete(oldestKey);
  }
  catalogCache.set(key, { payload, expiresAt: Date.now() + OG_COMMERCE_CACHE_TTL_MS });
}

/**
 * Server-only first page of the public Nexus marketplace listing stream for
 * the `/marketplace` catalog HTML, plus shop records for the distinct sellers
 * on that page so SSR cards render the shop name (not the pubky fallback).
 * Same constraints as `ogCommerceData`: no Dexie/controller writes — a read of
 * public index projections and public `shop.json` records, cached in-process
 * for `OG_COMMERCE_REVALIDATE` seconds with single-flight deduplication so
 * containerized non-Vercel deployments serve cached SSR fast without stalling
 * on live homeserver reads every hit.
 *
 * Sandbox deployments never query Nexus (seeded local catalogs only).
 */
export async function fetchMarketplaceCatalogForSsr(): Promise<MarketplaceCatalogSsrPayload> {
  const adapterMode = getCommerceAdapterMode();
  if (adapterMode === 'sandbox') return { listings: [], shops: [] };

  const nexusUrl = getMarketplaceNexusUrl();
  const cacheKey = `${adapterMode}:${nexusUrl}`;
  const cached = readCachedCatalog(cacheKey);
  if (cached) return cached;

  const existing = catalogInFlight.get(cacheKey);
  if (existing) return await existing;

  const query = new URLSearchParams({
    state: 'active',
    limit: String(NEXUS_LISTINGS_PER_PAGE),
  });
  const url = `${nexusUrl}/${NEXUS_STREAM_LISTINGS_ROUTE}?${query.toString()}`;

  const load = async (): Promise<MarketplaceCatalogSsrPayload> => {
    try {
      const res = await fetch(url, { next: { revalidate: OG_COMMERCE_REVALIDATE } });
      if (!res.ok) {
        Logger.warn('[ogCatalogData] Listing stream failed', { url, status: res.status });
        return { listings: [], shops: [] };
      }

      const json: unknown = await res.json();
      const listings = CommerceRecordNormalizer.nexusListingStream(json).map(catalogItemFromCatalogEntry);
      const shops = await fetchShopsForCatalogSellers(listings);
      const payload = { listings, shops };
      writeCachedCatalog(cacheKey, payload);
      return payload;
    } catch (error) {
      Logger.warn('[ogCatalogData] Failed to fetch marketplace listing stream', { error });
      return { listings: [], shops: [] };
    }
  };

  const promise = load().finally(() => {
    if (catalogInFlight.get(cacheKey) === promise) catalogInFlight.delete(cacheKey);
  });
  catalogInFlight.set(cacheKey, promise);
  return await promise;
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
