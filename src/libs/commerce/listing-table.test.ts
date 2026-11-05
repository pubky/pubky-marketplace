import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LISTING_TABLE_QUERY,
  filterListingRows,
  LISTING_TABLE_PAGE_SIZE,
  listingFacetCounts,
  type ListingTableQuery,
  type ListingTableRow,
  paginateListingRows,
  parseListingTableQuery,
  serializeListingTableQuery,
  sortListingRows,
} from './listing-table';

const row = (id: string, overrides: Partial<ListingTableRow> = {}): ListingTableRow => ({
  id,
  title: `Listing ${id}`,
  skus: [],
  state: 'active',
  format: 'fixed_price',
  createdAtMs: 0,
  priceMinor: 1_000,
  currency: 'USD',
  stock: 5,
  needsRegistration: false,
  sources: [],
  ...overrides,
});

const query = (overrides: Partial<ListingTableQuery> = {}): ListingTableQuery => ({
  ...DEFAULT_LISTING_TABLE_QUERY,
  ...overrides,
});

const ids = (rows: readonly ListingTableRow[]) => rows.map((r) => r.id);

describe('listing table query in the URL', () => {
  it('leaves a clean table with a clean URL', () => {
    expect(serializeListingTableQuery(DEFAULT_LISTING_TABLE_QUERY)).toBe('');
  });

  it('round-trips every filter, the sort and the page', () => {
    const full = query({
      q: 'boots',
      state: 'paused',
      format: 'auction',
      checkout: 'needs',
      source: 'shopify',
      stock: 'out',
      sort: 'price',
      dir: 'desc',
      page: 3,
    });

    const qs = serializeListingTableQuery(full);

    expect(parseListingTableQuery(new URLSearchParams(qs))).toEqual(full);
  });

  it('leaves out the default direction of the chosen sort, and keeps the other one', () => {
    expect(serializeListingTableQuery(query({ sort: 'title', dir: 'asc' }))).toBe('sort=title');
    expect(serializeListingTableQuery(query({ sort: 'title', dir: 'desc' }))).toBe('sort=title&dir=desc');
    expect(serializeListingTableQuery(query({ sort: 'created', dir: 'asc' }))).toBe('dir=asc');
  });

  it('ignores values it does not know instead of failing', () => {
    const parsed = parseListingTableQuery(
      new URLSearchParams('format=bogus&checkout=x&source=ebay&stock=maybe&sort=colour&dir=sideways&page=-4'),
    );

    expect(parsed).toEqual(DEFAULT_LISTING_TABLE_QUERY);
  });

  it('starts a sort in the direction its default says when only the sort is given', () => {
    expect(parseListingTableQuery(new URLSearchParams('sort=title')).dir).toBe('asc');
    expect(parseListingTableQuery(new URLSearchParams('sort=created')).dir).toBe('desc');
  });
});

describe('filterListingRows', () => {
  const rows = [
    row('a', { title: 'Vintage boots', skus: ['BOOT-42'], sources: ['shopify'] }),
    row('b', { title: 'Brass lamp', state: 'paused', needsRegistration: true }),
    row('c', { title: 'Auction clock', format: 'auction', state: 'ended', stock: 0, sources: ['woocommerce'] }),
    row('d', { title: 'Unlimited guide', stock: Number.POSITIVE_INFINITY }),
    row('e', { title: 'Mystery', stock: null }),
  ];

  it('searches the title and any variant SKU, ignoring case', () => {
    expect(ids(filterListingRows(rows, query({ q: 'LAMP' })))).toEqual(['b']);
    expect(ids(filterListingRows(rows, query({ q: 'boot-4' })))).toEqual(['a']);
  });

  it('filters by state, format and checkout', () => {
    expect(ids(filterListingRows(rows, query({ state: 'paused' })))).toEqual(['b']);
    expect(ids(filterListingRows(rows, query({ format: 'auction' })))).toEqual(['c']);
    expect(ids(filterListingRows(rows, query({ checkout: 'needs' })))).toEqual(['b']);
    expect(ids(filterListingRows(rows, query({ checkout: 'ready' })))).toEqual(['a', 'c', 'd', 'e']);
  });

  it('filters by source, with manual meaning no store links it', () => {
    expect(ids(filterListingRows(rows, query({ source: 'shopify' })))).toEqual(['a']);
    expect(ids(filterListingRows(rows, query({ source: 'woocommerce' })))).toEqual(['c']);
    expect(ids(filterListingRows(rows, query({ source: 'manual' })))).toEqual(['b', 'd', 'e']);
  });

  it('treats unlimited stock as in stock and leaves unknown stock out of both stock filters', () => {
    expect(ids(filterListingRows(rows, query({ stock: 'in' })))).toEqual(['a', 'b', 'd']);
    expect(ids(filterListingRows(rows, query({ stock: 'out' })))).toEqual(['c']);
  });

  it('combines the filters', () => {
    expect(ids(filterListingRows(rows, query({ q: 'a', checkout: 'ready', stock: 'in' })))).toEqual(['a']);
  });
});

describe('listingFacetCounts', () => {
  const rows = [
    row('a', { sources: ['shopify'] }),
    row('b', { sources: ['shopify'], state: 'paused' }),
    row('c', { state: 'paused', needsRegistration: true }),
    row('d', { format: 'auction', state: 'ended', stock: 0 }),
  ];

  it('counts each option against every other filter but its own facet', () => {
    const counts = listingFacetCounts(rows, query({ state: 'paused' }));

    // State counts ignore the state filter itself...
    expect(counts.state).toEqual({ active: 1, paused: 2, ended: 1 });
    // ...every other facet is counted inside the paused rows.
    expect(counts.source).toEqual({ shopify: 1, woocommerce: 0, manual: 1 });
    expect(counts.checkout).toEqual({ ready: 1, needs: 1 });
    expect(counts.format).toEqual({ fixed_price: 2, auction: 0 });
  });

  it('applies the text search to every count', () => {
    expect(listingFacetCounts(rows, query({ q: 'listing c' })).state).toEqual({ paused: 1 });
  });
});

describe('sortListingRows', () => {
  const rows = [
    row('a', { title: 'banana', priceMinor: 300, stock: 2, createdAtMs: 20, state: 'paused' }),
    row('b', { title: 'Apple', priceMinor: 100, stock: null, createdAtMs: 30, state: 'active' }),
    row('c', { title: 'cherry 10', priceMinor: 200, stock: 9, createdAtMs: 10, state: 'ended' }),
    row('d', { title: 'cherry 2', priceMinor: 200, stock: Number.POSITIVE_INFINITY, createdAtMs: 40, state: 'active' }),
  ];

  it('sorts newest and oldest first by listing date', () => {
    expect(ids(sortListingRows(rows, 'created', 'desc'))).toEqual(['d', 'b', 'a', 'c']);
    expect(ids(sortListingRows(rows, 'created', 'asc'))).toEqual(['c', 'a', 'b', 'd']);
  });

  it('sorts titles without case and with numbers in order', () => {
    expect(ids(sortListingRows(rows, 'title', 'asc'))).toEqual(['b', 'a', 'd', 'c']);
    expect(ids(sortListingRows(rows, 'title', 'desc'))).toEqual(['c', 'd', 'a', 'b']);
  });

  it('sorts by price and keeps equal prices in their incoming order', () => {
    expect(ids(sortListingRows(rows, 'price', 'asc'))).toEqual(['b', 'c', 'd', 'a']);
    expect(ids(sortListingRows(rows, 'price', 'desc'))).toEqual(['a', 'c', 'd', 'b']);
  });

  it('sorts by inventory with unlimited highest and unknown last either way', () => {
    expect(ids(sortListingRows(rows, 'inventory', 'asc'))).toEqual(['a', 'c', 'd', 'b']);
    expect(ids(sortListingRows(rows, 'inventory', 'desc'))).toEqual(['d', 'c', 'a', 'b']);
  });

  it('sorts by state with active first', () => {
    expect(ids(sortListingRows(rows, 'state', 'asc'))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('does not reorder its input', () => {
    const copy = [...rows];
    sortListingRows(rows, 'title', 'asc');
    expect(rows).toEqual(copy);
  });

  it('never mixes currencies into one price order', () => {
    const mixed = [
      row('x', { currency: 'USD', priceMinor: 500 }),
      row('y', { currency: 'BTC', priceMinor: 9_999_999 }),
    ];
    expect(ids(sortListingRows(mixed, 'price', 'asc'))).toEqual(['y', 'x']);
  });
});

describe('paginateListingRows', () => {
  const rows = Array.from({ length: 183 }, (_, index) => row(String(index)));

  it('pages 183 listings into pages of the page size', () => {
    const first = paginateListingRows(rows, 1);
    expect(first.rows).toHaveLength(LISTING_TABLE_PAGE_SIZE);
    expect(first).toMatchObject({ page: 1, pageCount: 4, total: 183, from: 1, to: 50 });
    expect(paginateListingRows(rows, 4)).toMatchObject({ from: 151, to: 183 });
  });

  it('clamps a page that no longer exists, such as after a filter shrank the table', () => {
    expect(paginateListingRows(rows.slice(0, 10), 9)).toMatchObject({ page: 1, pageCount: 1, from: 1, to: 10 });
  });

  it('reports an empty table as zero to zero', () => {
    expect(paginateListingRows([], 1)).toMatchObject({ total: 0, from: 0, to: 0, pageCount: 1 });
  });
});
