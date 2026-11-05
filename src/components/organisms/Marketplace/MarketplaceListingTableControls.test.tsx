import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { UseListingTableQueryResult } from '@/hooks/useListingTableQuery/useListingTableQuery';
import {
  DEFAULT_LISTING_TABLE_QUERY,
  type ListingFacetCounts,
  type ListingTableQuery,
  paginateListingRows,
} from '@/libs/commerce/listing-table';
import {
  ListingPagination,
  ListingSelectionBanner,
  MarketplaceListingFilterBar,
  SortableHeader,
} from './MarketplaceListingTableControls';

const counts: ListingFacetCounts = {
  state: { active: 120, paused: 60, ended: 3 },
  format: { fixed_price: 180, auction: 3 },
  checkout: { ready: 100, needs: 83 },
  source: { shopify: 183, woocommerce: 0, manual: 0 },
  stock: { in: 150, out: 33 },
};

function tableFor(query: Partial<ListingTableQuery> = {}, overrides: Partial<UseListingTableQueryResult> = {}) {
  const table: UseListingTableQueryResult = {
    query: { ...DEFAULT_LISTING_TABLE_QUERY, ...query },
    hasFilters: false,
    searchText: '',
    setSearchText: vi.fn(),
    update: vi.fn(),
    clearFilters: vi.fn(),
    ...overrides,
  };
  return table;
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
});

describe('MarketplaceListingFilterBar', () => {
  it('offers counts for every option, and only the states the seller has', async () => {
    const user = userEvent.setup();
    render(
      <MarketplaceListingFilterBar table={tableFor()} counts={counts} states={['active', 'paused']} sourcesReady />,
    );

    await user.click(screen.getByRole('combobox', { name: 'State' }));
    expect(await screen.findByRole('option', { name: 'Active (120)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Paused (60)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Ended/ })).not.toBeInTheDocument();
  });

  it('changes a filter through update, and "any" clears it', async () => {
    const user = userEvent.setup();
    const table = tableFor({ checkout: 'needs' });
    render(<MarketplaceListingFilterBar table={table} counts={counts} states={['active']} sourcesReady />);

    await user.click(screen.getByRole('combobox', { name: 'Checkout' }));
    await user.click(await screen.findByRole('option', { name: 'Registered (100)' }));
    expect(table.update).toHaveBeenCalledWith({ checkout: 'ready' });

    await user.click(screen.getByRole('combobox', { name: 'Checkout' }));
    await user.click(await screen.findByRole('option', { name: 'Checkout' }));
    expect(table.update).toHaveBeenLastCalledWith({ checkout: null });
  });

  it('offers the Source filter only once the stores were read', () => {
    const { rerender } = render(
      <MarketplaceListingFilterBar table={tableFor()} counts={counts} states={['active']} sourcesReady={false} />,
    );
    expect(screen.queryByRole('combobox', { name: 'Source' })).not.toBeInTheDocument();

    rerender(<MarketplaceListingFilterBar table={tableFor()} counts={counts} states={['active']} sourcesReady />);
    expect(screen.getByRole('combobox', { name: 'Source' })).toBeInTheDocument();
  });

  it('types into the search box through the debounced setter', async () => {
    const user = userEvent.setup();
    const table = tableFor();
    render(<MarketplaceListingFilterBar table={table} counts={counts} states={['active']} sourcesReady />);

    await user.type(screen.getByRole('searchbox', { name: 'Search listings by title or SKU' }), 'b');

    expect(table.setSearchText).toHaveBeenCalledWith('b');
  });

  it('sets the sort from the sort control, as on a phone', async () => {
    const user = userEvent.setup();
    const table = tableFor();
    render(<MarketplaceListingFilterBar table={table} counts={counts} states={['active']} sourcesReady />);

    await user.click(screen.getByRole('combobox', { name: 'Sort listings' }));
    await user.click(await screen.findByRole('option', { name: 'Price high to low' }));

    expect(table.update).toHaveBeenCalledWith({ sort: 'price', dir: 'desc' });
  });

  it('shows Clear filters only while a filter is on', async () => {
    const user = userEvent.setup();
    const off = tableFor();
    const { rerender } = render(
      <MarketplaceListingFilterBar table={off} counts={counts} states={['active']} sourcesReady />,
    );
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();

    const on = tableFor({ state: 'paused' }, { hasFilters: true });
    rerender(<MarketplaceListingFilterBar table={on} counts={counts} states={['active']} sourcesReady />);
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(on.clearFilters).toHaveBeenCalled();
  });
});

describe('SortableHeader', () => {
  const header = (active: 'title' | 'price', dir: 'asc' | 'desc', onSort = vi.fn()) => {
    render(
      <table>
        <thead>
          <tr>
            <SortableHeader sortKey="price" active={active} dir={dir} onSort={onSort}>
              Price
            </SortableHeader>
          </tr>
        </thead>
      </table>,
    );
    return onSort;
  };

  it('reports its sort state and reverses on a second click', async () => {
    const onSort = header('price', 'asc');

    expect(screen.getByRole('columnheader', { name: 'Price' })).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(screen.getByRole('button', { name: 'Price' }));

    expect(onSort).toHaveBeenCalledWith('price', 'desc');
  });

  it('starts an inactive column in its default direction', async () => {
    const onSort = header('title', 'asc');

    expect(screen.getByRole('columnheader', { name: 'Price' })).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(screen.getByRole('button', { name: 'Price' }));

    expect(onSort).toHaveBeenCalledWith('price', 'asc');
  });
});

describe('ListingSelectionBanner', () => {
  const banner = (overrides: Partial<Parameters<typeof ListingSelectionBanner>[0]> = {}) => {
    const props = {
      pageSelected: 50,
      pageSize: 50,
      matching: 183,
      selected: 50,
      allMatchingSelected: false,
      onSelectAllMatching: vi.fn(),
      onClear: vi.fn(),
      ...overrides,
    };
    render(<ListingSelectionBanner {...props} />);
    return props;
  };

  it('offers every matching listing once the whole page is selected', async () => {
    const props = banner();

    await userEvent.click(screen.getByRole('button', { name: 'Select all 183 matching' }));

    expect(props.onSelectAllMatching).toHaveBeenCalled();
  });

  it('does not offer it for a partial page, or when everything is already selected', () => {
    banner({ pageSelected: 10, selected: 10 });
    expect(screen.queryByRole('button', { name: /Select all/ })).not.toBeInTheDocument();
  });

  it('says all matching listings are selected', () => {
    banner({ selected: 183, allMatchingSelected: true });
    expect(
      within(screen.getByTestId('listing-selection-banner')).getByText('All 183 matching listings are selected.'),
    ).toBeInTheDocument();
  });

  it('renders nothing without a selection', () => {
    banner({ selected: 0, pageSelected: 0 });
    expect(screen.queryByTestId('listing-selection-banner')).not.toBeInTheDocument();
  });
});

describe('ListingPagination', () => {
  const rows = Array.from({ length: 183 }, (_, index) => ({ id: String(index) }) as never);

  it('says where the page sits and moves between pages', async () => {
    const onPage = vi.fn();
    render(<ListingPagination page={paginateListingRows(rows, 2)} onPage={onPage} />);

    expect(screen.getByText('Showing 51–100 of 183')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 4')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));

    expect(onPage).toHaveBeenNthCalledWith(1, 3);
    expect(onPage).toHaveBeenNthCalledWith(2, 1);
  });

  it('disables Previous on the first page and Next on the last', () => {
    const { rerender } = render(<ListingPagination page={paginateListingRows(rows, 1)} onPage={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    rerender(<ListingPagination page={paginateListingRows(rows, 4)} onPage={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('has no page buttons when everything fits on one page', () => {
    render(<ListingPagination page={paginateListingRows(rows.slice(0, 10), 1)} onPage={vi.fn()} />);

    expect(screen.getByText('Showing 1–10 of 10')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });
});
