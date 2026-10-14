import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatController } from '@/controllers/chat/chat';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ChatSyncCoordinator } from '@/coordinators/chat-sync/chat-sync';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useChatStore } from '@/stores/chat/chat.store';
import { mockSession } from '@/test-utils/pubky';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';

const OWNER = 'o'.repeat(52);
const PEER = 'p'.repeat(52);

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => 'transaction-service' };
});

vi.mock('@/libs/runtime-config/runtime-config', async () => {
  const actual = await vi.importActual<typeof import('@/libs/runtime-config/runtime-config')>(
    '@/libs/runtime-config/runtime-config',
  );
  return { ...actual, getNotificationRespectPageVisibility: () => false };
});

function signIn(): void {
  useAuthStore.getState().init({ session: mockSession(), currentUserPubky: OWNER, hasProfile: true });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ChatSyncCoordinator', () => {
  let pingsCalls = 0;
  let resolvePings: ((pings: never[]) => void) | null = null;

  beforeEach(() => {
    installWebLocks();
    useAuthStore.getState().reset();
    useChatStore.getState().reset();
    pingsCalls = 0;
    vi.spyOn(ChatController, 'getOrFetchIdentity').mockResolvedValue('ready');
    vi.spyOn(ChatController, 'fetchRebuild').mockResolvedValue();
    vi.spyOn(ChatController, 'commitFlushOutbox').mockResolvedValue();
    vi.spyOn(ChatController, 'fetchAllConversationUpdates').mockResolvedValue();
    vi.spyOn(ChatController, 'fetchSeededConversations').mockResolvedValue();
    vi.spyOn(ChatController, 'getConversations').mockResolvedValue([]);
    vi.spyOn(ChatController, 'fetchInboxAvailability').mockResolvedValue('ready');
    vi.spyOn(ChatController, 'handleInboxPings').mockImplementation(async (pings) =>
      pings
        .filter((ping) => ping.slot.startsWith('chat-'))
        .map(({ sender, slot, revision }) => ({ sender, slot, revision })),
    );
    vi.spyOn(ChatController, 'commitAckInboxPings').mockResolvedValue();
    vi.spyOn(ChatController, 'fetchInboxPings').mockImplementation(
      () =>
        new Promise((resolve) => {
          pingsCalls += 1;
          resolvePings = resolve as never;
        }),
    );
    vi.spyOn(CommerceController, 'getMarketplaceOrders').mockResolvedValue([
      { buyerPubky: OWNER, sellerPubky: PEER },
    ] as never);
  });

  afterEach(() => {
    ChatSyncCoordinator.resetInstance();
    removeWebLocks();
    vi.restoreAllMocks();
  });

  it('does nothing signed out and sets up, leads and polls once signed in', async () => {
    const coordinator = ChatSyncCoordinator.getInstance();
    coordinator.setRoute('/marketplace');
    coordinator.start();
    await settle();
    expect(ChatController.getOrFetchIdentity).not.toHaveBeenCalled();
    expect(useChatStore.getState().isLeaderTab).toBe(false);

    signIn();
    await settle();
    expect(ChatController.getOrFetchIdentity).toHaveBeenCalled();
    expect(ChatController.fetchRebuild).toHaveBeenCalled();
    expect(useChatStore.getState().isLeaderTab).toBe(true);
    expect(ChatController.fetchSeededConversations).toHaveBeenCalledWith([PEER]);
    expect(ChatController.fetchAllConversationUpdates).toHaveBeenCalledWith('reconcile');
    expect(pingsCalls).toBe(1);
  });

  it('handles and acknowledges pings, then polls again', async () => {
    const coordinator = ChatSyncCoordinator.getInstance();
    coordinator.setRoute('/marketplace');
    coordinator.start();
    signIn();
    await settle();
    const ping = { sender: PEER, slot: 'chat-abc', revision: 'r', received_at: '', expires_at: '', payload: '' };
    resolvePings?.([ping] as never);
    await settle();
    expect(ChatController.handleInboxPings).toHaveBeenCalledWith([ping]);
    expect(ChatController.commitAckInboxPings).toHaveBeenCalledWith([
      { sender: PEER, slot: 'chat-abc', revision: 'r' },
    ]);
    expect(pingsCalls).toBe(2);
  });

  it('leaves pings it did not handle on the inbox and pauses instead of polling again at once', async () => {
    const coordinator = ChatSyncCoordinator.getInstance();
    coordinator.setRoute('/marketplace');
    coordinator.start();
    signIn();
    await settle();
    const foreign = { sender: PEER, slot: 'app-xyz', revision: 'r2', received_at: '', expires_at: '', payload: '' };
    resolvePings?.([foreign] as never);
    await settle();
    expect(ChatController.handleInboxPings).toHaveBeenCalledWith([foreign]);
    expect(ChatController.commitAckInboxPings).not.toHaveBeenCalled();
    expect(pingsCalls).toBe(1);
  });

  it('skips the inbox loop while the inbox is unavailable and keeps reconciling', async () => {
    vi.mocked(ChatController.fetchInboxAvailability).mockResolvedValue('disabled');
    const coordinator = ChatSyncCoordinator.getInstance();
    coordinator.setRoute('/marketplace');
    coordinator.start();
    signIn();
    await settle();
    expect(pingsCalls).toBe(0);
    expect(useChatStore.getState().inboxStatus).toBe('disabled');
    expect(ChatController.fetchAllConversationUpdates).toHaveBeenCalled();
  });

  it('replaces a live stream when the conversation set changes instead of running both', async () => {
    const subscriptions: ReadableStreamDefaultController[] = [];
    vi.spyOn(ChatController, 'fetchPeerHomeserver').mockResolvedValue('h'.repeat(52));
    vi.spyOn(ChatController, 'subscribeChatEventStream').mockImplementation(
      async () =>
        new ReadableStream({
          start(controller) {
            subscriptions.push(controller);
          },
        }),
    );
    const conversation = (peer: string) =>
      ({ peer_pubky: peer, peer_state: 'ready', folder_id: peer.slice(0, 32) }) as never;
    vi.mocked(ChatController.getConversations).mockResolvedValue([conversation(PEER)]);

    const coordinator = ChatSyncCoordinator.getInstance();
    coordinator.setRoute('/marketplace');
    coordinator.start();
    signIn();
    await settle();
    expect(subscriptions).toHaveLength(1);

    // A second conversation appears: the stream for that homeserver is replaced.
    vi.mocked(ChatController.getConversations).mockResolvedValue([conversation(PEER), conversation('q'.repeat(52))]);
    coordinator.requestReconcile();
    await settle();
    expect(subscriptions).toHaveLength(2);

    // The superseded stream was cancelled; it must not come back beside the new one after its backoff.
    await new Promise((resolve) => setTimeout(resolve, 2_300));
    expect(subscriptions).toHaveLength(2);
  }, 10_000);

  it('tears everything down on sign-out and on disabled routes', async () => {
    const coordinator = ChatSyncCoordinator.getInstance();
    coordinator.setRoute('/marketplace');
    coordinator.start();
    signIn();
    await settle();
    expect(useChatStore.getState().isLeaderTab).toBe(true);

    coordinator.setRoute('/sign-in');
    await settle();
    expect(useChatStore.getState().isLeaderTab).toBe(false);

    coordinator.setRoute('/marketplace');
    await settle();
    expect(useChatStore.getState().isLeaderTab).toBe(true);

    useAuthStore.getState().reset();
    await settle();
    expect(useChatStore.getState().isLeaderTab).toBe(false);
  });
});
