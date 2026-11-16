import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatConversation } from './useChatConversation';

const PEER = 's'.repeat(52);

const mocks = vi.hoisted(() => ({
  commitOpenConversation: vi.fn(),
  commitRetryMessage: vi.fn(),
}));

vi.mock('@/controllers/chat/chat', () => ({
  ChatController: {
    commitOpenConversation: mocks.commitOpenConversation,
    commitRetryMessage: mocks.commitRetryMessage,
    fetchConversationUpdates: vi.fn().mockResolvedValue(undefined),
    commitFlushOutbox: vi.fn().mockResolvedValue(undefined),
    commitMarkRead: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => undefined }));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: 'm'.repeat(52) }),
}));
vi.mock('@/libs/logger/logger', () => ({ Logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

const signedOut = () => new DOMException('This operation was aborted', 'AbortError');

describe('useChatConversation', () => {
  beforeEach(() => {
    mocks.commitOpenConversation.mockReset();
    mocks.commitRetryMessage.mockReset();
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
