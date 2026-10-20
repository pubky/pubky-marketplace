import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { MarketplaceListingProjection } from '@/services/marketplace/marketplace';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { useMarketplaceLiveBid } from './useMarketplaceLiveBid';

const config = vi.hoisted(() => ({ mode: 'transaction-service' }));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => config.mode };
});

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getMarketplaceListingProjection: vi.fn(),
  },
}));

let intersectionCallback: ((entries: IntersectionObserverEntry[]) => void) | null = null;
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();

class MockIntersectionObserver {
  constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
    intersectionCallback = callback;
  }

  observe = mockObserve;
  unobserve = vi.fn();
  disconnect = mockDisconnect;
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});

Object.defineProperty(global, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});

const SELLER = 'y'.repeat(52);

function auctionProjection(overrides: Partial<NonNullable<MarketplaceListingProjection['auction']>> = {}) {
  return {
    aggregateId: `listing:${SELLER}_camera`,
    sellerPubky: SELLER,
    listingId: 'camera',
    serverRevision: 3,
    state: 'available',
    availableQuantity: 1,
    reservedQuantity: 0,
    unitPrice: { amountMinor: 4_500, currency: 'USD', exponent: 2 },
    saleFormat: 'auction',
    auction: {
      startsAt: '2026-08-19T20:00:00.000Z',
      endsAt: '2026-08-29T20:00:00.000Z',
      minimumIncrement: { amountMinor: 500, currency: 'USD', exponent: 2 },
      currentPrice: { amountMinor: 7_500, currency: 'USD', exponent: 2 },
      leaderPubky: null,
      bidCount: 4,
      ...overrides,
    },
  } as MarketplaceListingProjection;
}

function attachAndShow(ref: (node: HTMLElement | null) => void) {
  act(() => {
    ref(document.createElement('div'));
  });
  act(() => {
    intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry]);
  });
}

describe('useMarketplaceLiveBid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intersectionCallback = null;
    useCommerceStore.getState().reset();
    config.mode = 'transaction-service';
    vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue(auctionProjection());
  });

  it('fetches live bid state once the card becomes visible in transaction-service mode', async () => {
    const { result } = renderHook(() => useMarketplaceLiveBid(SELLER, 'camera', true));

    expect(result.current.bid).toBeNull();
    expect(CommerceController.getMarketplaceListingProjection).not.toHaveBeenCalled();

    attachAndShow(result.current.ref);

    await waitFor(() =>
      expect(result.current.bid).toEqual({
        currentPrice: { amountMinor: 7_500, currency: 'USD', exponent: 2 },
        bidCount: 4,
      }),
    );
    expect(CommerceController.getMarketplaceListingProjection).toHaveBeenCalledExactlyOnceWith(SELLER, 'camera');
  });

  it('reports sold out when every size is sold out, and not while one has stock', async () => {
    const withVariants = (soldOut: boolean[]) =>
      ({
        ...auctionProjection(),
        auction: null,
        saleFormat: 'fixed_price',
        variants: soldOut.map((value, index) => ({ variantId: `size_${index}`, soldOut: value })),
      }) as MarketplaceListingProjection;

    vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue(withVariants([true, true]));
    const allSold = renderHook(() => useMarketplaceLiveBid(SELLER, 'camera', true));
    attachAndShow(allSold.result.current.ref);
    await waitFor(() => expect(allSold.result.current.soldOut).toBe(true));
    expect(allSold.result.current.listingState).toBe('available');

    vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue(withVariants([true, false]));
    const someLeft = renderHook(() => useMarketplaceLiveBid(SELLER, 'camera', true));
    attachAndShow(someLeft.result.current.ref);
    await waitFor(() => expect(someLeft.result.current.listingState).toBe('available'));
    expect(someLeft.result.current.soldOut).toBe(false);
  });

  it('fetches only once per card even across repeated visibility changes', async () => {
    const { result } = renderHook(() => useMarketplaceLiveBid(SELLER, 'camera', true));

    attachAndShow(result.current.ref);
    await waitFor(() => expect(result.current.bid).not.toBeNull());

    act(() => {
      intersectionCallback?.([{ isIntersecting: false } as IntersectionObserverEntry]);
    });
    act(() => {
      intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry]);
    });

    expect(CommerceController.getMarketplaceListingProjection).toHaveBeenCalledTimes(1);
  });

  describe('after the first read', () => {
    const fixedPrice = (overrides: Partial<MarketplaceListingProjection> = {}) =>
      ({
        ...auctionProjection(),
        auction: null,
        saleFormat: 'fixed_price',
        ...overrides,
      }) as MarketplaceListingProjection;

    it('re-reads when the listing is reported changed, so a sold item stops reading available', async () => {
      vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue(fixedPrice());
      const { result } = renderHook(() => useMarketplaceLiveBid(SELLER, 'camera', true));
      attachAndShow(result.current.ref);
      await waitFor(() => expect(result.current.listingState).toBe('available'));
      expect(result.current.soldOut).toBe(false);

      vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue(
        fixedPrice({ state: 'sold', availableQuantity: 0 }),
      );
      act(() => useCommerceStore.getState().refreshListingCards([`${SELLER}:camera`]));

      await waitFor(() => expect(result.current.listingState).toBe('sold'));
      expect(result.current.soldOut).toBe(true);
      expect(CommerceController.getMarketplaceListingProjection).toHaveBeenCalledTimes(2);
    });

    it('ignores a change reported for another listing', async () => {
      vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue(fixedPrice());
      const { result } = renderHook(() => useMarketplaceLiveBid(SELLER, 'camera', true));
      attachAndShow(result.current.ref);
      await waitFor(() => expect(result.current.listingState).toBe('available'));

      act(() => useCommerceStore.getState().refreshListingCards([`${SELLER}:lamp`]));

      expect(CommerceController.getMarketplaceListingProjection).toHaveBeenCalledTimes(1);
    });

    it('does not read a card that is off screen when its listing is reported changed', () => {
      const { result } = renderHook(() => useMarketplaceLiveBid(SELLER, 'camera', true));
      act(() => {
        result.current.ref(document.createElement('div'));
      });

      act(() => useCommerceStore.getState().refreshListingCards([`${SELLER}:camera`]));

      expect(CommerceController.getMarketplaceListingProjection).not.toHaveBeenCalled();
    });

    it('re-reads when the window regains focus, but not before the first read', async () => {
      vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue(fixedPrice());
      const { result } = renderHook(() => useMarketplaceLiveBid(SELLER, 'camera', true));
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
      expect(CommerceController.getMarketplaceListingProjection).not.toHaveBeenCalled();

      attachAndShow(result.current.ref);
      await waitFor(() => expect(result.current.listingState).toBe('available'));
      expect(CommerceController.getMarketplaceListingProjection).toHaveBeenCalledTimes(1);

      vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue(
        fixedPrice({ state: 'reserved', availableQuantity: 0 }),
      );
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });

      await waitFor(() => expect(result.current.listingState).toBe('reserved'));
    });

    it('keeps the newest answer when an older read resolves last', async () => {
      let resolveFirst: (projection: MarketplaceListingProjection) => void = () => {};
      vi.mocked(CommerceController.getMarketplaceListingProjection)
        .mockImplementationOnce(
          () =>
            new Promise<MarketplaceListingProjection>((resolve) => {
              resolveFirst = resolve;
            }),
        )
        .mockResolvedValueOnce(fixedPrice({ state: 'sold', availableQuantity: 0 }));
      const { result } = renderHook(() => useMarketplaceLiveBid(SELLER, 'camera', true));
      attachAndShow(result.current.ref);
      act(() => useCommerceStore.getState().refreshListingCards([`${SELLER}:camera`]));
      await waitFor(() => expect(result.current.listingState).toBe('sold'));

      await act(async () => resolveFirst(fixedPrice()));

      expect(result.current.listingState).toBe('sold');
    });
  });

  it('never fetches for off-screen cards', () => {
    const { result } = renderHook(() => useMarketplaceLiveBid(SELLER, 'camera', true));

    act(() => {
      result.current.ref(document.createElement('div'));
    });

    expect(CommerceController.getMarketplaceListingProjection).not.toHaveBeenCalled();
    expect(result.current.bid).toBeNull();
  });

  it.each(['sandbox', 'unavailable', 'locks-paykit'] as const)('stays inert in %s mode', (mode) => {
    config.mode = mode;
    const { result } = renderHook(() => useMarketplaceLiveBid(SELLER, 'camera', true));

    attachAndShow(result.current.ref);

    expect(mockObserve).not.toHaveBeenCalled();
    expect(CommerceController.getMarketplaceListingProjection).not.toHaveBeenCalled();
    expect(result.current.bid).toBeNull();
  });

  it('stays inert when disabled (non-auction cards)', () => {
    const { result } = renderHook(() => useMarketplaceLiveBid(SELLER, 'camera', false));

    attachAndShow(result.current.ref);

    expect(mockObserve).not.toHaveBeenCalled();
    expect(CommerceController.getMarketplaceListingProjection).not.toHaveBeenCalled();
  });

  it('degrades to a null bid when the transaction service is unreachable', async () => {
    vi.mocked(CommerceController.getMarketplaceListingProjection).mockRejectedValue(new Error('fetch failed'));
    const { result } = renderHook(() => useMarketplaceLiveBid(SELLER, 'camera', true));

    attachAndShow(result.current.ref);

    await waitFor(() => expect(CommerceController.getMarketplaceListingProjection).toHaveBeenCalled());
    expect(result.current.bid).toBeNull();
  });

  it('keeps a null bid when the projection is not registered or carries no auction', async () => {
    vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue(null);
    const { result } = renderHook(() => useMarketplaceLiveBid(SELLER, 'camera', true));

    attachAndShow(result.current.ref);

    await waitFor(() => expect(CommerceController.getMarketplaceListingProjection).toHaveBeenCalled());
    expect(result.current.bid).toBeNull();
    expect(result.current.listingState).toBeNull();
  });

  it('records reserved listing state for a visible fixed-price card', async () => {
    vi.mocked(CommerceController.getMarketplaceListingProjection).mockResolvedValue({
      ...auctionProjection(),
      saleFormat: 'fixed_price',
      state: 'reserved',
      auction: null,
    });
    const { result } = renderHook(() => useMarketplaceLiveBid(SELLER, 'boots', true));

    attachAndShow(result.current.ref);

    await waitFor(() => expect(result.current.listingState).toBe('reserved'));
    expect(result.current.bid).toBeNull();
  });
});
