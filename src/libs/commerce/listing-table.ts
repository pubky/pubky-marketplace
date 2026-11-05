import { listingDisplayState } from '@/libs/commerce/auction-phase';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { isUnlimitedStock } from '@/libs/commerce/unlimited-stock';

export const LISTING_TABLE_PAGE_SIZE = 50;

export const LISTING_SORT_KEYS = ['created', 'title', 'price', 'inventory', 'state'] as const;
export type ListingSortKey = (typeof LISTING_SORT_KEYS)[number];
export type ListingSortDirection = 'asc' | 'desc';

export const LISTING_FORMAT_FILTERS = ['fixed_price', 'auction'] as const;
export const LISTING_CHECKOUT_FILTERS = ['ready', 'needs'] as const;
export const LISTING_SOURCE_FILTERS = ['shopify', 'woocommerce', 'manual'] as const;
export const LISTING_STOCK_FILTERS = ['in', 'out'] as const;

export type ListingFormatFilter = (typeof LISTING_FORMAT_FILTERS)[number];
export type ListingCheckoutFilter = (typeof LISTING_CHECKOUT_FILTERS)[number];
export type ListingSourceFilter = (typeof LISTING_SOURCE_FILTERS)[number];
export type ListingStockFilter = (typeof LISTING_STOCK_FILTERS)[number];

export interface ListingTableQuery {
  q: string;
  state: string | null;
  format: ListingFormatFilter | null;
  checkout: ListingCheckoutFilter | null;
  source: ListingSourceFilter | null;
  stock: ListingStockFilter | null;
  sort: ListingSortKey;
  dir: ListingSortDirection;
  page: number;
}

export const DEFAULT_LISTING_TABLE_QUERY: ListingTableQuery = {
  q: '',
  state: null,
  format: null,
  checkout: null,
  source: null,
  stock: null,
  sort: 'created',
  dir: 'desc',
  page: 1,
};

export interface ListingTableRow {
  id: string;
  title: string;
  skus: readonly string[];
  /** The state a seller sees: an auction past its end reads `ended` whatever its record says. */
  state: string;
  format: ListingFormatFilter;
  createdAtMs: number;
  priceMinor: number;
  currency: string;
  /** Units a buyer can take now; `Infinity` for unlimited stock, `null` while it is not known. */
  stock: number | null;
  needsRegistration: boolean;
  sources: readonly Exclude<ListingSourceFilter, 'manual'>[];
}

interface ListingForRow {
  id: string;
  record: CommerceListingRecord;
  purchasableQuantity?: number | null;
}

/** Everything a row needs that the listing itself does not carry. */
export interface ListingRowContext<L extends ListingForRow = ListingForRow> {
  nowMs: number;
  needsRegistration: (listing: L) => boolean;
  stockKnown: (listing: L) => boolean;
  sourcesOf: (listingId: string) => readonly Exclude<ListingSourceFilter, 'manual'>[];
}

export function toListingTableRow<L extends ListingForRow>(listing: L, context: ListingRowContext<L>): ListingTableRow {
  const { record } = listing;
  const price = record.sale.format === 'fixed_price' ? record.sale.unitPrice : record.sale.startingPrice;
  const unlimited = record.variants.some((variant) => isUnlimitedStock(record, variant.quantity));
  const finite =
    listing.purchasableQuantity ??
    record.variants.reduce((sum, variant) => sum + (variant.enabled ? variant.quantity : 0), 0);
  return {
    id: listing.id,
    title: record.title,
    skus: record.variants.flatMap(({ sku }) => (sku ? [sku] : [])),
    state: listingDisplayState(record.state, record.sale, context.nowMs),
    format: record.sale.format,
    createdAtMs: Date.parse(record.createdAt) || 0,
    priceMinor: price.amountMinor,
    currency: price.currency,
    stock: unlimited ? Number.POSITIVE_INFINITY : context.stockKnown(listing) ? finite : null,
    needsRegistration: context.needsRegistration(listing),
    sources: context.sourcesOf(record.listingId),
  };
}

const oneOf = <T extends string>(allowed: readonly T[], value: string | null): T | null =>
  value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;

interface ParamReader {
  get: (name: string) => string | null;
}

export function parseListingTableQuery(params: ParamReader): ListingTableQuery {
  const rawPage = params.get('page') ?? '';
  const page = /^[1-9]\d{0,8}$/.test(rawPage) ? Number(rawPage) : 1;
  const sort = oneOf(LISTING_SORT_KEYS, params.get('sort')) ?? DEFAULT_LISTING_TABLE_QUERY.sort;
  const dir = oneOf(['asc', 'desc'] as const, params.get('dir')) ?? defaultDirection(sort);
  return {
    q: (params.get('q') ?? '').slice(0, 120),
    state: params.get('state')?.trim() || null,
    format: oneOf(LISTING_FORMAT_FILTERS, params.get('format')),
    checkout: oneOf(LISTING_CHECKOUT_FILTERS, params.get('checkout')),
    source: oneOf(LISTING_SOURCE_FILTERS, params.get('source')),
    stock: oneOf(LISTING_STOCK_FILTERS, params.get('stock')),
    sort,
    dir,
    page,
  };
}

/** A new sort key starts in the direction a seller expects of it: newest first, everything else A to Z or low to high. */
export function defaultDirection(sort: ListingSortKey): ListingSortDirection {
  return sort === 'created' ? 'desc' : 'asc';
}

/** The query string for a query, leaving out every default so a clean table has a clean URL. */
export function serializeListingTableQuery(query: ListingTableQuery): string {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set('q', query.q.trim());
  if (query.state) params.set('state', query.state);
  if (query.format) params.set('format', query.format);
  if (query.checkout) params.set('checkout', query.checkout);
  if (query.source) params.set('source', query.source);
  if (query.stock) params.set('stock', query.stock);
  if (query.sort !== DEFAULT_LISTING_TABLE_QUERY.sort) params.set('sort', query.sort);
  if (query.dir !== defaultDirection(query.sort)) params.set('dir', query.dir);
  if (query.page > 1) params.set('page', String(query.page));
  return params.toString();
}

export function hasActiveListingFilters(query: ListingTableQuery): boolean {
  return Boolean(query.q.trim() || query.state || query.format || query.checkout || query.source || query.stock);
}

type FacetName = 'state' | 'format' | 'checkout' | 'source' | 'stock';

function matchesFacet(row: ListingTableRow, facet: FacetName, query: ListingTableQuery): boolean {
  switch (facet) {
    case 'state':
      return query.state === null || row.state === query.state;
    case 'format':
      return query.format === null || row.format === query.format;
    case 'checkout':
      return query.checkout === null || row.needsRegistration === (query.checkout === 'needs');
    case 'source':
      if (query.source === null) return true;
      return query.source === 'manual' ? row.sources.length === 0 : row.sources.includes(query.source);
    case 'stock':
      return (
        query.stock === null || (row.stock === null ? false : query.stock === 'in' ? row.stock > 0 : row.stock <= 0)
      );
  }
}

const FACETS: readonly FacetName[] = ['state', 'format', 'checkout', 'source', 'stock'];

function matchesText(row: ListingTableRow, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (!needle) return true;
  return row.title.toLowerCase().includes(needle) || row.skus.some((sku) => sku.toLowerCase().includes(needle));
}

export function filterListingRows(rows: readonly ListingTableRow[], query: ListingTableQuery): ListingTableRow[] {
  return rows.filter((row) => matchesText(row, query.q) && FACETS.every((facet) => matchesFacet(row, facet, query)));
}

export interface ListingFacetCounts {
  state: Record<string, number>;
  format: Record<ListingFormatFilter, number>;
  checkout: Record<ListingCheckoutFilter, number>;
  source: Record<ListingSourceFilter, number>;
  stock: Record<ListingStockFilter, number>;
}

/**
 * How many rows each filter option would show, given every other filter and the text search. An option's own
 * facet is left out of its count, so the numbers say what choosing that option would do.
 */
export function listingFacetCounts(rows: readonly ListingTableRow[], query: ListingTableQuery): ListingFacetCounts {
  const counts: ListingFacetCounts = {
    state: {},
    format: { fixed_price: 0, auction: 0 },
    checkout: { ready: 0, needs: 0 },
    source: { shopify: 0, woocommerce: 0, manual: 0 },
    stock: { in: 0, out: 0 },
  };
  for (const row of rows) {
    if (!matchesText(row, query.q)) continue;
    const others = (facet: FacetName) => FACETS.every((other) => other === facet || matchesFacet(row, other, query));
    if (others('state')) counts.state[row.state] = (counts.state[row.state] ?? 0) + 1;
    if (others('format')) counts.format[row.format] += 1;
    if (others('checkout')) counts.checkout[row.needsRegistration ? 'needs' : 'ready'] += 1;
    if (others('source')) {
      if (row.sources.length === 0) counts.source.manual += 1;
      for (const source of row.sources) counts.source[source] += 1;
    }
    if (others('stock') && row.stock !== null) counts.stock[row.stock > 0 ? 'in' : 'out'] += 1;
  }
  return counts;
}

const STATE_ORDER = ['active', 'paused', 'ended', 'removed'];

function compareRows(a: ListingTableRow, b: ListingTableRow, sort: ListingSortKey): number {
  switch (sort) {
    case 'created':
      return a.createdAtMs - b.createdAtMs;
    case 'title':
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
    case 'price':
      return a.currency === b.currency ? a.priceMinor - b.priceMinor : a.currency.localeCompare(b.currency);
    case 'inventory':
      return compareStock(a.stock, b.stock);
    case 'state': {
      const rank = (state: string) => {
        const index = STATE_ORDER.indexOf(state);
        return index === -1 ? STATE_ORDER.length : index;
      };
      return rank(a.state) - rank(b.state);
    }
  }
}

function compareStock(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/** Stable: rows that tie keep their incoming order, so a title sort never reshuffles equal titles between renders. */
export function sortListingRows(
  rows: readonly ListingTableRow[],
  sort: ListingSortKey,
  dir: ListingSortDirection,
): ListingTableRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      // Unknown stock stays last whichever way the column is sorted.
      if (sort === 'inventory' && (a.row.stock === null || b.row.stock === null)) {
        return compareStock(a.row.stock, b.row.stock) || a.index - b.index;
      }
      return sign * compareRows(a.row, b.row, sort) || a.index - b.index;
    })
    .map(({ row }) => row);
}

export interface ListingPage {
  rows: ListingTableRow[];
  page: number;
  pageCount: number;
  total: number;
  /** 1-based position of the first and last row shown, 0 when empty. */
  from: number;
  to: number;
}

export function paginateListingRows(rows: readonly ListingTableRow[], requestedPage: number): ListingPage {
  const pageCount = Math.max(1, Math.ceil(rows.length / LISTING_TABLE_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const start = (page - 1) * LISTING_TABLE_PAGE_SIZE;
  const slice = rows.slice(start, start + LISTING_TABLE_PAGE_SIZE);
  return {
    rows: slice,
    page,
    pageCount,
    total: rows.length,
    from: slice.length === 0 ? 0 : start + 1,
    to: start + slice.length,
  };
}
