import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_STORE_ROLES_RETRY_BASE_MS, CHAT_STORE_ROLES_RETRY_MAX_MS } from '@/config/chat';
import { ChatController } from '@/controllers/chat/chat';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useChatStore } from '@/stores/chat/chat.store';
import { setStoreSeller } from '@/test-utils/store-mode';
import { useStoreThreadRoles } from './useStoreThreadRoles';

const roles = {
  viewer: 'a'.repeat(52),
  soldTo: ['b'.repeat(52)],
  boughtFrom: [],
  soldOrderIds: ['order-1'],
  boughtOrderIds: [],
  listingSides: {},
};

const STORE_SELLER = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u';

describe('useStoreThreadRoles', () => {
  beforeEach(() => {
    setStoreSeller(STORE_SELLER);
  });

  afterEach(() => {
    setStoreSeller(undefined);
    useChatStore.getState().reset();
    useAuthStore.setState({ currentUserPubky: null });
    vi.restoreAllMocks();
  });

  it('asks for the roles once signed in and returns them once read', async () => {
    const fetch = vi.spyOn(ChatController, 'fetchStoreThreadRoles').mockResolvedValue(null);
    const { result, rerender } = renderHook(() => useStoreThreadRoles());
    expect(fetch).not.toHaveBeenCalled();

    act(() => useAuthStore.setState({ currentUserPubky: 'y'.repeat(52) }));
    rerender();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current).toBeNull();

    act(() => useChatStore.getState().setStoreThreadRoles(roles));
    expect(result.current).toEqual(roles);
  });

  it('reads nothing, and so never retries, outside store mode or for the store seller', async () => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(ChatController, 'fetchStoreThreadRoles').mockRejectedValue(new Error('orders are down'));
    for (const [storeSeller, viewer] of [
      [undefined, 'y'.repeat(52)],
      [STORE_SELLER, STORE_SELLER],
    ] as const) {
      setStoreSeller(storeSeller);
      useAuthStore.setState({ currentUserPubky: viewer });
      const { result, unmount } = renderHook(() => useStoreThreadRoles());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CHAT_STORE_ROLES_RETRY_MAX_MS);
      });
      expect(result.current).toBeNull();
      unmount();
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('retries a failed read with backoff until it succeeds, and stops on unmount', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .spyOn(ChatController, 'fetchStoreThreadRoles')
      .mockRejectedValueOnce(new Error('orders are down'))
      .mockRejectedValueOnce(new Error('orders are down'))
      .mockResolvedValue(roles);
    useAuthStore.setState({ currentUserPubky: 'y'.repeat(52) });

    const { result, unmount } = renderHook(() => useStoreThreadRoles());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_STORE_ROLES_RETRY_BASE_MS);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_STORE_ROLES_RETRY_BASE_MS * 2 - 1);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetch).toHaveBeenCalledTimes(3);

    fetch.mockRejectedValue(new Error('orders are down'));
    act(() => useAuthStore.setState({ currentUserPubky: 'z'.repeat(52) }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_STORE_ROLES_RETRY_MAX_MS);
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});
