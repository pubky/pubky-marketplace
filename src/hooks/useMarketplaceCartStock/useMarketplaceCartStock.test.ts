import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useMarketplaceCartStock } from './useMarketplaceCartStock';

const SELLER = 'y'.repeat(52);
const config = vi.hoisted(() => ({ mode: 'transaction-service' as string }));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => config.mode, getCommercePollIntervalMs: () => 60_000 };
});

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { getPublicListingAvailability: vi.fn() },
}));

function availability(state: 'available' | 'reserved' | 'sold', variants?: { variantId: string; soldOut: boolean }[]) {
  return {
    aggregateId: `listing:${SELLER}_item`,
    state,
    serverTime: '2026-10-16T09:00:00.000Z',
    ...(variants ? { variants } : {}),
  };
}

function line(id: string, listingId: string, variantId: string) {
  return {
    id,
    variantId,
    listing: {
      record: {
        ownerPubky: SELLER,
        listingId,
        variants: [
          { id: 'size_s', options: { size: 'S' }, quantity: 2, mediaIds: [], enabled: true },
          { id: 'size_m', options: { size: 'M' }, quantity: 2, mediaIds: [], enabled: true },
        ],
      },
    },
  };
}

describe('useMarketplaceCartStock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.mode = 'transaction-service';
  });

  it('reads each listing in the cart once and names the sold-out lines', async () => {
    vi.mocked(CommerceController.getPublicListingAvailability).mockImplementation(async (_seller, listingId) =>
      Promise.resolve(
        listingId === 'boots'
          ? availability('sold')
          : availability('available', [
              { variantId: 'size_s', soldOut: true },
              { variantId: 'size_m', soldOut: false },
            ]),
      ),
    );
    const items = [
      line('a', 'boots', 'size_s'),
      line('b', 'boots', 'size_m'),
      line('c', 'shirt', 'size_s'),
      line('d', 'shirt', 'size_m'),
    ];

    const { result } = renderHook(() => useMarketplaceCartStock(items));

    await waitFor(() => expect(result.current.hasSoldOut).toBe(true));
    expect(result.current.stockFor('a')).toBe('listing_sold_out');
    expect(result.current.stockFor('b')).toBe('listing_sold_out');
    expect(result.current.stockFor('c')).toBe('variant_sold_out');
    expect(result.current.stockFor('d')).toBeNull();
    expect(CommerceController.getPublicListingAvailability).toHaveBeenCalledTimes(2);
  });

  it('keeps the last answer when a later read fails', async () => {
    vi.mocked(CommerceController.getPublicListingAvailability).mockResolvedValueOnce(availability('sold'));
    const items = [line('a', 'boots', 'size_s')];

    const { result } = renderHook(() => useMarketplaceCartStock(items));
    await waitFor(() => expect(result.current.stockFor('a')).toBe('listing_sold_out'));

    vi.mocked(CommerceController.getPublicListingAvailability).mockRejectedValueOnce(new Error('offline'));
    act(() => result.current.refresh());

    await waitFor(() => expect(CommerceController.getPublicListingAvailability).toHaveBeenCalledTimes(2));
    expect(result.current.stockFor('a')).toBe('listing_sold_out');
  });

  it('reads again on refresh and clears a line that is back in stock', async () => {
    vi.mocked(CommerceController.getPublicListingAvailability).mockResolvedValueOnce(availability('sold'));
    const items = [line('a', 'boots', 'size_s')];

    const { result } = renderHook(() => useMarketplaceCartStock(items));
    await waitFor(() => expect(result.current.hasSoldOut).toBe(true));

    vi.mocked(CommerceController.getPublicListingAvailability).mockResolvedValueOnce(availability('available'));
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.hasSoldOut).toBe(false));
  });

  it('reads nothing outside a durable mode', async () => {
    config.mode = 'sandbox';

    const { result } = renderHook(() => useMarketplaceCartStock([line('a', 'boots', 'size_s')]));

    await Promise.resolve();
    expect(result.current.hasSoldOut).toBe(false);
    expect(CommerceController.getPublicListingAvailability).not.toHaveBeenCalled();
  });
});
