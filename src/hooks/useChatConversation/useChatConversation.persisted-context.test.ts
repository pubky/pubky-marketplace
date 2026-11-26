import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/libs/error/error';
import { AuthErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { storeThreadRoles } from '@/pipes/commerce/store-seller-side';
import { useChatStore } from '@/stores/chat/chat.store';
import { useChatConversation } from './useChatConversation';

const PEER = 's'.repeat(52);

const mocks = vi.hoisted(() => ({
  commitOpenConversation: vi.fn(),
  getConversationShown: vi.fn(),
  liveQueryListeners: new Set<() => void>(),
}));

vi.mock('@/controllers/chat/chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/controllers/chat/chat')>()),
  ChatController: {
    commitOpenConversation: mocks.commitOpenConversation,
    commitRetryMessage: vi.fn(),
    fetchConversationUpdates: vi.fn().mockResolvedValue(undefined),
    commitFlushOutbox: vi.fn().mockResolvedValue(undefined),
    commitMarkRead: vi.fn().mockResolvedValue(undefined),
    fetchStoreThreadRoles: vi.fn().mockResolvedValue(null),
    getConversation: vi.fn().mockResolvedValue(null),
    getConversationShown: mocks.getConversationShown,
    getMessages: vi.fn().mockResolvedValue([]),
    getMessageCount: vi.fn().mockResolvedValue(0),
  },
}));
// Runs each query like Dexie does: on mount, when its deps change, and again when the tables it read change.
vi.mock('dexie-react-hooks', async () => {
  const { useEffect, useState } = await import('react');
  return {
    useLiveQuery: (query: () => Promise<unknown>, deps: unknown[] = []) => {
      const [value, setValue] = useState<unknown>(undefined);
      const [change, setChange] = useState(0);
      useEffect(() => {
        const listener = () => setChange((current) => current + 1);
        mocks.liveQueryListeners.add(listener);
        return () => {
          mocks.liveQueryListeners.delete(listener);
        };
      }, []);
      useEffect(() => {
        let current = true;
        void query().then((result) => {
          if (current) setValue(result);
        });
        return () => {
          current = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mirrors the deps useLiveQuery receives
      }, [...deps, change]);
      return value;
    },
  };
});
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: 'm'.repeat(52) }),
}));
vi.mock('@/libs/logger/logger', () => ({ Logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

const storeRefusal = () =>
  new AppError({
    category: ErrorCategory.Auth,
    code: AuthErrorCode.FORBIDDEN,
    message: 'Store thread closed',
    service: ErrorService.Local,
    operation: 'assertCanSellHere',
  });

/** A message stored in this thread changes its persisted context; the roles stay as they were. */
const storeMessageChangingContext = async (shown: boolean) => {
  mocks.getConversationShown.mockResolvedValue(shown);
  await act(async () => {
    for (const listener of mocks.liveQueryListeners) listener();
  });
};

describe('useChatConversation with a persisted context that changes while the thread is open', () => {
  beforeEach(() => {
    mocks.commitOpenConversation.mockReset();
    mocks.getConversationShown.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    useChatStore.getState().reset();
  });

  it('closes an open purchase thread when a sale-order message arrives, and opens it again when it is a purchase again', async () => {
    const roles = useChatStore.getState().storeThreadRoles;
    mocks.commitOpenConversation.mockResolvedValueOnce({ state: 'ready' });
    const { result } = renderHook(() => useChatConversation(PEER));
    await waitFor(() => expect(result.current.openState).toBe('ready'));
    await waitFor(() => expect(mocks.getConversationShown).toHaveBeenCalled());

    mocks.commitOpenConversation.mockRejectedValueOnce(storeRefusal());
    await storeMessageChangingContext(false);

    await waitFor(() => expect(result.current.openState).toBe('store_restricted'));
    expect(mocks.commitOpenConversation).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().storeThreadRoles).toBe(roles);

    mocks.commitOpenConversation.mockResolvedValueOnce({ state: 'ready' });
    await storeMessageChangingContext(true);

    await waitFor(() => expect(result.current.openState).toBe('ready'));
    expect(mocks.commitOpenConversation).toHaveBeenCalledTimes(3);
  });

  it('does not open the thread again for a message that leaves the access decision as it was', async () => {
    mocks.commitOpenConversation.mockResolvedValue({ state: 'ready' });
    const { result } = renderHook(() => useChatConversation(PEER));
    await waitFor(() => expect(result.current.openState).toBe('ready'));
    await waitFor(() => expect(mocks.getConversationShown).toHaveBeenCalled());

    await storeMessageChangingContext(true);
    await storeMessageChangingContext(true);

    expect(mocks.commitOpenConversation).toHaveBeenCalledTimes(1);
    expect(result.current.openState).toBe('ready');
  });

  it('opens with the route context only on mount and decides again without it', async () => {
    const route = { orderId: 'route-order' };
    mocks.commitOpenConversation.mockResolvedValue({ state: 'ready' });
    const { result } = renderHook(() => useChatConversation(PEER, route));
    await waitFor(() => expect(result.current.openState).toBe('ready'));
    await waitFor(() => expect(mocks.getConversationShown).toHaveBeenCalled());

    mocks.commitOpenConversation.mockRejectedValueOnce(storeRefusal());
    await storeMessageChangingContext(false);
    await waitFor(() => expect(result.current.openState).toBe('store_restricted'));
    await act(async () => {
      useChatStore.getState().setStoreThreadRoles(storeThreadRoles([], 'm'.repeat(52)));
    });
    await waitFor(() => expect(mocks.commitOpenConversation).toHaveBeenCalledTimes(3));

    expect(mocks.commitOpenConversation.mock.calls).toEqual([[PEER, route], [PEER], [PEER]]);
  });

  it('restricts the thread as soon as a sale message arrives, before the open decides', async () => {
    mocks.commitOpenConversation.mockResolvedValueOnce({ state: 'ready' });
    const { result } = renderHook(() => useChatConversation(PEER));
    await waitFor(() => expect(result.current.openState).toBe('ready'));
    await waitFor(() => expect(mocks.getConversationShown).toHaveBeenCalled());

    mocks.commitOpenConversation.mockReturnValueOnce(new Promise(() => undefined));
    await storeMessageChangingContext(false);

    expect(result.current.openState).toBe('store_restricted');
    expect(mocks.commitOpenConversation).toHaveBeenCalledTimes(2);
  });

  it('keeps a thread closed when a sale message overtakes a reopen held after a purchase message', async () => {
    mocks.commitOpenConversation.mockRejectedValueOnce(storeRefusal());
    mocks.getConversationShown.mockResolvedValue(false);
    const { result } = renderHook(() => useChatConversation(PEER));
    await waitFor(() => expect(result.current.openState).toBe('store_restricted'));
    await waitFor(() => expect(mocks.getConversationShown).toHaveBeenCalled());

    let finishReopen: (value: { state: 'ready' }) => void = () => undefined;
    mocks.commitOpenConversation.mockReturnValueOnce(
      new Promise((resolve) => {
        finishReopen = resolve;
      }),
    );
    await storeMessageChangingContext(true);
    mocks.commitOpenConversation.mockRejectedValueOnce(storeRefusal());
    await storeMessageChangingContext(false);
    expect(result.current.openState).toBe('store_restricted');

    await act(async () => {
      finishReopen({ state: 'ready' });
      await Promise.resolve();
    });

    expect(result.current.openState).toBe('store_restricted');
    expect(mocks.commitOpenConversation.mock.calls).toEqual([[PEER, undefined], [PEER], [PEER]]);
  });

  it('takes the first answer for another peer as its baseline', async () => {
    const OTHER = 'o'.repeat(52);
    mocks.commitOpenConversation.mockResolvedValue({ state: 'ready' });
    mocks.getConversationShown.mockImplementation(async (peer: string) => peer === PEER);
    const { result, rerender } = renderHook(({ peer }) => useChatConversation(peer), {
      initialProps: { peer: PEER },
    });
    await waitFor(() => expect(result.current.openState).toBe('ready'));
    await waitFor(() => expect(mocks.getConversationShown).toHaveBeenCalledWith(PEER));

    rerender({ peer: OTHER });
    await waitFor(() => expect(mocks.getConversationShown).toHaveBeenCalledWith(OTHER));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.commitOpenConversation.mock.calls).toEqual([
      [PEER, undefined],
      [OTHER, undefined],
    ]);
    expect(result.current.openState).toBe('ready');
  });
});
