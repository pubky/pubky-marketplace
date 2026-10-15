import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useMarketplacePublicAvailability } from './useMarketplacePublicAvailability';

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
    serverTime: '2026-10-13T07:45:00.000Z',
    ...(variants ? { variants } : {}),
  };
}

describe('useMarketplacePublicAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.mode = 'transaction-service';
    vi.mocked(CommerceController.getPublicListingAvailability).mockResolvedValue(availability('reserved'));
  });

  it('reads the public stock state while enabled', async () => {
    const { result } = renderHook(() => useMarketplacePublicAvailability(SELLER, 'item', true));

    await waitFor(() => expect(result.current).toEqual({ state: 'reserved', variants: [] }));
    expect(CommerceController.getPublicListingAvailability).toHaveBeenCalledWith(SELLER, 'item');
  });

  it('carries the per-size sold-out flags of a variant-tracked listing', async () => {
    vi.mocked(CommerceController.getPublicListingAvailability).mockResolvedValue(
      availability('available', [
        { variantId: 'size_s', soldOut: true },
        { variantId: 'size_m', soldOut: false },
      ]),
    );

    const { result } = renderHook(() => useMarketplacePublicAvailability(SELLER, 'item', true));

    await waitFor(() =>
      expect(result.current).toEqual({
        state: 'available',
        variants: [
          { variantId: 'size_s', soldOut: true },
          { variantId: 'size_m', soldOut: false },
        ],
      }),
    );
  });

  it('reads nothing while disabled', async () => {
    const { result } = renderHook(() => useMarketplacePublicAvailability(SELLER, 'item', false));

    await Promise.resolve();
    expect(result.current).toBeNull();
    expect(CommerceController.getPublicListingAvailability).not.toHaveBeenCalled();
  });

  it('reads nothing outside a durable mode', async () => {
    config.mode = 'sandbox';

    const { result } = renderHook(() => useMarketplacePublicAvailability(SELLER, 'item', true));

    await Promise.resolve();
    expect(result.current).toBeNull();
    expect(CommerceController.getPublicListingAvailability).not.toHaveBeenCalled();
  });

  it('is null for an unknown listing and when the read fails', async () => {
    vi.mocked(CommerceController.getPublicListingAvailability).mockResolvedValueOnce(null);
    const unknown = renderHook(() => useMarketplacePublicAvailability(SELLER, 'item', true));
    await waitFor(() => expect(CommerceController.getPublicListingAvailability).toHaveBeenCalledTimes(1));
    expect(unknown.result.current).toBeNull();

    vi.mocked(CommerceController.getPublicListingAvailability).mockRejectedValueOnce(new Error('offline'));
    const failed = renderHook(() => useMarketplacePublicAvailability(SELLER, 'item', true));
    await waitFor(() => expect(CommerceController.getPublicListingAvailability).toHaveBeenCalledTimes(2));
    expect(failed.result.current).toBeNull();
  });

  it('drops the hold once the viewer has a session again', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useMarketplacePublicAvailability(SELLER, 'item', enabled),
      {
        initialProps: { enabled: true },
      },
    );
    await waitFor(() => expect(result.current).toEqual({ state: 'reserved', variants: [] }));

    rerender({ enabled: false });

    expect(result.current).toBeNull();
  });

  it('re-reads on window focus so a lapsed hold clears', async () => {
    const { result } = renderHook(() => useMarketplacePublicAvailability(SELLER, 'item', true));
    await waitFor(() => expect(result.current).toEqual({ state: 'reserved', variants: [] }));
    vi.mocked(CommerceController.getPublicListingAvailability).mockResolvedValue(availability('available'));

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(result.current).toBe('available'));
  });

  it("does not show one listing's hold on another listing", async () => {
    const { result, rerender } = renderHook(({ id }) => useMarketplacePublicAvailability(SELLER, id, true), {
      initialProps: { id: 'item' },
    });
    await waitFor(() => expect(result.current).toEqual({ state: 'reserved', variants: [] }));
    vi.mocked(CommerceController.getPublicListingAvailability).mockReturnValue(new Promise(() => {}));

    rerender({ id: 'other' });

    expect(result.current).toBeNull();
  });
});
