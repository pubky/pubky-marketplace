'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  defaultDirection,
  hasActiveListingFilters,
  type ListingTableQuery,
  parseListingTableQuery,
  serializeListingTableQuery,
} from '@/libs/commerce/listing-table';

const SEARCH_DEBOUNCE_MS = 250;

export interface UseListingTableQueryResult {
  query: ListingTableQuery;
  hasFilters: boolean;
  /** What the search box shows: updates on every keystroke, reaches the URL after a short pause. */
  searchText: string;
  setSearchText: (text: string) => void;
  /** Changes part of the query. Any change other than `page` returns to the first page. */
  update: (changes: Partial<ListingTableQuery>) => void;
  clearFilters: () => void;
}

/**
 * The seller studio table's filters, sort and page, kept in the URL query so a reload, a shared link and the back
 * button all land on the same view. Defaults are left out of the URL.
 */
export function useListingTableQuery(): UseListingTableQueryResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = parseListingTableQuery(searchParams ?? new URLSearchParams());
  const [searchText, setSearchTextState] = useState(query.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committedText = useRef(query.q);
  const latest = useRef(query);

  useEffect(() => {
    latest.current = query;
  });

  // The back button or a new link changes the URL under the box: follow it, unless the seller is mid-typing.
  useEffect(() => {
    if (query.q !== committedText.current) {
      committedText.current = query.q;
      setSearchTextState(query.q);
    }
  }, [query.q]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const write = (next: ListingTableQuery) => {
    const qs = serializeListingTableQuery(next);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const update = (changes: Partial<ListingTableQuery>) => {
    const next = { ...latest.current, ...changes };
    if (!('page' in changes)) next.page = 1;
    if (changes.sort && !('dir' in changes)) next.dir = defaultDirection(changes.sort);
    latest.current = next;
    write(next);
  };

  const setSearchText = (text: string) => {
    setSearchTextState(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      committedText.current = text.trim();
      update({ q: text });
    }, SEARCH_DEBOUNCE_MS);
  };

  const clearFilters = () => {
    if (timer.current) clearTimeout(timer.current);
    committedText.current = '';
    setSearchTextState('');
    update({ q: '', state: null, format: null, checkout: null, source: null, stock: null });
  };

  return { query, hasFilters: hasActiveListingFilters(query), searchText, setSearchText, update, clearFilters };
}
