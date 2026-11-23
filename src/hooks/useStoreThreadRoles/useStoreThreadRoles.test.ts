import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatController } from '@/controllers/chat/chat';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useChatStore } from '@/stores/chat/chat.store';
import { useStoreThreadRoles } from './useStoreThreadRoles';

const roles = { soldTo: ['b'.repeat(52)], boughtFrom: [], soldOrderIds: ['order-1'], boughtOrderIds: [] };

describe('useStoreThreadRoles', () => {
  afterEach(() => {
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

  it('swallows a failed read, leaving the roles unknown', async () => {
    vi.spyOn(ChatController, 'fetchStoreThreadRoles').mockRejectedValue(new Error('orders are down'));
    useAuthStore.setState({ currentUserPubky: 'y'.repeat(52) });

    const { result } = renderHook(() => useStoreThreadRoles());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current).toBeNull();
  });
});
