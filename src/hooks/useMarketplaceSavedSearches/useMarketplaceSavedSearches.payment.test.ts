import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { CommerceSavedSearchModelSchema, CommerceSavedSearchParams } from '@/models/commerce/commerce.schema';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { createCommerceCatalogEntryFixture } from '@/test/fixtures/commerce/commerce';
import { useMarketplaceSavedSearches } from './useMarketplaceSavedSearches';

const OWNER = 'o'.repeat(52);
const ACCEPTING = 'a'.repeat(52);
const OTHER = 'b'.repeat(52);

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => [] }));
vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return {
    ...actual,
    COMMERCE_SAVED_SEARCH_CHECK_MAX: 10,
    COMMERCE_WATCH_CHECK_MIN_INTERVAL_MS: 60_000,
    getCommerceAdapterMode: () => 'transaction-service',
  };
});
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) => selector({ currentUserPubky: OWNER }),
}));
vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getSavedSearches: vi.fn(async () => []),
    getAllListings: vi.fn(async () => []),
    getAllCatalogEntries: vi.fn(async () => []),
    commitCreateSavedSearch: vi.fn(async () => {}),
    commitDeleteSavedSearch: vi.fn(),
    acknowledgeSavedSearch: vi.fn(async () => {}),
    fetchCatalogListings: vi.fn(async () => {}),
    fetchPaymentMethodCatalog: vi.fn(),
    recordSavedSearchCheck: vi.fn(async () => {}),
  },
}));
vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

const controller = vi.mocked(CommerceController);
const acceptingEntry = createCommerceCatalogEntryFixture({
  id: `${ACCEPTING}:boots_01`,
  seller_id: ACCEPTING,
  updated_at: 5_000,
});
const otherEntry = createCommerceCatalogEntryFixture({
  id: `${OTHER}:boots_02`,
  seller_id: OTHER,
  listing_id: 'boots_02',
  updated_at: 9_000,
});

function savedSearch(id: string, overrides: Partial<CommerceSavedSearchParams>): CommerceSavedSearchModelSchema {
  return {
    id,
    owner_id: OWNER,
    name: id,
    params: {
      query: '',
      categoryId: null,
      saleFormat: 'all',
      conditions: [],
      minimumPriceMinor: null,
      maximumPriceMinor: null,
      sort: 'newest',
      ...overrides,
    },
    watermark_updated_at: 0,
    latest_match_updated_at: 0,
    new_count: 0,
    last_checked_at: null,
    created_at: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCommerceStore.getState().reset();
  controller.getAllCatalogEntries.mockResolvedValue([acceptingEntry, otherEntry]);
});

// The check pass is spaced per account per session, so only the first test here runs it.
describe('useMarketplaceSavedSearches with a payment method', () => {
  it('counts a payment search only over sellers in the fresh set, and skips a method it cannot read', async () => {
    controller.getSavedSearches.mockResolvedValue([
      savedSearch('paypal-search', { paymentMethod: 'paypal' }),
      savedSearch('usdt-search', { paymentMethod: 'usdt' }),
      savedSearch('any-search', {}),
    ]);
    controller.fetchPaymentMethodCatalog.mockImplementation(async (method) => {
      if (method === 'usdt') throw new TypeError('offline');
      return [ACCEPTING];
    });

    renderHook(() => useMarketplaceSavedSearches());

    await waitFor(() => expect(controller.recordSavedSearchCheck).toHaveBeenCalledTimes(2));
    const checks = new Map(controller.recordSavedSearchCheck.mock.calls.map(([id, check]) => [id, check]));
    expect(checks.get('paypal-search')).toMatchObject({ newCount: 1, latestMatchUpdatedAt: 5_000 });
    expect(checks.get('any-search')).toMatchObject({ newCount: 2, latestMatchUpdatedAt: 9_000 });
    expect(checks.has('usdt-search')).toBe(false);
    expect(controller.fetchPaymentMethodCatalog).toHaveBeenCalledWith('paypal', {
      saleFormat: 'all',
      conditions: [],
      sort: 'newest',
    });
  });

  it('saves the active payment method with a watermark over its remembered seller set', async () => {
    controller.getSavedSearches.mockResolvedValue([]);
    useCommerceStore.getState().setPaymentMethod('paypal');
    useCommerceStore.getState().setPaymentMethodSellers('paypal', [ACCEPTING]);
    const { result } = renderHook(() => useMarketplaceSavedSearches());

    await act(async () => {
      await result.current.saveCurrentSearch('paypal boots');
    });

    expect(controller.commitCreateSavedSearch).toHaveBeenCalledWith(
      'paypal boots',
      expect.objectContaining({ paymentMethod: 'paypal' }),
      5_000,
    );
  });

  it('treats every current match as seen when the seller set is not known yet', async () => {
    controller.getSavedSearches.mockResolvedValue([]);
    useCommerceStore.getState().setPaymentMethod('bitcoin');
    const { result } = renderHook(() => useMarketplaceSavedSearches());

    await act(async () => {
      await result.current.saveCurrentSearch('bitcoin boots');
    });

    expect(controller.commitCreateSavedSearch).toHaveBeenCalledWith(
      'bitcoin boots',
      expect.objectContaining({ paymentMethod: 'bitcoin' }),
      9_000,
    );
  });

  it('restores the payment method when a search is applied', async () => {
    controller.getSavedSearches.mockResolvedValue([]);
    const { result } = renderHook(() => useMarketplaceSavedSearches());

    await act(async () => {
      await result.current.applySearch(savedSearch('usdt-search', { paymentMethod: 'usdt' }));
    });
    expect(useCommerceStore.getState().paymentMethod).toBe('usdt');

    await act(async () => {
      await result.current.applySearch(savedSearch('legacy', {}));
    });
    expect(useCommerceStore.getState().paymentMethod).toBeNull();
  });
});
