import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatApplication } from '@/application/chat/chat';
import type { ChatOutboxSends } from '@/application/chat/chat.types';
import { CommerceApplication } from '@/application/commerce/commerce';
import { UserApplication } from '@/application/user/user';
import { endAuthScope } from '@/controllers/auth/auth-scope';
import { ChatController, isStoreThreadRefusal } from '@/controllers/chat/chat';
import type { ChatContext } from '@/models/chat/chat.schema';
import { CONFLICTING_COUNTERPARTY } from '@/pipes/commerce/store-seller-side';
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

    await expect(ChatController.fetchStoreThreadRoles()).rejects.toThrow('could not be placed');
    expect(useChatStore.getState().storeThreadRoles).toMatchObject({ soldOrders: {}, boughtOrders: {} });

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

    await expect(ChatController.fetchStoreThreadRoles()).rejects.toThrow('could not be placed');

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

  it('recognizes only the store thread refusal', async () => {
    setStoreSeller(STORE_SELLER);
    const refusal = await ChatController.commitOpenConversation(MY_BUYER).catch((error: unknown) => error);
    const other = await ChatController.commitOpenConversation('not-a-pubky').catch((error: unknown) => error);

    expect(isStoreThreadRefusal(refusal)).toBe(true);
    expect(isStoreThreadRefusal(other)).toBe(false);
    expect(isStoreThreadRefusal(new Error('unavailable'))).toBe(false);
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
    expect(useChatStore.getState().storeThreadRoles?.soldOrders).toHaveProperty('sold-to-friend', FRIEND);
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

  it.each(['fetchConversationUpdates', 'handleInboxPings'] as const)(
    'sends only the store seller row when %s triggers an outbox flush',
    async (entryPoint) => {
      setStoreSeller(STORE_SELLER);
      await ChatController.fetchStoreThreadRoles();
      const queued = [
        { peer_pubky: MY_BUYER, context: { orderId: 'order-sold' } },
        { peer_pubky: STORE_SELLER, context: { orderId: 'order-bought' } },
      ];
      const delivered: string[] = [];
      const deliver = async (sends?: ChatOutboxSends) => {
        for (const message of queued) {
          if (!sends || (await sends(message))) delivered.push(message.peer_pubky);
        }
      };
      const ping = {
        sender: MY_BUYER,
        slot: `chat-${'f'.repeat(32)}`,
        revision: 'r1',
        received_at: '',
        expires_at: '',
        payload: JSON.stringify({
          v: 0,
          t: 'chat',
          folder: 'f'.repeat(32),
          file: '1700000000000-aaaaaaaa.json',
        }),
      };
      vi.spyOn(ChatController, 'getOrFetchIdentity').mockResolvedValue('ready');
      vi.spyOn(ChatApplication, 'syncConversation').mockImplementation(async (_me, _peer, { sends }) => {
        await deliver(sends);
        return 'synced';
      });
      vi.spyOn(ChatApplication, 'handlePing').mockImplementation(async (_me, _ping, _signal, { sends } = {}) => {
        await deliver(sends);
      });

      if (entryPoint === 'fetchConversationUpdates') {
        await ChatController.fetchConversationUpdates(MY_BUYER, 'open');
      } else {
        await ChatController.handleInboxPings([ping]);
      }

      expect(delivered).toEqual([STORE_SELLER]);
    },
  );

  it.each([
    'fetchConversationUpdates',
    'fetchAllConversationUpdates',
    'fetchRebuild',
    'fetchSeededConversations',
    'handleInboxPings',
  ] as const)('%s passes the outbox filter only for a viewer who cannot sell here', async (entryPoint) => {
    vi.spyOn(ChatApplication, 'syncConversation').mockResolvedValue('synced');
    vi.spyOn(ChatApplication, 'syncAll').mockResolvedValue();
    vi.spyOn(ChatApplication, 'rebuildFromHomeserver').mockResolvedValue();
    vi.spyOn(ChatApplication, 'seedConversations').mockResolvedValue();
    vi.spyOn(ChatApplication, 'handlePing').mockResolvedValue();
    vi.spyOn(ChatController, 'getOrFetchIdentity').mockResolvedValue('ready');
    const ping = {
      sender: MY_BUYER,
      slot: `chat-${'f'.repeat(32)}`,
      revision: 'r1',
      received_at: '',
      expires_at: '',
      payload: JSON.stringify({
        v: 0,
        t: 'chat',
        folder: 'f'.repeat(32),
        file: '1700000000000-aaaaaaaa.json',
      }),
    };
    const run = async () => {
      switch (entryPoint) {
        case 'fetchConversationUpdates':
          await ChatController.fetchConversationUpdates(MY_BUYER, 'open');
          break;
        case 'fetchAllConversationUpdates':
          await ChatController.fetchAllConversationUpdates('reconcile');
          break;
        case 'fetchRebuild':
          await ChatController.fetchRebuild();
          break;
        case 'fetchSeededConversations':
          await ChatController.fetchSeededConversations([MY_BUYER]);
          break;
        case 'handleInboxPings':
          await ChatController.handleInboxPings([ping]);
          break;
      }
    };
    const lastSends = (): ChatOutboxSends | undefined => {
      switch (entryPoint) {
        case 'fetchConversationUpdates':
          return vi.mocked(ChatApplication.syncConversation).mock.calls.at(-1)?.[2].sends;
        case 'fetchAllConversationUpdates':
          return vi.mocked(ChatApplication.syncAll).mock.calls.at(-1)?.[3]?.sends;
        case 'fetchRebuild':
          return vi.mocked(ChatApplication.rebuildFromHomeserver).mock.calls.at(-1)?.[2]?.sends;
        case 'fetchSeededConversations':
          return vi.mocked(ChatApplication.seedConversations).mock.calls.at(-1)?.[3]?.sends;
        case 'handleInboxPings':
          return vi.mocked(ChatApplication.handlePing).mock.calls.at(-1)?.[3]?.sends;
      }
    };

    setStoreSeller(STORE_SELLER);
    await run();
    expect(lastSends()).toEqual(expect.any(Function));

    setStoreSeller(VIEWER);
    await run();
    expect(lastSends()).toBeUndefined();
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
    await expect(second).resolves.toMatchObject({ soldOrders: {} });
    finishFirst([{ id: 'old-sale', buyerPubky: MY_BUYER, sellerPubky: VIEWER }] as never);

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(useChatStore.getState().storeThreadRoles?.soldOrders).toEqual({});
  });

  it.each(['send', 'open', 'retry'] as const)(
    'aborts a %s when the account changes during the roles read',
    async (operation) => {
      setStoreSeller(STORE_SELLER);
      let finishOrders: (orders: never) => void = () => {};
      vi.mocked(CommerceApplication.getMarketplaceOrders).mockImplementationOnce(
        () => new Promise((resolve) => (finishOrders = resolve)),
      );
      vi.mocked(ChatApplication.retryMessage).mockImplementationOnce(async (_me, _id, _signal, { sends } = {}) => {
        await sends?.({ peer_pubky: FRIEND, context: null });
      });
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
      if (operation !== 'retry') expect(ChatApplication.retryMessage).not.toHaveBeenCalled();
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

  it('keeps what a send learned while a slower roles read finishes later', async () => {
    setStoreSeller(STORE_SELLER);
    let finishOrders: (orders: never) => void = () => undefined;
    vi.mocked(CommerceApplication.getMarketplaceOrders).mockReturnValue(
      new Promise((resolve) => {
        finishOrders = resolve as never;
      }),
    );
    const read = ChatController.fetchStoreThreadRoles();
    useChatStore.getState().setStoreThreadRoles({
      viewer: VIEWER,
      soldTo: [],
      boughtFrom: [],
      soldOrders: { 'learned-sale': MY_BUYER },
      boughtOrders: {},
      listingSides: { [`${ASKER}:my-lamp`]: 'viewer' },
    });
    finishOrders([
      { id: 'order-bought', buyerPubky: VIEWER, sellerPubky: STORE_SELLER },
      { id: 'order-sold', buyerPubky: MY_BUYER, sellerPubky: VIEWER },
    ] as never);
    await read;

    expect(useChatStore.getState().storeThreadRoles).toMatchObject({
      soldOrders: expect.objectContaining({ 'learned-sale': MY_BUYER, 'order-sold': MY_BUYER }),
      listingSides: expect.objectContaining({ [`${ASKER}:my-lamp`]: 'viewer' }),
    });
  });

  it('does not mix roles held for another account into a read', async () => {
    setStoreSeller(STORE_SELLER);
    useChatStore.getState().setStoreThreadRoles({
      viewer: OTHER_SELLER,
      soldTo: [],
      boughtFrom: [FRIEND],
      soldOrders: {},
      boughtOrders: { 'foreign-purchase': FRIEND },
      listingSides: {},
    });

    const roles = await ChatController.fetchStoreThreadRoles();

    expect(roles).toMatchObject({
      viewer: VIEWER,
      boughtFrom: [STORE_SELLER],
      boughtOrders: { 'order-bought': STORE_SELLER },
    });
    expect(useChatStore.getState().storeThreadRoles).toBe(roles);
  });

  it('hides a thread whose latest context is unresolved even after the viewer bought from that peer', async () => {
    setStoreSeller(STORE_SELLER);
    const unplaced = thread(FRIEND, { orderId: 'unplaced' });
    vi.mocked(ChatApplication.getConversations).mockResolvedValue([unplaced] as never);
    vi.mocked(ChatApplication.getConversation).mockResolvedValue(unplaced as never);
    vi.mocked(CommerceApplication.getMarketplaceOrders).mockResolvedValue([
      { id: 'bought-from-friend', buyerPubky: VIEWER, sellerPubky: FRIEND },
    ] as never);

    await expect(ChatController.fetchStoreThreadRoles()).rejects.toThrow('could not be placed');

    expect(useChatStore.getState().storeThreadRoles?.boughtFrom).toEqual([FRIEND]);
    expect(await ChatController.getConversations()).toEqual([]);
    await expect(
      ChatController.commitSendMessage({ peerPubky: FRIEND, body: 'hello', context: { orderId: 'unplaced' } }),
    ).rejects.toMatchObject(refused);
  });

  it.each([
    { name: 'an order it sold', context: { orderId: 'sold-to-friend' } },
    { name: 'an order it sold and its own listing', context: { orderId: 'sold-to-friend', listingId: 'my-lamp' } },
  ])(
    'closes a thread whose latest context is $name even after the viewer bought from that peer',
    async ({ context }) => {
      setStoreSeller(STORE_SELLER);
      const sale = thread(FRIEND, context);
      vi.mocked(ChatApplication.getConversations).mockResolvedValue([sale] as never);
      vi.mocked(ChatApplication.getConversation).mockResolvedValue(sale as never);
      vi.mocked(CommerceApplication.getMarketplaceOrders).mockResolvedValue([
        { id: 'bought-from-friend', buyerPubky: VIEWER, sellerPubky: FRIEND },
        { id: 'sold-to-friend', buyerPubky: FRIEND, sellerPubky: VIEWER },
      ] as never);

      await ChatController.fetchStoreThreadRoles();

      expect(useChatStore.getState().storeThreadRoles?.boughtFrom).toEqual([FRIEND]);
      expect(await ChatController.getConversations()).toEqual([]);
      expect(await ChatController.getConversation(FRIEND)).toBeNull();
      expect(await ChatController.getMessages(FRIEND)).toEqual([]);
      await expect(ChatController.commitSendMessage({ peerPubky: FRIEND, body: 'hello' })).rejects.toMatchObject(
        refused,
      );
    },
  );

  it('retries a roles read after an older order came back unresolved and then shows the purchase thread', async () => {
    setStoreSeller(STORE_SELLER);
    const older = thread(FRIEND, { orderId: 'older-bought' });
    vi.mocked(ChatApplication.getConversations).mockResolvedValue([older] as never);
    vi.mocked(ChatApplication.getConversation).mockResolvedValue(older as never);
    vi.mocked(CommerceApplication.getMarketplaceOrders).mockResolvedValue([]);
    vi.mocked(CommerceApplication.getMarketplaceOrderParties)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ buyerPubky: VIEWER, sellerPubky: FRIEND });

    await expect(ChatController.fetchStoreThreadRoles()).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      operation: 'readStoreThreadRoles',
    });
    expect(await ChatController.getConversations()).toEqual([]);

    await expect(ChatController.fetchStoreThreadRoles()).resolves.toMatchObject({
      boughtOrders: { 'older-bought': FRIEND },
    });
    expect(peers(await ChatController.getConversations())).toEqual([FRIEND]);
  });

  describe('a context that names a purchase and a sale or an unresolved listing', () => {
    const friendOrders = [
      { id: 'bought-from-friend', buyerPubky: VIEWER, sellerPubky: FRIEND },
      { id: 'sold-to-friend', buyerPubky: FRIEND, sellerPubky: VIEWER },
    ];
    const mixed: { name: string; context: ChatContext; readFails: boolean }[] = [
      {
        name: 'a bought order and its own listing',
        context: { orderId: 'bought-from-friend', listingId: 'my-lamp' },
        readFails: false,
      },
      {
        name: 'a bought order and a listing whose lookup failed',
        context: { orderId: 'bought-from-friend', listingId: 'unreadable' },
        readFails: true,
      },
      {
        name: 'a sold order and a listing of the peer',
        context: { orderId: 'sold-to-friend', listingId: 'friend-hat' },
        readFails: false,
      },
    ];

    beforeEach(() => {
      CACHED.add(`${FRIEND}:friend-hat`);
      vi.mocked(CommerceApplication.getMarketplaceOrders).mockResolvedValue(friendOrders as never);
      vi.mocked(CommerceApplication.getOrFetchListingIfFound).mockImplementation(async (owner, listingId) => {
        if (listingId === 'unreadable') throw new Error('listing read failed');
        return ON_HOMESERVERS.has(`${owner}:${listingId}`) ? ({ id: listingId } as never) : null;
      });
    });

    afterEach(() => {
      CACHED.delete(`${FRIEND}:friend-hat`);
    });

    it.each(mixed)(
      'closes the thread for reads, writes, retries and queued sends: $name',
      async ({ context, readFails }) => {
        setStoreSeller(STORE_SELLER);
        const row = thread(FRIEND, context);
        vi.mocked(ChatApplication.getConversations).mockResolvedValue([row] as never);
        vi.mocked(ChatApplication.getConversation).mockResolvedValue(row as never);

        const read = ChatController.fetchStoreThreadRoles();
        if (readFails) await expect(read).rejects.toThrow('could not be placed');
        else await read;

        expect(await ChatController.getConversations()).toEqual([]);
        expect(await ChatController.getConversation(FRIEND)).toBeNull();
        expect(await ChatController.getMessages(FRIEND)).toEqual([]);
        expect(await ChatController.getUnreadConversationCount()).toBe(0);
        await expect(ChatController.commitSendMessage({ peerPubky: FRIEND, body: 'hello' })).rejects.toMatchObject(
          refused,
        );
        await expect(ChatController.commitOpenConversation(FRIEND)).rejects.toMatchObject(refused);

        await ChatController.commitFlushOutbox();
        await ChatController.commitRetryMessage('message-id');
        const flushCalls = vi.mocked(ChatApplication.flushOutbox).mock.calls;
        const retryCalls = vi.mocked(ChatApplication.retryMessage).mock.calls;
        const flushSends = flushCalls[flushCalls.length - 1][2]?.sends;
        const retrySends = retryCalls[retryCalls.length - 1][3]?.sends;
        expect(await flushSends?.({ peer_pubky: FRIEND, context: null })).toBe(false);
        expect(await retrySends?.({ peer_pubky: FRIEND, context: null })).toBe(false);
      },
    );

    it('keeps the thread when the whole context is a purchase', async () => {
      setStoreSeller(STORE_SELLER);
      const row = thread(FRIEND, { orderId: 'bought-from-friend', listingId: 'friend-hat' });
      vi.mocked(ChatApplication.getConversations).mockResolvedValue([row] as never);
      vi.mocked(ChatApplication.getConversation).mockResolvedValue(row as never);

      await ChatController.fetchStoreThreadRoles();

      expect(peers(await ChatController.getConversations())).toEqual([FRIEND]);
      await expect(ChatController.commitSendMessage({ peerPubky: FRIEND, body: 'hello' })).resolves.toBe('message-id');
    });
  });

  describe('an order of another counterparty', () => {
    const orders = [
      { id: 'bought-from-store', buyerPubky: VIEWER, sellerPubky: STORE_SELLER },
      { id: 'bought-from-friend', buyerPubky: VIEWER, sellerPubky: FRIEND },
      { id: 'sold-to-buyer', buyerPubky: MY_BUYER, sellerPubky: VIEWER },
    ];

    beforeEach(() => {
      vi.mocked(CommerceApplication.getMarketplaceOrders).mockResolvedValue(orders as never);
    });

    it('does not open a sale thread: a purchase counts only with its seller', async () => {
      setStoreSeller(STORE_SELLER);
      const sale = thread(MY_BUYER, { orderId: 'bought-from-store' });
      const purchase = thread(FRIEND, { orderId: 'bought-from-friend' });
      vi.mocked(ChatApplication.getConversations).mockResolvedValue([sale, purchase] as never);
      vi.mocked(ChatApplication.getConversation).mockImplementation(
        async (_me, peer) => ([sale, purchase].find(({ peer_pubky }) => peer_pubky === peer) ?? null) as never,
      );

      await ChatController.fetchStoreThreadRoles();

      expect(peers(await ChatController.getConversations())).toEqual([FRIEND]);
      expect(await ChatController.getConversation(MY_BUYER)).toBeNull();
      expect(await ChatController.getMessages(MY_BUYER)).toEqual([]);
      expect(await ChatController.getUnreadConversationCount()).toBe(1);
      await expect(ChatController.commitSendMessage({ peerPubky: MY_BUYER, body: 'hello' })).rejects.toMatchObject(
        refused,
      );
      await ChatController.commitFlushOutbox();
      const flushCalls = vi.mocked(ChatApplication.flushOutbox).mock.calls;
      const sends = flushCalls[flushCalls.length - 1][2]?.sends;
      expect(await sends?.({ peer_pubky: MY_BUYER, context: null })).toBe(false);
      expect(await sends?.({ peer_pubky: FRIEND, context: null })).toBe(true);
    });

    it.each([
      { name: 'an order bought from the store seller', context: { orderId: 'bought-from-store' }, writes: false },
      { name: 'an order sold to another buyer', context: { orderId: 'sold-to-buyer' }, writes: false },
      { name: 'an order bought from this peer', context: { orderId: 'bought-from-friend' }, writes: true },
    ])('writes with $name only in the thread of its counterparty', async ({ context, writes }) => {
      setStoreSeller(STORE_SELLER);
      const plain = thread(FRIEND, null);
      vi.mocked(ChatApplication.getConversations).mockResolvedValue([plain] as never);
      vi.mocked(ChatApplication.getConversation).mockResolvedValue(plain as never);
      await ChatController.fetchStoreThreadRoles();

      const send = ChatController.commitSendMessage({ peerPubky: FRIEND, body: 'hello', context });
      if (writes) await expect(send).resolves.toBe('message-id');
      else await expect(send).rejects.toMatchObject(refused);
    });
  });

  it('closes an order that a slower roles read and a send place with different counterparties', async () => {
    setStoreSeller(STORE_SELLER);
    const row = thread(FRIEND, { orderId: 'contested' });
    vi.mocked(ChatApplication.getConversations).mockResolvedValue([row] as never);
    vi.mocked(ChatApplication.getConversation).mockResolvedValue(row as never);
    vi.mocked(CommerceApplication.getMarketplaceOrders).mockResolvedValue([
      { id: 'contested', buyerPubky: VIEWER, sellerPubky: FRIEND },
    ] as never);
    useChatStore.getState().setStoreThreadRoles({
      viewer: VIEWER,
      soldTo: [],
      boughtFrom: [],
      soldOrders: {},
      boughtOrders: { contested: STORE_SELLER },
      listingSides: {},
    });

    await ChatController.fetchStoreThreadRoles();

    expect(useChatStore.getState().storeThreadRoles?.boughtOrders.contested).toBe(CONFLICTING_COUNTERPARTY);
    expect(await ChatController.getConversations()).toEqual([]);
    await expect(ChatController.commitSendMessage({ peerPubky: FRIEND, body: 'hello' })).rejects.toMatchObject(refused);
  });

  describe('a listing id both the peer and the viewer published', () => {
    const owners = (peerHas: 'cache' | 'none', viewerHas: 'cache' | 'homeserver' | 'none') => {
      if (peerHas === 'cache') CACHED.add(`${FRIEND}:boots`);
      if (viewerHas === 'cache') CACHED.add(`${VIEWER}:boots`);
      if (viewerHas === 'homeserver') ON_HOMESERVERS.add(`${VIEWER}:boots`);
    };

    afterEach(() => {
      CACHED.delete(`${FRIEND}:boots`);
      CACHED.delete(`${VIEWER}:boots`);
      ON_HOMESERVERS.delete(`${VIEWER}:boots`);
    });

    it.each([
      { peerHas: 'cache', viewerHas: 'cache', shown: false },
      { peerHas: 'cache', viewerHas: 'homeserver', shown: false },
      { peerHas: 'none', viewerHas: 'homeserver', shown: false },
      { peerHas: 'cache', viewerHas: 'none', shown: true },
    ] as const)(
      'is the viewer sale when the viewer has it in $viewerHas and the peer in $peerHas',
      async ({ peerHas, viewerHas, shown }) => {
        setStoreSeller(STORE_SELLER);
        owners(peerHas, viewerHas);
        const row = thread(FRIEND, { listingId: 'boots' });
        vi.mocked(ChatApplication.getConversations).mockResolvedValue([row] as never);
        vi.mocked(ChatApplication.getConversation).mockResolvedValue(row as never);
        vi.mocked(CommerceApplication.getMarketplaceOrders).mockResolvedValue([]);

        await ChatController.fetchStoreThreadRoles();

        expect(useChatStore.getState().storeThreadRoles?.listingSides[`${FRIEND}:boots`]).toBe(
          shown ? 'peer' : 'viewer',
        );
        expect(peers(await ChatController.getConversations())).toEqual(shown ? [FRIEND] : []);
        const send = ChatController.commitSendMessage({ peerPubky: FRIEND, body: 'hello' });
        if (shown) await expect(send).resolves.toBe('message-id');
        else await expect(send).rejects.toMatchObject(refused);
      },
    );

    it('keeps a context closed after the viewer listing lookup failed while the peer copy is cached', async () => {
      setStoreSeller(STORE_SELLER);
      CACHED.add(`${FRIEND}:boots`);
      const row = thread(FRIEND, { listingId: 'boots' });
      vi.mocked(ChatApplication.getConversations).mockResolvedValue([row] as never);
      vi.mocked(ChatApplication.getConversation).mockResolvedValue(row as never);
      vi.mocked(CommerceApplication.getMarketplaceOrders).mockResolvedValue([]);
      vi.mocked(CommerceApplication.getOrFetchListingIfFound).mockImplementation(async (owner) => {
        if (owner === VIEWER) throw new Error('viewer homeserver unreachable');
        return null as never;
      });

      await expect(ChatController.fetchStoreThreadRoles()).rejects.toThrow('could not be placed');

      expect(await ChatController.getConversations()).toEqual([]);
      expect(await ChatController.getConversation(FRIEND)).toBeNull();
      expect(await ChatController.getMessages(FRIEND)).toEqual([]);
      expect(await ChatController.getUnreadConversationCount()).toBe(0);
      await expect(
        ChatController.commitSendMessage({ peerPubky: FRIEND, body: 'hello', context: { listingId: 'boots' } }),
      ).rejects.toMatchObject(refused);
    });

    it('keeps the viewer side a slower roles read finds differently', async () => {
      setStoreSeller(STORE_SELLER);
      CACHED.delete(`${FRIEND}:boots`);
      const row = thread(FRIEND, { listingId: 'boots' });
      vi.mocked(ChatApplication.getConversations).mockResolvedValue([row] as never);
      vi.mocked(ChatApplication.getConversation).mockResolvedValue(row as never);
      vi.mocked(CommerceApplication.getMarketplaceOrders).mockResolvedValue([]);
      let finishPeerLookup: (listing: never) => void = () => undefined;
      vi.mocked(CommerceApplication.getOrFetchListingIfFound).mockImplementation(async (owner) =>
        owner === FRIEND
          ? await new Promise((resolve) => {
              finishPeerLookup = resolve as never;
            })
          : (null as never),
      );

      const read = ChatController.fetchStoreThreadRoles();
      await vi.waitFor(() =>
        expect(CommerceApplication.getOrFetchListingIfFound).toHaveBeenCalledWith(FRIEND, 'boots'),
      );
      useChatStore.getState().setStoreThreadRoles({
        viewer: VIEWER,
        soldTo: [],
        boughtFrom: [],
        soldOrders: {},
        boughtOrders: {},
        listingSides: { [`${FRIEND}:boots`]: 'viewer' },
      });
      finishPeerLookup({ id: 'boots' } as never);
      await read;

      expect(useChatStore.getState().storeThreadRoles?.listingSides[`${FRIEND}:boots`]).toBe('viewer');
      expect(await ChatController.getConversations()).toEqual([]);
    });
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
