import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useListingTableQuery } from './useListingTableQuery';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
const url = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/marketplace/dashboard',
  useSearchParams: () => url.params,
}));

describe('useListingTableQuery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    router.replace.mockClear();
    url.params = new URLSearchParams();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the filters, the sort and the page from the URL', () => {
    url.params = new URLSearchParams('state=paused&format=auction&sort=price&dir=desc&page=2&q=boots');

    const { result } = renderHook(() => useListingTableQuery());

    expect(result.current.query).toMatchObject({
      state: 'paused',
      format: 'auction',
      sort: 'price',
      dir: 'desc',
      page: 2,
      q: 'boots',
    });
    expect(result.current.hasFilters).toBe(true);
    expect(result.current.searchText).toBe('boots');
  });

  it('writes a change to the URL without a history entry or a scroll, and leaves defaults out', () => {
    const { result } = renderHook(() => useListingTableQuery());

    act(() => result.current.update({ stock: 'out' }));

    expect(router.replace).toHaveBeenCalledWith('/marketplace/dashboard?stock=out', { scroll: false });
  });

  it('returns to the first page when a filter or sort changes, but not when only the page does', () => {
    url.params = new URLSearchParams('page=3');
    const { result } = renderHook(() => useListingTableQuery());

    act(() => result.current.update({ page: 2 }));
    expect(router.replace).toHaveBeenLastCalledWith('/marketplace/dashboard?page=2', { scroll: false });

    act(() => result.current.update({ sort: 'title' }));
    expect(router.replace).toHaveBeenLastCalledWith('/marketplace/dashboard?sort=title', { scroll: false });
  });

  it('keeps two quick changes together instead of the second overwriting the first', () => {
    const { result } = renderHook(() => useListingTableQuery());

    act(() => {
      result.current.update({ state: 'paused' });
      result.current.update({ format: 'auction' });
    });

    expect(router.replace).toHaveBeenLastCalledWith('/marketplace/dashboard?state=paused&format=auction', {
      scroll: false,
    });
  });

  it('writes the search text after a pause, not on every keystroke', () => {
    const { result } = renderHook(() => useListingTableQuery());

    act(() => result.current.setSearchText('b'));
    act(() => result.current.setSearchText('bo'));
    act(() => result.current.setSearchText('boo'));
    expect(result.current.searchText).toBe('boo');
    expect(router.replace).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/marketplace/dashboard?q=boo', { scroll: false });
  });

  it('clears every filter and the search box but keeps the sort', () => {
    url.params = new URLSearchParams('state=paused&source=shopify&q=boots&sort=title');
    const { result } = renderHook(() => useListingTableQuery());

    act(() => result.current.clearFilters());

    expect(result.current.searchText).toBe('');
    expect(router.replace).toHaveBeenCalledWith('/marketplace/dashboard?sort=title', { scroll: false });
  });

  it('follows the URL when it changes under the search box, as on the back button', () => {
    url.params = new URLSearchParams('q=boots');
    const { result, rerender } = renderHook(() => useListingTableQuery());

    url.params = new URLSearchParams('q=lamp');
    rerender();

    expect(result.current.searchText).toBe('lamp');
  });
});
