import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToastOptions } from '@/molecules/Toaster/toast';
import { useMarketplaceCart } from './useMarketplaceCart';

const state = vi.hoisted(() => ({
  pubky: 'buyer',
  items: [] as unknown[],
  toast: vi.fn<(options: ToastOptions) => void>(),
  routerPush: vi.fn(),
  getCartItems: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  restoreAward: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.routerPush }) }));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => state.items }));
vi.mock('@/hooks/useRequireAuth/useRequireAuth', () => ({
  useRequireAuth: () => ({ requireAuth: (action: () => unknown) => action() }),
}));
vi.mock('@/molecules/Toaster/toast', () => ({ toast: state.toast }));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: Object.assign((selector: (value: unknown) => unknown) => selector({ currentUserPubky: state.pubky }), {
    getState: () => ({ currentUserPubky: state.pubky }),
  }),
}));
vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    commitDeleteCartItem: state.remove,
    getCartItems: state.getCartItems,
    commitUpsertCartItem: state.restore,
    commitUpsertAwardCartItem: state.restoreAward,
  },
}));

const item = {
  id: 'seller:boots:large',
  listingId: 'seller:boots',
  variantId: 'large',
  quantity: 3,
  listing: {
    record: {
      title: 'Boots',
      ownerPubky: 'seller',
      variants: [],
      sale: { format: 'fixed_price', unitPrice: { amountMinor: 1000, currency: 'USD', exponent: 2 } },
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  state.pubky = 'buyer';
  state.items = [item];
  state.getCartItems.mockResolvedValue([]);
  state.remove.mockResolvedValue(undefined);
});

async function removeItem(awardId?: string, showUndo = true) {
  const { result } = renderHook(() => useMarketplaceCart());
  await act(() => result.current.remove(item.listingId, item.variantId, awardId, showUndo));
  const action = state.toast.mock.calls.at(-1)?.[0].action;
  if (showUndo) expect(action).toBeDefined();
  return action?.onClick;
}

describe('cart removal undo', () => {
  it('offers five seconds to restore the removed item with its accessible description', async () => {
    await removeItem();
    expect(state.toast).toHaveBeenCalledExactlyOnceWith({
      title: 'Item removed',
      durationMs: 5_000,
      action: {
        label: 'Undo',
        altText: 'Restore Boots to cart',
        onClick: expect.any(Function),
      },
    });
    expect(state.restore).not.toHaveBeenCalled();
  });

  it('opens the cart only when the added-item action is selected', async () => {
    const { result } = renderHook(() => useMarketplaceCart());
    await act(() => result.current.add(item.listingId, item.variantId, 2));
    expect(state.restore).toHaveBeenCalledExactlyOnceWith(item.listingId, item.variantId, 2);
    expect(state.toast).toHaveBeenCalledExactlyOnceWith({
      title: 'Added to cart',
      action: { label: 'View cart', altText: 'View cart', onClick: expect.any(Function) },
    });
    expect(state.routerPush).not.toHaveBeenCalled();
    await act(() => state.toast.mock.calls[0]?.[0].action?.onClick());
    expect(state.routerPush).toHaveBeenCalledExactlyOnceWith('/marketplace/cart');
  });

  it('restores the original quantity only once', async () => {
    const undo = await removeItem();
    await act(() => undo?.());
    await act(() => undo?.());
    expect(state.restore).toHaveBeenCalledExactlyOnceWith(item.listingId, item.variantId, 3);
  });

  it('preserves accepted offer metadata', async () => {
    state.items = [{ ...item, awardId: 'award', awardOfferRevision: 7 }];
    const undo = await removeItem('award');
    await act(() => undo?.());
    expect(state.restoreAward).toHaveBeenCalledExactlyOnceWith(item.listingId, item.variantId, 3, 'award', 7);
    expect(state.restore).not.toHaveBeenCalled();
  });

  it('does not overwrite an item already added again', async () => {
    const undo = await removeItem();
    state.getCartItems.mockResolvedValue([{ id: item.id }]);
    await act(() => undo?.());
    expect(state.restore).not.toHaveBeenCalled();
  });

  it('does not restore into a different account', async () => {
    const undo = await removeItem();
    state.pubky = 'other-buyer';
    await act(() => undo?.());
    expect(state.restore).not.toHaveBeenCalled();
  });

  it('keeps automatic checkout cleanup silent', async () => {
    await removeItem(undefined, false);
    expect(state.remove).toHaveBeenCalled();
    expect(state.toast).not.toHaveBeenCalled();
  });

  it('shows an error without offering undo when deletion fails', async () => {
    state.remove.mockRejectedValueOnce('unavailable');
    const { result } = renderHook(() => useMarketplaceCart());
    await act(() => result.current.remove(item.listingId, item.variantId));
    expect(state.toast).toHaveBeenCalledWith({ variant: 'error', description: 'Could not remove this item.' });
    expect(state.restore).not.toHaveBeenCalled();
  });
});
