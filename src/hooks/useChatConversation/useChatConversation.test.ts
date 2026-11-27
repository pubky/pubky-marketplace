import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_OPEN_THREAD_POLL_MS } from '@/config/chat';
import { AppError } from '@/libs/error/error';
import { AuthErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { storeThreadRoles } from '@/pipes/commerce/store-seller-side';
import { useChatStore } from '@/stores/chat/chat.store';
import { useChatConversation } from './useChatConversation';

const PEER = 's'.repeat(52);

const mocks = vi.hoisted(() => ({
  commitOpenConversation: vi.fn(),
  commitRetryMessage: vi.fn(),
  fetchConversationUpdates: vi.fn(),
}));

vi.mock('@/controllers/chat/chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/controllers/chat/chat')>()),
  ChatController: {
    commitOpenConversation: mocks.commitOpenConversation,
    commitRetryMessage: mocks.commitRetryMessage,
    fetchConversationUpdates: mocks.fetchConversationUpdates,
    commitFlushOutbox: vi.fn().mockResolvedValue(undefined),
    commitMarkRead: vi.fn().mockResolvedValue(undefined),
    fetchStoreThreadRoles: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => undefined }));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: 'm'.repeat(52) }),
}));
vi.mock('@/libs/logger/logger', () => ({ Logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

const signedOut = () => new DOMException('This operation was aborted', 'AbortError');
const storeRefusal = () =>
  new AppError({
    category: ErrorCategory.Auth,
    code: AuthErrorCode.FORBIDDEN,
    message: 'Store thread closed',
    service: ErrorService.Local,
    operation: 'assertCanSellHere',
  });

describe('useChatConversation', () => {
  beforeEach(() => {
    mocks.commitOpenConversation.mockReset();
    mocks.commitRetryMessage.mockReset();
    mocks.fetchConversationUpdates.mockReset().mockResolvedValue(undefined);
  });

  it('does not report the peer as not set up when opening is cancelled by a sign-out', async () => {
    mocks.commitOpenConversation.mockRejectedValue(signedOut());

    const { result } = renderHook(() => useChatConversation(PEER));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.commitOpenConversation).toHaveBeenCalledOnce();
    expect(result.current.openState).toBe('opening');
  });

  it('still reports the peer as not set up when opening fails', async () => {
    mocks.commitOpenConversation.mockRejectedValue(new Error('inbox unavailable'));

    const { result } = renderHook(() => useChatConversation(PEER));

    await waitFor(() => expect(result.current.openState).toBe('peer_not_enabled'));
  });

  it('reports a store restriction and does not keep refreshing the thread', async () => {
    vi.useFakeTimers();
    try {
      mocks.commitOpenConversation.mockRejectedValue(storeRefusal());
      const { result } = renderHook(() => useChatConversation(PEER));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.openState).toBe('store_restricted');

      mocks.fetchConversationUpdates.mockClear();
      await act(async () => {
        vi.advanceTimersByTime(CHAT_OPEN_THREAD_POLL_MS * 2);
        window.dispatchEvent(new Event('focus'));
      });

      expect(mocks.fetchConversationUpdates).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens a restricted thread again when new roles arrive and stays closed while they close it', async () => {
    mocks.commitOpenConversation.mockRejectedValueOnce(storeRefusal());
    const { result } = renderHook(() => useChatConversation(PEER));
    await waitFor(() => expect(result.current.openState).toBe('store_restricted'));

    mocks.commitOpenConversation.mockRejectedValueOnce(storeRefusal());
    await act(async () => {
      useChatStore.getState().setStoreThreadRoles(storeThreadRoles([], 'm'.repeat(52)));
    });
    await waitFor(() => expect(mocks.commitOpenConversation).toHaveBeenCalledTimes(2));
    expect(result.current.openState).toBe('store_restricted');

    mocks.commitOpenConversation.mockResolvedValueOnce({ state: 'ready' });
    await act(async () => {
      useChatStore.getState().setStoreThreadRoles(storeThreadRoles([], 'm'.repeat(52)));
    });
    await waitFor(() => expect(result.current.openState).toBe('ready'));
    useChatStore.getState().setStoreThreadRoles(null);
  });

  it('closes an open thread when roles arrive that make it a sale', async () => {
    mocks.commitOpenConversation.mockResolvedValueOnce({ state: 'ready' });
    const { result } = renderHook(() => useChatConversation(PEER));
    await waitFor(() => expect(result.current.openState).toBe('ready'));

    mocks.commitOpenConversation.mockRejectedValueOnce(storeRefusal());
    await act(async () => {
      useChatStore.getState().setStoreThreadRoles(storeThreadRoles([], 'm'.repeat(52)));
    });

    await waitFor(() => expect(result.current.openState).toBe('store_restricted'));
    useChatStore.getState().setStoreThreadRoles(null);
  });

  it('ignores an open that finishes after a newer open decided the thread is closed', async () => {
    let finishFirst: (result: { state: 'ready' }) => void = () => undefined;
    mocks.commitOpenConversation.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFirst = resolve;
      }),
    );
    const { result } = renderHook(() => useChatConversation(PEER));

    mocks.commitOpenConversation.mockRejectedValueOnce(storeRefusal());
    await act(async () => {
      useChatStore.getState().setStoreThreadRoles(storeThreadRoles([], 'm'.repeat(52)));
    });
    await waitFor(() => expect(result.current.openState).toBe('store_restricted'));

    await act(async () => {
      finishFirst({ state: 'ready' });
      await Promise.resolve();
    });

    expect(result.current.openState).toBe('store_restricted');
    useChatStore.getState().setStoreThreadRoles(null);
  });

  it('settles a retry cancelled by a sign-out without an error', async () => {
    mocks.commitOpenConversation.mockResolvedValue({ state: 'peer_not_enabled' });
    mocks.commitRetryMessage.mockRejectedValue(signedOut());

    const { result } = renderHook(() => useChatConversation(PEER));

    await expect(result.current.retryMessage('message-1')).resolves.toBeUndefined();
  });

  it('still rejects a retry that fails', async () => {
    mocks.commitOpenConversation.mockResolvedValue({ state: 'peer_not_enabled' });
    mocks.commitRetryMessage.mockRejectedValue(new Error('message missing'));

    const { result } = renderHook(() => useChatConversation(PEER));

    await expect(result.current.retryMessage('message-1')).rejects.toThrow('message missing');
  });
});
