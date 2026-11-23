import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatApplication } from '@/application/chat/chat';
import type { ChatOutboxSends } from '@/application/chat/chat.types';
import { CommerceApplication } from '@/application/commerce/commerce';
import { UserApplication } from '@/application/user/user';
import { ChatController } from '@/controllers/chat/chat';
import type { ChatContext } from '@/models/chat/chat.schema';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useChatStore } from '@/stores/chat/chat.store';
import { setStoreSeller } from '@/test-utils/store-mode';

const STORE_SELLER = 's'.repeat(52);
const VIEWER = 'y'.repeat(52);
const MY_BUYER = 'b'.repeat(52);
const FRIEND = 'f'.repeat(52);
const OTHER_SELLER = 'o'.repeat(52);
const ASKER = 'a'.repeat(52);
const STRANGER = 'n'.repeat(52);

const thread = (peer: string, context: ChatContext | null, unreadCount = 1) => ({
  id: `${VIEWER}:${peer}`,
  owner_id: VIEWER,
  peer_pubky: peer,
  last_context: context,
  last_message_at: 1,
  unreadCount,
});

const threads = [
  thread(STORE_SELLER, { orderId: 'order-bought' }),
  thread(MY_BUYER, { orderId: 'order-sold' }),
  thread(FRIEND, null),
  thread(OTHER_SELLER, { listingId: 'boots' }),
  thread(ASKER, { listingId: 'my-lamp' }),
  thread(STRANGER, { listingId: 'gone' }),
];

/** Listings cached in this browser, and listings only their owner's homeserver still serves. */
const CACHED = new Set([`${OTHER_SELLER}:boots`]);
const ON_HOMESERVERS = new Set([`${VIEWER}:my-lamp`, `${STORE_SELLER}:hat`]);

const peers = (rows: { peer_pubky: string }[]) => rows.map(({ peer_pubky }) => peer_pubky);
const refused = { code: 'FORBIDDEN', operation: 'assertCanSellHere' };

describe('ChatController sale threads in a store', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUserPubky: VIEWER });
    vi.spyOn(ChatApplication, 'getConversations').mockResolvedValue(threads as never);
    vi.spyOn(ChatApplication, 'getConversation').mockImplementation(
      async (_me, peer) => (threads.find(({ peer_pubky }) => peer_pubky === peer) ?? null) as never,
    );
    vi.spyOn(ChatApplication, 'getMessages').mockResolvedValue([{ id: 'message' }] as never);
    vi.spyOn(ChatApplication, 'getMessageCount').mockResolvedValue(1);
    vi.spyOn(ChatApplication, 'getUnreadConversationCount').mockResolvedValue(threads.length);
    vi.spyOn(ChatApplication, 'queueMessage').mockResolvedValue('message-id');
    vi.spyOn(ChatApplication, 'flushOutbox').mockResolvedValue(undefined as never);
    vi.spyOn(ChatApplication, 'retryMessage').mockResolvedValue(undefined as never);
    vi.spyOn(ChatApplication, 'openConversation').mockResolvedValue({ state: 'ready' } as never);
    vi.spyOn(CommerceApplication, 'getMarketplaceOrders').mockResolvedValue([
      { id: 'order-bought', buyerPubky: VIEWER, sellerPubky: STORE_SELLER },
      { id: 'order-sold', buyerPubky: MY_BUYER, sellerPubky: VIEWER },
    ] as never);
    vi.spyOn(CommerceApplication, 'getListing').mockImplementation(async (compositeId: string) =>
      CACHED.has(compositeId) ? ({ id: compositeId } as never) : null,
    );
    vi.spyOn(CommerceApplication, 'getOrFetchListingIfFound').mockImplementation(async (owner, listingId) =>
      ON_HOMESERVERS.has(`${owner}:${listingId}`) ? ({ id: listingId } as never) : null,
    );
    vi.spyOn(UserApplication, 'ensureSellerFollow').mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    setStoreSeller(undefined);
    useChatStore.getState().reset();
    useAuthStore.setState({ currentUserPubky: null });
    vi.restoreAllMocks();
  });

  it('hides the sale threads of a user who cannot sell here and keeps its buyer threads and plain messages', async () => {
    setStoreSeller(STORE_SELLER);
    await ChatController.fetchStoreThreadRoles();

    expect(peers(await ChatController.getConversations())).toEqual([STORE_SELLER, FRIEND, OTHER_SELLER, STRANGER]);
    expect(await ChatController.getUnreadConversationCount()).toBe(4);
    for (const peer of [MY_BUYER, ASKER]) {
      expect(await ChatController.getConversation(peer)).toBeNull();
      expect(await ChatController.getMessages(peer)).toEqual([]);
      expect(await ChatController.getMessageCount(peer)).toBe(0);
    }
    expect(await ChatController.getMessages(STORE_SELLER)).toHaveLength(1);
  });

  it("keeps a buyer's thread with the store seller about a listing this browser has not cached", async () => {
    setStoreSeller(STORE_SELLER);
    vi.mocked(CommerceApplication.getMarketplaceOrders).mockResolvedValue([]);
    vi.mocked(ChatApplication.getConversations).mockResolvedValue([
      thread(STORE_SELLER, { listingId: 'hat' }),
    ] as never);
    vi.mocked(ChatApplication.getConversation).mockResolvedValue(thread(STORE_SELLER, { listingId: 'hat' }) as never);
    await ChatController.fetchStoreThreadRoles();

    expect(peers(await ChatController.getConversations())).toEqual([STORE_SELLER]);
    expect(await ChatController.getUnreadConversationCount()).toBe(1);
    expect(await ChatController.getMessages(STORE_SELLER)).toHaveLength(1);
    await expect(
      ChatController.commitSendMessage({
        peerPubky: STORE_SELLER,
        body: 'Still available?',
        context: { listingId: 'hat' },
      }),
    ).resolves.toBe('message-id');
  });

  it('shows only the thread with the store seller until the roles are read', async () => {
    setStoreSeller(STORE_SELLER);

    expect(peers(await ChatController.getConversations())).toEqual([STORE_SELLER]);
    expect(await ChatController.getUnreadConversationCount()).toBe(1);
  });

  it('refuses to write in a sale thread or about a sale, and writes in a buyer thread', async () => {
    setStoreSeller(STORE_SELLER);

    await expect(ChatController.commitSendMessage({ peerPubky: MY_BUYER, body: 'Shipped.' })).rejects.toMatchObject(
      refused,
    );
    await expect(
      ChatController.commitSendMessage({ peerPubky: FRIEND, body: 'Hi', context: { orderId: 'order-sold' } }),
    ).rejects.toMatchObject(refused);
    await expect(
      ChatController.commitSendMessage({ peerPubky: ASKER, body: 'Yes, it is.', context: { listingId: 'my-lamp' } }),
    ).rejects.toMatchObject(refused);
    await expect(ChatController.commitOpenConversation(MY_BUYER)).rejects.toMatchObject(refused);
    await expect(
      ChatController.commitSendMessage({
        peerPubky: STORE_SELLER,
        body: 'Shipped yet?',
        context: { orderId: 'order-bought' },
      }),
    ).resolves.toBe('message-id');
    await expect(ChatController.commitOpenConversation(FRIEND)).resolves.toEqual({ state: 'ready' });
    expect(ChatApplication.queueMessage).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(UserApplication.ensureSellerFollow).toHaveBeenCalledWith(
        expect.objectContaining({ follower: VIEWER, seller: STORE_SELLER }),
      ),
    );
  });

  it('writes to the store seller even when the roles cannot be read', async () => {
    setStoreSeller(STORE_SELLER);
    vi.mocked(CommerceApplication.getMarketplaceOrders).mockRejectedValue(new Error('orders are down'));

    await expect(ChatController.commitSendMessage({ peerPubky: STORE_SELLER, body: 'Hello' })).resolves.toBe(
      'message-id',
    );
    await expect(ChatController.commitSendMessage({ peerPubky: FRIEND, body: 'Hello' })).rejects.toMatchObject(refused);
  });

  it('leaves queued and failed messages of a sale thread unsent', async () => {
    setStoreSeller(STORE_SELLER);
    await ChatController.fetchStoreThreadRoles();

    await ChatController.commitFlushOutbox();
    const [, , { sends } = {}] = vi.mocked(ChatApplication.flushOutbox).mock.calls[0] as [
      string,
      AbortSignal,
      { sends?: ChatOutboxSends },
    ];
    const message = (peer: string, context: ChatContext | null = null) => ({ peer_pubky: peer, context });
    expect(await sends?.(message(MY_BUYER))).toBe(false);
    expect(await sends?.(message(FRIEND, { orderId: 'order-sold' }))).toBe(false);
    expect(await sends?.(message(STORE_SELLER, { orderId: 'order-bought' }))).toBe(true);
    expect(await sends?.(message(FRIEND))).toBe(true);

    await ChatController.commitRetryMessage('message-id');
    expect(vi.mocked(ChatApplication.retryMessage).mock.calls[0][3]?.sends).toEqual(expect.any(Function));
  });

  it("reads each account's roles on its own", async () => {
    setStoreSeller(STORE_SELLER);
    let finishFirst: (orders: never) => void = () => {};
    vi.mocked(CommerceApplication.getMarketplaceOrders).mockImplementationOnce(
      () => new Promise((resolve) => (finishFirst = resolve)),
    );
    const first = ChatController.fetchStoreThreadRoles();

    useAuthStore.setState({ currentUserPubky: FRIEND });
    const second = ChatController.fetchStoreThreadRoles();
    finishFirst([] as never);
    await first.catch(() => undefined);

    expect(vi.mocked(CommerceApplication.getMarketplaceOrders).mock.calls.map(([pubky]) => pubky)).toEqual([
      VIEWER,
      FRIEND,
    ]);
    await expect(second).resolves.toMatchObject({ soldTo: [] });
  });

  it('keeps every thread and reads no orders for the store seller and outside store mode', async () => {
    for (const storeSeller of [VIEWER, undefined]) {
      setStoreSeller(storeSeller);
      await expect(ChatController.fetchStoreThreadRoles()).resolves.toBeNull();
      expect(peers(await ChatController.getConversations())).toEqual(peers(threads));
      expect(await ChatController.getUnreadConversationCount()).toBe(threads.length);
      expect(await ChatController.getMessages(MY_BUYER)).toHaveLength(1);
      await expect(ChatController.commitSendMessage({ peerPubky: MY_BUYER, body: 'Shipped.' })).resolves.toBe(
        'message-id',
      );
      await ChatController.commitFlushOutbox();
      await ChatController.commitRetryMessage('message-id');
    }
    expect(CommerceApplication.getMarketplaceOrders).not.toHaveBeenCalled();
    expect(ChatApplication.getConversation).not.toHaveBeenCalled();
    for (const [, , options] of vi.mocked(ChatApplication.flushOutbox).mock.calls) {
      expect(options).toEqual({ sends: undefined });
    }
    for (const [, , , options] of vi.mocked(ChatApplication.retryMessage).mock.calls) {
      expect(options).toEqual({ sends: undefined });
    }
  });
});
