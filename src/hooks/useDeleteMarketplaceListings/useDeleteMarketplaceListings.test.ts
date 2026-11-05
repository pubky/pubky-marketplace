import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUCTION_HAS_BIDS_MESSAGE, AUCTION_HAS_BIDS_REFUSAL } from '@/libs/commerce/auction-removal';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { toast } from '@/molecules/Toaster/use-toast';
import { useAuthStore } from '@/stores/auth/auth.store';
import { COMMERCE_FIXTURE_SELLER, createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { createAuctionProjectionFixture } from '@/test/fixtures/commerce/projections';
import { type ListingDeleteTarget, useDeleteMarketplaceListings } from './useDeleteMarketplaceListings';

const mode = vi.hoisted(() => ({ value: 'transaction-service' }));
const controller = vi.hoisted(() => ({
  commitDeleteListing: vi.fn(async (_owner: string, _listingId: string) => {}),
  getMarketplaceOrders: vi.fn(async () => [] as unknown[]),
  getMarketplaceListingProjection: vi.fn(async () => null as unknown),
}));

vi.mock('@/controllers/commerce/commerce', () => ({ CommerceController: controller }));
vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/config/commerce', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/commerce')>()),
  getCommerceAdapterMode: () => mode.value,
}));

const aggregateId = (listingId: string) => `listing:${COMMERCE_FIXTURE_SELLER}_${listingId}`;

function targetFor(listingId: string, overrides: Partial<ListingDeleteTarget['record']> = {}): ListingDeleteTarget {
  const record = createCommerceListingFixture({ listingId, ...overrides });
  return { ownerPubky: COMMERCE_FIXTURE_SELLER, listingId, title: `Listing ${listingId}`, record };
}

function auctionTarget(listingId: string): ListingDeleteTarget {
  const record = createCommerceListingFixture({ listingId });
  record.sale = {
    format: 'auction',
    startingPrice: { amountMinor: 4_500, currency: 'USD', exponent: 2 },
    minimumIncrement: { amountMinor: 500, currency: 'USD', exponent: 2 },
    startsAt: '2026-09-01T00:00:00.000Z',
    endsAt: '2099-01-01T00:00:00.000Z',
    antiSnipingWindowSeconds: 120,
    antiSnipingExtensionSeconds: 120,
  };
  return { ownerPubky: COMMERCE_FIXTURE_SELLER, listingId, title: `Auction ${listingId}`, record };
}

describe('useDeleteMarketplaceListings', () => {
  beforeEach(() => {
    mode.value = 'transaction-service';
    controller.commitDeleteListing.mockReset();
    controller.commitDeleteListing.mockResolvedValue(undefined);
    controller.getMarketplaceOrders.mockReset();
    controller.getMarketplaceOrders.mockResolvedValue([]);
    controller.getMarketplaceListingProjection.mockReset();
    controller.getMarketplaceListingProjection.mockResolvedValue(null);
    vi.mocked(toast).mockClear();
    useAuthStore.setState({ currentUserPubky: COMMERCE_FIXTURE_SELLER, session: {} as never });
  });

  it('opens on request and plans from the seller’s open orders on each listing', async () => {
    controller.getMarketplaceOrders.mockResolvedValue([
      { sellerPubky: COMMERCE_FIXTURE_SELLER, state: 'paid', lines: [{ listingAggregateId: aggregateId('one') }] },
      {
        sellerPubky: COMMERCE_FIXTURE_SELLER,
        state: 'pending_payment',
        lines: [{ listingAggregateId: aggregateId('one') }],
      },
      { sellerPubky: COMMERCE_FIXTURE_SELLER, state: 'completed', lines: [{ listingAggregateId: aggregateId('one') }] },
      { sellerPubky: COMMERCE_FIXTURE_SELLER, state: 'paid', lines: [{ listingAggregateId: aggregateId('other') }] },
    ]);
    const { result } = renderHook(() => useDeleteMarketplaceListings());

    await act(async () => {
      await result.current.request([targetFor('one')]);
    });

    expect(result.current.open).toBe(true);
    expect(result.current.plan).toMatchObject({ openOrders: 2, ordersChecked: true, blocked: [] });
  });

  it('flags an unknown open-order count when the orders cannot be read, and still lets the seller delete', async () => {
    controller.getMarketplaceOrders.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useDeleteMarketplaceListings());

    await act(async () => {
      await result.current.request([targetFor('one')]);
    });

    expect(result.current.plan).toMatchObject({ ordersChecked: false, openOrders: 0 });
    await act(async () => {
      await result.current.confirm();
    });
    expect(controller.commitDeleteListing).toHaveBeenCalledWith(COMMERCE_FIXTURE_SELLER, 'one');
  });

  it('does not read orders where there is no transaction service', async () => {
    mode.value = 'unavailable';
    const { result } = renderHook(() => useDeleteMarketplaceListings());

    await act(async () => {
      await result.current.request([targetFor('one')]);
    });

    expect(controller.getMarketplaceOrders).not.toHaveBeenCalled();
    expect(result.current.plan).toMatchObject({ openOrders: 0, ordersChecked: true });
  });

  it('holds back a live auction that has bids and deletes the rest', async () => {
    const base = createAuctionProjectionFixture();
    controller.getMarketplaceListingProjection.mockResolvedValue(
      createAuctionProjectionFixture({ auction: { ...base.auction!, bidCount: 2 } }),
    );
    const onDeleted = vi.fn();
    const { result } = renderHook(() => useDeleteMarketplaceListings({ onDeleted }));

    await act(async () => {
      await result.current.request([auctionTarget('auction'), targetFor('plain')]);
    });
    expect(result.current.plan?.blocked).toEqual([expect.objectContaining({ bids: 2 })]);

    await act(async () => {
      await result.current.confirm();
    });

    expect(controller.commitDeleteListing).toHaveBeenCalledTimes(1);
    expect(controller.commitDeleteListing).toHaveBeenCalledWith(COMMERCE_FIXTURE_SELLER, 'plain');
    expect(onDeleted).toHaveBeenCalledWith([`${COMMERCE_FIXTURE_SELLER}:plain`]);
    expect(result.current.open).toBe(false);
  });

  it('deletes every listing, toasts once, and reports the deleted keys', async () => {
    const onDeleted = vi.fn();
    const { result } = renderHook(() => useDeleteMarketplaceListings({ onDeleted }));
    await act(async () => {
      await result.current.request([targetFor('one'), targetFor('two')]);
    });

    await act(async () => {
      await result.current.confirm();
    });

    expect(controller.commitDeleteListing.mock.calls).toEqual([
      [COMMERCE_FIXTURE_SELLER, 'one'],
      [COMMERCE_FIXTURE_SELLER, 'two'],
    ]);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '2 listings deleted' }));
    expect(onDeleted).toHaveBeenCalledWith([`${COMMERCE_FIXTURE_SELLER}:one`, `${COMMERCE_FIXTURE_SELLER}:two`]);
  });

  it('reports a partial failure without hiding the listings that were deleted', async () => {
    controller.commitDeleteListing.mockImplementation(async (_owner, listingId) => {
      if (listingId === 'two') throw new Error('homeserver down');
    });
    const onDeleted = vi.fn();
    const { result } = renderHook(() => useDeleteMarketplaceListings({ onDeleted }));
    await act(async () => {
      await result.current.request([targetFor('one'), targetFor('two')]);
    });

    await act(async () => {
      await result.current.confirm();
    });

    expect(onDeleted).toHaveBeenCalledWith([`${COMMERCE_FIXTURE_SELLER}:one`]);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Listing deleted' }));
    expect(toast).toHaveBeenCalledWith({
      variant: 'error',
      description: 'Could not delete 1 of 2 listings. The others were deleted.',
    });
  });

  it('shows the bids refusal when a bid lands between the check and the delete', async () => {
    controller.commitDeleteListing.mockRejectedValue(
      Err.client(ClientErrorCode.CONFLICT, AUCTION_HAS_BIDS_MESSAGE, {
        service: ErrorService.Marketplace,
        operation: 'commitDeleteListing',
        context: { refusal: AUCTION_HAS_BIDS_REFUSAL, bidCount: 1 },
      }),
    );
    const onDeleted = vi.fn();
    const { result } = renderHook(() => useDeleteMarketplaceListings({ onDeleted }));
    await act(async () => {
      await result.current.request([targetFor('one')]);
    });

    await act(async () => {
      await result.current.confirm();
    });

    expect(toast).toHaveBeenCalledWith({ variant: 'error', description: AUCTION_HAS_BIDS_MESSAGE });
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('never deletes without a homeserver session', async () => {
    useAuthStore.setState({ session: null });
    const { result } = renderHook(() => useDeleteMarketplaceListings());
    await act(async () => {
      await result.current.request([targetFor('one')]);
    });

    await act(async () => {
      await result.current.confirm();
    });

    expect(result.current.hasHomeserverSession).toBe(false);
    expect(controller.commitDeleteListing).not.toHaveBeenCalled();
  });

  it('closes on cancel without deleting', async () => {
    const { result } = renderHook(() => useDeleteMarketplaceListings());
    await act(async () => {
      await result.current.request([targetFor('one')]);
    });

    act(() => result.current.cancel());

    await waitFor(() => expect(result.current.open).toBe(false));
    expect(controller.commitDeleteListing).not.toHaveBeenCalled();
  });
});
