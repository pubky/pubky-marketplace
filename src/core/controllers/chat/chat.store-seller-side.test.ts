import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatApplication } from '@/application/chat/chat';
import type { ChatOutboxSends } from '@/application/chat/chat.types';
import { CommerceApplication } from '@/application/commerce/commerce';
import { UserApplication } from '@/application/user/user';
import { endAuthScope } from '@/controllers/auth/auth-scope';
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
    vi.spyOn(CommerceApplication, 'getMarketplaceOrderParties').mockResolvedValue(null);
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

  it('hides a sale order older than the orders page after resolving it by id', async () => {
    setStoreSeller(STORE_SELLER);
    const olderSale = thread(MY_BUYER, { orderId: 'older-sale' });
    vi.mocked(ChatApplication.getConversations).mockResolvedValue([olderSale] as never);
    vi.mocked(ChatApplication.getConversation).mockResolvedValue(olderSale as never);
    vi.mocked(CommerceApplication.getMarketplaceOrders).mockResolvedValue([]);
    vi.mocked(CommerceApplication.getMarketplaceOrderParties).mockResolvedValue({
      buyerPubky: MY_BUYER,
      sellerPubky: VIEWER,
    });

    await ChatController.fetchStoreThreadRoles();

    expect(CommerceApplication.getMarketplaceOrderParties).toHaveBeenCalledWith(VIEWER, 'older-sale');
    expect(await ChatController.getConversations()).toEqual([]);
    expect(await ChatController.getUnreadConversationCount()).toBe(0);
    expect(await ChatController.getConversation(MY_BUYER)).toBeNull();
    expect(await ChatController.getMessages(MY_BUYER)).toEqual([]);
    expect(await ChatController.getMessageCount(MY_BUYER)).toBe(0);
  });

  it.each(['returns null', 'throws'] as const)('fails closed when an older order read %s', async (outcome) => {
    setStoreSeller(STORE_SELLER);
    const unresolved = thread(FRIEND, { orderId: 'older-unresolved' });
    vi.mocked(ChatApplication.getConversations).mockResolvedValue([unresolved] as never);
    vi.mocked(ChatApplication.getConversation).mockResolvedValue(unresolved as never);
    vi.mocked(CommerceApplication.getMarketplaceOrders).mockResolvedValue([]);
    if (outcome === 'throws') {
      vi.mocked(CommerceApplication.getMarketplaceOrderParties).mockRejectedValue(new Error('order read failed'));
    }

    await expect(ChatController.fetchStoreThreadRoles()).resolves.toMatchObject({ soldOrderIds: [] });

    expect(await ChatController.getConversations()).toEqual([]);
    expect(await ChatController.getUnreadConversationCount()).toBe(0);
    expect(await ChatController.getConversation(FRIEND)).toBeNull();
    expect(await ChatController.getMessages(FRIEND)).toEqual([]);
    expect(await ChatController.getMessageCount(FRIEND)).toBe(0);
  });

  it('fails closed for a failed listing lookup and keeps the store seller thread with an unresolved order', async () => {
    setStoreSeller(STORE_SELLER);
    const failedListing = thread(STRANGER, { listingId: 'unreadable' });
    const sellerOrder = thread(STORE_SELLER, { orderId: 'unresolved-seller-order' });
    const rows = [failedListing, sellerOrder];
    vi.mocked(ChatApplication.getConversations).mockResolvedValue(rows as never);
    vi.mocked(ChatApplication.getConversation).mockImplementation(
      async (_me, peer) => (rows.find(({ peer_pubky }) => peer_pubky === peer) ?? null) as never,
    );
    vi.mocked(CommerceApplication.getMarketplaceOrders).mockResolvedValue([]);
    vi.mocked(CommerceApplication.getOrFetchListingIfFound).mockRejectedValue(new Error('listing read failed'));

    await expect(ChatController.fetchStoreThreadRoles()).resolves.toBeTruthy();

    expect(peers(await ChatController.getConversations())).toEqual([STORE_SELLER]);
    expect(await ChatController.getConversation(STRANGER)).toBeNull();
    expect(await ChatController.getMessages(STRANGER)).toEqual([]);
    expect(await ChatController.getMessageCount(STRANGER)).toBe(0);
    expect(await ChatController.getUnreadConversationCount()).toBe(1);
    await expect(
      ChatController.commitSendMessage({
        peerPubky: STORE_SELLER,
        body: 'Still available?',
        context: { orderId: 'unresolved-seller-order' },
      }),
    ).resolves.toBe('message-id');
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

  it('refuses a write context sold to a peer the viewer previously bought from', async () => {
    setStoreSeller(STORE_SELLER);
    const buyerThread = thread(FRIEND, { orderId: 'bought-from-friend' });
    vi.mocked(ChatApplication.getConversations).mockResolvedValue([buyerThread] as never);
    vi.mocked(ChatApplication.getConversation).mockResolvedValue(buyerThread as never);
    vi.mocked(CommerceApplication.getMarketplaceOrders).mockResolvedValue([
      { id: 'bought-from-friend', buyerPubky: VIEWER, sellerPubky: FRIEND },
    ] as never);
    vi.mocked(CommerceApplication.getMarketplaceOrderParties).mockResolvedValue({
      buyerPubky: FRIEND,
      sellerPubky: VIEWER,
    });

    await expect(
      ChatController.commitSendMessage({
        peerPubky: FRIEND,
        body: 'About the sale',
        context: { orderId: 'sold-to-friend' },
      }),
    ).rejects.toMatchObject(refused);
    expect(useChatStore.getState().storeThreadRoles?.soldOrderIds).toContain('sold-to-friend');
    await expect(
      ChatController.commitSendMessage({
        peerPubky: FRIEND,
        body: 'About my listing',
        context: { listingId: 'my-lamp' },
      }),
    ).rejects.toMatchObject(refused);
    await expect(
      ChatController.commitSendMessage({
        peerPubky: FRIEND,
        body: 'About my purchase',
        context: { orderId: 'bought-from-friend' },
      }),
    ).resolves.toBe('message-id');
    expect(ChatApplication.queueMessage).toHaveBeenCalledTimes(1);
  });

  it('refuses sold contexts and failed order lookups for retries and queued sends', async () => {
    setStoreSeller(STORE_SELLER);
    const plain = thread(FRIEND, null);
    vi.mocked(ChatApplication.getConversations).mockResolvedValue([plain] as never);
    vi.mocked(ChatApplication.getConversation).mockResolvedValue(plain as never);
    vi.mocked(CommerceApplication.getMarketplaceOrders).mockResolvedValue([
      { id: 'bought-from-friend', buyerPubky: VIEWER, sellerPubky: FRIEND },
    ] as never);
    vi.mocked(CommerceApplication.getMarketplaceOrderParties).mockImplementation(async (_me, orderId) => {
      if (orderId === 'failed-order') throw new Error('order read failed');
      return { buyerPubky: FRIEND, sellerPubky: VIEWER };
    });
    await ChatController.fetchStoreThreadRoles();

    await ChatController.commitFlushOutbox();
    const flushCalls = vi.mocked(ChatApplication.flushOutbox).mock.calls;
    const flushSends = flushCalls[flushCalls.length - 1][2]?.sends;
    expect(await flushSends?.({ peer_pubky: FRIEND, context: { orderId: 'sold-to-friend' } })).toBe(false);
    expect(await flushSends?.({ peer_pubky: FRIEND, context: { orderId: 'failed-order' } })).toBe(false);
    expect(await flushSends?.({ peer_pubky: FRIEND, context: { orderId: 'bought-from-friend' } })).toBe(true);
    expect(await flushSends?.({ peer_pubky: STORE_SELLER, context: { orderId: 'failed-order' } })).toBe(true);

    await ChatController.commitRetryMessage('message-id');
    const retryCalls = vi.mocked(ChatApplication.retryMessage).mock.calls;
    const retrySends = retryCalls[retryCalls.length - 1][3]?.sends;
    expect(await retrySends?.({ peer_pubky: FRIEND, context: { orderId: 'sold-to-friend' } })).toBe(false);
    expect(await retrySends?.({ peer_pubky: FRIEND, context: { orderId: 'bought-from-friend' } })).toBe(true);
  });

  it('refuses a send whose own order lookup fails but always writes to the store seller', async () => {
    setStoreSeller(STORE_SELLER);
    const plain = thread(FRIEND, null);
    vi.mocked(ChatApplication.getConversations).mockResolvedValue([plain] as never);
    vi.mocked(ChatApplication.getConversation).mockResolvedValue(plain as never);
    vi.mocked(CommerceApplication.getMarketplaceOrders).mockResolvedValue([]);
    vi.mocked(CommerceApplication.getMarketplaceOrderParties).mockRejectedValue(new Error('order read failed'));

    await expect(
      ChatController.commitSendMessage({ peerPubky: FRIEND, body: 'Hello', context: { orderId: 'unknown' } }),
    ).rejects.toMatchObject(refused);
    await expect(
      ChatController.commitSendMessage({ peerPubky: STORE_SELLER, body: 'Hello', context: { orderId: 'unknown' } }),
    ).resolves.toBe('message-id');
    expect(ChatApplication.queueMessage).toHaveBeenCalledTimes(1);
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

  it('discards an aborted orders and conversations read with no listing contexts', async () => {
    setStoreSeller(STORE_SELLER);
    vi.mocked(ChatApplication.getConversations).mockResolvedValue([thread(FRIEND, null)] as never);
    let finishFirst: (orders: never) => void = () => {};
    vi.mocked(CommerceApplication.getMarketplaceOrders).mockImplementationOnce(
      () => new Promise((resolve) => (finishFirst = resolve)),
    );
    const first = ChatController.fetchStoreThreadRoles();

    endAuthScope();
    useAuthStore.setState({ currentUserPubky: FRIEND });
    const second = ChatController.fetchStoreThreadRoles();
    await expect(second).resolves.toMatchObject({ soldOrderIds: [] });
    finishFirst([{ id: 'old-sale', buyerPubky: MY_BUYER, sellerPubky: VIEWER }] as never);

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(useChatStore.getState().storeThreadRoles?.soldOrderIds).toEqual([]);
  });

  it.each(['send', 'open', 'retry'] as const)(
    'aborts a %s when the account changes during the roles read',
    async (operation) => {
      setStoreSeller(STORE_SELLER);
      let finishOrders: (orders: never) => void = () => {};
      vi.mocked(CommerceApplication.getMarketplaceOrders).mockImplementationOnce(
        () => new Promise((resolve) => (finishOrders = resolve)),
      );
      const pending =
        operation === 'send'
          ? ChatController.commitSendMessage({ peerPubky: FRIEND, body: 'Hello' })
          : operation === 'open'
            ? ChatController.commitOpenConversation(FRIEND)
            : ChatController.commitRetryMessage('message-id');
      await vi.waitFor(() => expect(CommerceApplication.getMarketplaceOrders).toHaveBeenCalled());

      endAuthScope();
      useAuthStore.setState({ currentUserPubky: MY_BUYER });
      finishOrders([] as never);

      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(ChatApplication.queueMessage).not.toHaveBeenCalled();
      expect(ChatApplication.openConversation).not.toHaveBeenCalled();
      expect(ChatApplication.retryMessage).not.toHaveBeenCalled();
    },
  );

  it('aborts a send when the account changes during a by-id order read', async () => {
    setStoreSeller(STORE_SELLER);
    const plain = thread(FRIEND, null);
    vi.mocked(ChatApplication.getConversations).mockResolvedValue([plain] as never);
    vi.mocked(ChatApplication.getConversation).mockResolvedValue(plain as never);
    vi.mocked(CommerceApplication.getMarketplaceOrders).mockResolvedValue([]);
    await ChatController.fetchStoreThreadRoles();
    let finishOrder: (order: never) => void = () => {};
    vi.mocked(CommerceApplication.getMarketplaceOrderParties).mockImplementationOnce(
      () => new Promise((resolve) => (finishOrder = resolve)),
    );
    const pending = ChatController.commitSendMessage({
      peerPubky: FRIEND,
      body: 'Hello',
      context: { orderId: 'new-order' },
    });
    await vi.waitFor(() => expect(CommerceApplication.getMarketplaceOrderParties).toHaveBeenCalled());

    endAuthScope();
    useAuthStore.setState({ currentUserPubky: MY_BUYER });
    finishOrder({ buyerPubky: FRIEND, sellerPubky: VIEWER } as never);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(ChatApplication.queueMessage).not.toHaveBeenCalled();
  });

  it('aborts a send when the account changes during a listing read', async () => {
    setStoreSeller(STORE_SELLER);
    const plain = thread(FRIEND, null);
    vi.mocked(ChatApplication.getConversations).mockResolvedValue([plain] as never);
    vi.mocked(ChatApplication.getConversation).mockResolvedValue(plain as never);
    vi.mocked(CommerceApplication.getMarketplaceOrders).mockResolvedValue([]);
    await ChatController.fetchStoreThreadRoles();
    let finishListing: (listing: never) => void = () => {};
    vi.mocked(CommerceApplication.getOrFetchListingIfFound).mockImplementationOnce(
      () => new Promise((resolve) => (finishListing = resolve)),
    );
    const pending = ChatController.commitSendMessage({
      peerPubky: FRIEND,
      body: 'Hello',
      context: { listingId: 'pending-listing' },
    });
    await vi.waitFor(() => expect(CommerceApplication.getOrFetchListingIfFound).toHaveBeenCalled());

    endAuthScope();
    useAuthStore.setState({ currentUserPubky: MY_BUYER });
    finishListing(null as never);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(ChatApplication.queueMessage).not.toHaveBeenCalled();
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
