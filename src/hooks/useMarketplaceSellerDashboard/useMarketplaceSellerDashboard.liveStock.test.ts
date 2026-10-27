import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { LocalCommerceService } from '@/core/services/local/commerce/commerce';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { COMMERCE_FIXTURE_SELLER, createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { createListingProjectionFixture } from '@/test/fixtures/commerce/projections';
import { useMarketplaceSellerDashboard } from './useMarketplaceSellerDashboard';

vi.mock('@/config/commerce', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/commerce')>()),
  getCommerceAdapterMode: () => 'transaction-service',
}));

vi.mock('@/hooks/useMeasurementSystem/useMeasurementSystem', () => ({
  useMeasurementSystem: () => 'metric',
}));

vi.mock('@/hooks/useMarketplaceOrders/useMarketplaceOrders', () => ({
  useMarketplaceOrders: () => ({ orders: [], isLoading: false, needsSession: false, error: null }),
}));

vi.mock('@/hooks/useMarketplaceOffers/useMarketplaceOffers', () => ({
  useMarketplaceOffers: () => ({ offers: [], isLoading: false, needsSession: false, error: null }),
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

describe('useMarketplaceSellerDashboard stock from the local database', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUserPubky: COMMERCE_FIXTURE_SELLER });
    useCommerceStore.setState({
      marketplaceSession: {
        pubky: COMMERCE_FIXTURE_SELLER,
        capabilities: '/pub/pubky.app/:rw',
        issuedAt: '2026-10-15T00:00:00.000Z',
        expiresAt: '2026-11-15T00:00:00.000Z',
      },
    });
    vi.spyOn(CommerceController, 'refreshListingsBySeller').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a sold listing's service count as soon as the service answers, without a reload", async () => {
    const record = createCommerceListingFixture({ listingId: 'cage_01' });
    await LocalCommerceService.upsertListing(record, 'synced');
    vi.spyOn(CommerceController, 'getMarketplaceListingProjection').mockResolvedValue(
      createListingProjectionFixture({
        aggregateId: `listing:${COMMERCE_FIXTURE_SELLER}_cage_01`,
        sellerPubky: COMMERCE_FIXTURE_SELLER,
        listingId: 'cage_01',
        listingRevision: record.revision,
        state: 'sold',
        availableQuantity: 0,
      }),
    );

    const { result } = renderHook(() => useMarketplaceSellerDashboard());

    await waitFor(() => expect(result.current.listings).toHaveLength(1));
    await waitFor(() => expect(result.current.listingStockLabel(result.current.listings[0])).toBe('0'));
    expect(result.current.metrics.totalInventory).toBe(0);
  });
});
