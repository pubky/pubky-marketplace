import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatApplication } from '@/application/chat/chat';
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
];

const peers = (rows: { peer_pubky: string }[]) => rows.map(({ peer_pubky }) => peer_pubky);

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
    vi.spyOn(ChatApplication, 'openConversation').mockResolvedValue({ state: 'ready' } as never);
    vi.spyOn(CommerceApplication, 'getMarketplaceOrders').mockResolvedValue([
      { id: 'order-bought', buyerPubky: VIEWER, sellerPubky: STORE_SELLER },
      { id: 'order-sold', buyerPubky: MY_BUYER, sellerPubky: VIEWER },
    ] as never);
    vi.spyOn(CommerceApplication, 'getListing').mockImplementation(async (compositeId: string) =>
      compositeId === `${OTHER_SELLER}:boots` ? ({ id: compositeId } as never) : null,
    );
    vi.spyOn(UserApplication, 'ensureSellerFollow').mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    setStoreSeller(undefined);
    useChatStore.getState().reset();
    useAuthStore.setState({ currentUserPubky: null });
    vi.restoreAllMocks();
  });

  it('hides the sale threads of another seller and keeps its buyer threads and plain messages', async () => {
    setStoreSeller(STORE_SELLER);
    await ChatController.fetchStoreThreadRoles();

    expect(peers(await ChatController.getConversations())).toEqual([STORE_SELLER, FRIEND, OTHER_SELLER]);
    expect(await ChatController.getUnreadConversationCount()).toBe(3);
    expect(await ChatController.getConversation(MY_BUYER)).toBeNull();
    expect(await ChatController.getMessages(MY_BUYER)).toEqual([]);
    expect(await ChatController.getMessageCount(MY_BUYER)).toBe(0);
    expect(await ChatController.getMessages(STORE_SELLER)).toHaveLength(1);
  });

  it('hides every thread about an order until the roles are read', async () => {
    setStoreSeller(STORE_SELLER);

    expect(peers(await ChatController.getConversations())).toEqual([FRIEND, OTHER_SELLER]);
  });

  it('refuses to write in a sale thread or about a sale, and writes in a buyer thread', async () => {
    setStoreSeller(STORE_SELLER);
    const refused = { code: 'FORBIDDEN', operation: 'assertCanSellHere' };

    await expect(ChatController.commitSendMessage({ peerPubky: MY_BUYER, body: 'Shipped.' })).rejects.toMatchObject(
      refused,
    );
    await expect(
      ChatController.commitSendMessage({ peerPubky: FRIEND, body: 'Hi', context: { orderId: 'order-sold' } }),
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
    }
    expect(CommerceApplication.getMarketplaceOrders).not.toHaveBeenCalled();
    expect(ChatApplication.getConversation).not.toHaveBeenCalled();
  });
});
