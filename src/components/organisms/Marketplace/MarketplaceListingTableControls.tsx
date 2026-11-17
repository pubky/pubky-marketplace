'use client';

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { Button, buttonVariants } from '@/atoms/Button/Button';
import { Input } from '@/atoms/Input/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import { Typography } from '@/atoms/Typography/Typography';
import type { UseListingTableQueryResult } from '@/hooks/useListingTableQuery/useListingTableQuery';
import {
  defaultDirection,
  type ListingFacetCounts,
  type ListingPage,
  type ListingSortKey,
} from '@/libs/commerce/listing-table';
import { cn } from '@/libs/utils/utils';

const ANY = 'any';
const TRIGGER_CLASS = cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'max-w-64 text-xs');

const STATE_LABELS: Record<string, string> = { active: 'Active', paused: 'Paused', ended: 'Ended', removed: 'Removed' };
const SORT_LABELS: Record<ListingSortKey, string> = {
  created: 'Date listed',
  title: 'Title',
  price: 'Price',
  inventory: 'Inventory',
  state: 'State',
};

export const stateLabel = (state: string) => STATE_LABELS[state] ?? state;

interface FilterSelectProps {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  options: ReadonlyArray<{ value: string; label: string; count: number }>;
}

function FilterSelect({ label, value, onChange, options }: FilterSelectProps) {
  return (
    <Select value={value ?? ANY} onValueChange={(next) => onChange(next === ANY ? null : next)}>
      <SelectTrigger aria-label={label} data-active={value !== null || undefined} className={TRIGGER_CLASS}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectItem value={ANY}>{label}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.count === 0 && value !== option.value}>
            {option.label} ({option.count})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface MarketplaceListingFilterBarProps {
  table: UseListingTableQueryResult;
  counts: ListingFacetCounts;
  /** The states that exist in the seller's listings, so the State filter offers only those. */
  states: readonly string[];
  /** Whether the stores' mappings were read; without them the Source filter would be guessing. */
  sourcesReady: boolean;
}

export function MarketplaceListingFilterBar({ table, counts, states, sourcesReady }: MarketplaceListingFilterBarProps) {
  const { query, update } = table;
  const sortValue = `${query.sort}:${query.dir}`;
  return (
    <div className="flex flex-col gap-3" data-testid="listing-filter-bar">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Search listings by title or SKU"
            placeholder="Search title or SKU"
            className="h-8 pl-9 text-sm"
            value={table.searchText}
            onChange={(event) => table.setSearchText(event.target.value)}
          />
        </div>
        <FilterSelect
          label="State"
          value={query.state}
          onChange={(state) => update({ state })}
          options={states.map((state) => ({ value: state, label: stateLabel(state), count: counts.state[state] ?? 0 }))}
        />
        <FilterSelect
          label="Format"
          value={query.format}
          onChange={(format) => update({ format: format as typeof query.format })}
          options={[
            { value: 'fixed_price', label: 'Fixed price', count: counts.format.fixed_price },
            { value: 'auction', label: 'Auction', count: counts.format.auction },
          ]}
        />
        <FilterSelect
          label="Checkout"
          value={query.checkout}
          onChange={(checkout) => update({ checkout: checkout as typeof query.checkout })}
          options={[
            { value: 'ready', label: 'Registered', count: counts.checkout.ready },
            { value: 'needs', label: 'Needs registration', count: counts.checkout.needs },
          ]}
        />
        {sourcesReady && (
          <FilterSelect
            label="Source"
            value={query.source}
            onChange={(source) => update({ source: source as typeof query.source })}
            options={[
              { value: 'shopify', label: 'Shopify', count: counts.source.shopify },
              { value: 'woocommerce', label: 'WooCommerce', count: counts.source.woocommerce },
              { value: 'manual', label: 'Made here', count: counts.source.manual },
            ]}
          />
        )}
        <FilterSelect
          label="Stock"
          value={query.stock}
          onChange={(stock) => update({ stock: stock as typeof query.stock })}
          options={[
            { value: 'in', label: 'In stock', count: counts.stock.in },
            { value: 'out', label: 'Out of stock', count: counts.stock.out },
          ]}
        />
        <Select
          value={sortValue}
          onValueChange={(next) => {
            const [sort, dir] = next.split(':') as [ListingSortKey, 'asc' | 'desc'];
            update({ sort, dir });
          }}
        >
          <SelectTrigger aria-label="Sort listings" className={TRIGGER_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            {(Object.keys(SORT_LABELS) as ListingSortKey[]).flatMap((sort) =>
              (['asc', 'desc'] as const).map((dir) => (
                <SelectItem key={`${sort}:${dir}`} value={`${sort}:${dir}`}>
                  {sortOptionLabel(sort, dir)}
                </SelectItem>
              )),
            )}
          </SelectContent>
        </Select>
        {table.hasFilters && (
          <Button size="sm" variant="ghost" className="rounded-full text-xs" onClick={table.clearFilters}>
            <X className="size-4" aria-hidden="true" />
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}

function sortOptionLabel(sort: ListingSortKey, dir: 'asc' | 'desc'): string {
  if (sort === 'created') return dir === 'desc' ? 'Newest first' : 'Oldest first';
  if (sort === 'title') return dir === 'asc' ? 'Title A to Z' : 'Title Z to A';
  if (sort === 'price') return dir === 'asc' ? 'Price low to high' : 'Price high to low';
  if (sort === 'inventory') return dir === 'asc' ? 'Inventory low to high' : 'Inventory high to low';
  return dir === 'asc' ? 'State (active first)' : 'State (active last)';
}

export interface SortableHeaderProps {
  sortKey: ListingSortKey;
  active: ListingSortKey;
  dir: 'asc' | 'desc';
  onSort: (sort: ListingSortKey, dir: 'asc' | 'desc') => void;
  children: React.ReactNode;
}

/** A table column header that sorts by its column; the next click on the active column reverses it. */
export function SortableHeader({ sortKey, active, dir, onSort, children }: SortableHeaderProps) {
  const isActive = sortKey === active;
  const Icon = dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className="p-3" aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1 font-semibold hover:text-foreground"
        onClick={() => onSort(sortKey, isActive ? (dir === 'asc' ? 'desc' : 'asc') : defaultDirection(sortKey))}
      >
        {children}
        {isActive && <Icon className="size-3.5" aria-hidden="true" />}
      </button>
    </th>
  );
}

export interface SelectionBannerProps {
  /** Rows on this page that are selected, and rows on this page. */
  pageSelected: number;
  pageSize: number;
  matching: number;
  selected: number;
  allMatchingSelected: boolean;
  onSelectAllMatching: () => void;
  onClear: () => void;
}

/**
 * Once every row on the page is selected, offers to extend the selection to every row that matches the filters
 * (183 imported listings at once), and says how many are selected.
 */
export function ListingSelectionBanner({
  pageSelected,
  pageSize,
  matching,
  selected,
  allMatchingSelected,
  onSelectAllMatching,
  onClear,
}: SelectionBannerProps) {
  if (selected === 0) return null;
  const offerAll = !allMatchingSelected && pageSelected === pageSize && matching > pageSize;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm"
      data-testid="listing-selection-banner"
    >
      <span>
        {allMatchingSelected
          ? `All ${matching} matching listings are selected.`
          : `${selected} ${selected === 1 ? 'listing' : 'listings'} selected.`}
      </span>
      {offerAll && (
        <Button size="sm" variant="ghost" className="h-7 rounded-full px-3 text-xs" onClick={onSelectAllMatching}>
          Select all {matching} matching
        </Button>
      )}
      <Button size="sm" variant="ghost" className="h-7 rounded-full px-3 text-xs" onClick={onClear}>
        Clear selection
      </Button>
    </div>
  );
}

export interface ListingPaginationProps {
  page: ListingPage;
  onPage: (page: number) => void;
}

export function ListingPagination({ page, onPage }: ListingPaginationProps) {
  if (page.total === 0) return null;
  return (
    <nav
      aria-label="Listing pages"
      className="flex flex-wrap items-center justify-between gap-2"
      data-testid="listing-pagination"
    >
      <Typography as="p" className="text-sm text-muted-foreground">
        Showing {page.from}–{page.to} of {page.total}
      </Typography>
      {page.pageCount > 1 && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full"
            disabled={page.page <= 1}
            onClick={() => onPage(page.page - 1)}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Previous
          </Button>
          <Typography as="span" className="text-sm text-muted-foreground">
            Page {page.page} of {page.pageCount}
          </Typography>
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full"
            disabled={page.page >= page.pageCount}
            onClick={() => onPage(page.page + 1)}
          >
            Next
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </nav>
  );
}
