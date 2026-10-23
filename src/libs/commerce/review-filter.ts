import { isValidTagLabel } from '@/libs/utils/utils';
import type { CommerceReviewMatch } from '@/models/commerce/commerce.schema';

/**
 * The reviewer filters a review list offers (reviews design section 3). They
 * are exclusive: one chip is active at a time, and `all` sends nothing.
 *
 * - `following`: reviewers the viewer follows (`reach=following`).
 * - `wot`: "My network", reviewers within two follow hops (`reach=wot`).
 * - `tagged`: reviewers the viewer tagged with any of the labels
 *   (`tagged_by_viewer`).
 */
export type MarketplaceReviewFilter =
  | { kind: 'all' }
  | { kind: 'following' }
  | { kind: 'wot' }
  | { kind: 'tagged'; labels: readonly string[] };

export type MarketplaceActiveReviewFilter = Exclude<MarketplaceReviewFilter, { kind: 'all' }>;

export const MARKETPLACE_REVIEW_FILTER_DEFAULT: MarketplaceReviewFilter = { kind: 'all' };

/** The follow hops "My network" reaches: the index's own default for `reach=wot`, sent explicitly. */
export const MARKETPLACE_REVIEW_WOT_DEPTH = 2;

/** Most labels the index accepts in one `tagged_by_viewer` parameter. */
export const MARKETPLACE_REVIEW_TAG_LABELS_MAX = 5;

/** What the application sends for a reviewer filter, with the viewer it is relative to. */
export interface MarketplaceReviewFilterRequest {
  viewerId: string;
  reach?: 'following' | 'wot';
  depth?: number;
  taggedLabels?: string[];
}

/**
 * What a reviewer filter puts in the rating header: the counted figures of
 * the matches once the index answered, `loading` until then, and `unscored`
 * when no figure can be claimed for the filter (no trusted attestor windows
 * to count by, or the index refused the filter).
 */
export type MarketplaceReviewFilterSummary =
  | { state: 'loading'; filter: MarketplaceActiveReviewFilter }
  | { state: 'ready'; filter: MarketplaceActiveReviewFilter; matched: CommerceReviewMatch }
  | { state: 'unscored'; filter: MarketplaceActiveReviewFilter };

export function isActiveReviewFilter(filter: MarketplaceReviewFilter): filter is MarketplaceActiveReviewFilter {
  return filter.kind !== 'all';
}

/**
 * Labels as pubky.app stores them and as the index compares them: trimmed and
 * lowercase, a label with a character a tag cannot carry or beyond the length
 * limit dropped, duplicates removed, at most five kept (the first five).
 */
export function normalizeReviewTagLabels(labels: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const label of labels) {
    const candidate = label.trim().toLowerCase();
    if (!isValidTagLabel(candidate) || normalized.includes(candidate)) continue;
    normalized.push(candidate);
    if (normalized.length === MARKETPLACE_REVIEW_TAG_LABELS_MAX) break;
  }
  return normalized;
}

/** A filter in its canonical form: tagged labels normalized, and "tagged" with no label is "all". */
export function normalizeReviewFilter(filter: MarketplaceReviewFilter): MarketplaceReviewFilter {
  if (filter.kind !== 'tagged') return filter;
  const labels = normalizeReviewTagLabels(filter.labels);
  return labels.length === 0 ? MARKETPLACE_REVIEW_FILTER_DEFAULT : { kind: 'tagged', labels };
}

/** A stable identity for a filter, so a hook can depend on it by value. */
export function reviewFilterKey(filter: MarketplaceReviewFilter): string {
  return filter.kind === 'tagged' ? `tagged:${filter.labels.join(',')}` : filter.kind;
}

/**
 * The request for a filter. Nothing without an active filter, and nothing
 * without a viewer: a signed-out visitor never sends a pubky, because the
 * filters are relative to the viewer.
 */
export function reviewFilterRequest(
  filter: MarketplaceReviewFilter,
  viewerPubky: string | null,
): MarketplaceReviewFilterRequest | undefined {
  if (viewerPubky === null || !isActiveReviewFilter(filter)) return undefined;
  switch (filter.kind) {
    case 'following':
      return { viewerId: viewerPubky, reach: 'following' };
    case 'wot':
      return { viewerId: viewerPubky, reach: 'wot', depth: MARKETPLACE_REVIEW_WOT_DEPTH };
    case 'tagged':
      return { viewerId: viewerPubky, taggedLabels: normalizeReviewTagLabels(filter.labels) };
  }
}

const FILTERS_UNSUPPORTED_KEY = 'marketplace:reviews:filters-unsupported';

/**
 * Whether this browser session already learned that the review index ignores
 * the reviewer filters (an index before IX4), so the chips stay hidden
 * without asking again. Unreadable storage reads as "not known".
 */
export function reviewFiltersKnownUnsupported(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(FILTERS_UNSUPPORTED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remembers, for this browser session, that the review index cannot filter. */
export function rememberReviewFiltersUnsupported(): void {
  try {
    globalThis.sessionStorage?.setItem(FILTERS_UNSUPPORTED_KEY, '1');
  } catch {
    // The hook keeps the answer in state; only the cross-page memory is lost.
  }
}
