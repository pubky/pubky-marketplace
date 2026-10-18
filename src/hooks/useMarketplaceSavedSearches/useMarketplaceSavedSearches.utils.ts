import { filterBySellerSet, type PaymentMethodFilter } from '@/libs/commerce/payment-method-filter';
import type { CommerceSavedSearchParams } from '@/models/commerce/commerce.schema';
import {
  filterMarketplaceCatalog,
  type MarketplaceCatalogItem,
} from '../useMarketplaceCatalog/useMarketplaceCatalog.utils';

/**
 * Runs a saved search's persisted params over catalog items — exactly the
 * catalog page's filter. A payment-method search also needs that method's
 * seller set; without one the matches are unknown (`null`), never guessed.
 */
export function matchSavedSearch(
  items: MarketplaceCatalogItem[],
  params: CommerceSavedSearchParams,
  paymentSellers: ReadonlyMap<PaymentMethodFilter, ReadonlySet<string>> = new Map(),
): MarketplaceCatalogItem[] | null {
  // Legacy rows persisted before the location or payment filters existed
  // carry neither; they mean "anywhere" and "any payment".
  const matches = filterMarketplaceCatalog(items, { ...params, countryCode: params.countryCode ?? null });
  const method = params.paymentMethod ?? null;
  if (!method) return matches;
  const sellers = paymentSellers.get(method);
  return sellers ? filterBySellerSet(matches, sellers, (item) => item.sellerId) : null;
}

export interface SavedSearchMatchSummary {
  /** Matches whose catalog `updated_at` exceeds the acknowledged watermark. */
  newCount: number;
  /** Newest `updated_at` among the current matches; 0 when there are none. */
  latestMatchUpdatedAt: number;
}

/**
 * Watermark arithmetic for one saved-search check. NEW means "indexed after
 * the newest match the user has acknowledged": strictly greater than the
 * watermark, so re-running a check never re-counts acknowledged items, and a
 * search saved just now (watermark = newest current match) starts at zero —
 * no false positives on first save or first visit.
 */
export function summarizeSavedSearchMatches(
  matches: MarketplaceCatalogItem[],
  watermarkUpdatedAt: number,
): SavedSearchMatchSummary {
  let newCount = 0;
  let latestMatchUpdatedAt = 0;
  for (const match of matches) {
    if (match.updatedAt > watermarkUpdatedAt) newCount += 1;
    if (match.updatedAt > latestMatchUpdatedAt) latestMatchUpdatedAt = match.updatedAt;
  }
  return { newCount, latestMatchUpdatedAt };
}
