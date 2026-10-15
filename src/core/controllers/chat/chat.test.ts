import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatApplication } from '@/application/chat/chat';
import { CommerceApplication } from '@/application/commerce/commerce';
import { UserApplication } from '@/application/user/user';
import { CHAT_PING_MAX_HANDLING_ATTEMPTS } from '@/config/chat';
import { ChatController } from '@/controllers/chat/chat';
import { useAuthStore } from '@/stores/auth/auth.store';

const BUYER = 'b'.repeat(52);
const SELLER = 's'.repeat(52);

/** Waits for the best-effort follow, which runs after the send returns. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ChatController.commitSendMessage follow-on-intent', () => {
  beforeEach(() => {
    vi.spyOn(ChatApplication, 'queueMessage').mockResolvedValue('message-id');
    vi.spyOn(ChatController, 'commitFlushOutbox').mockResolvedValue();
    vi.spyOn(UserApplication, 'ensureSellerFollow').mockResolvedValue();
    vi.spyOn(CommerceApplication, 'getMarketplaceOrders').mockResolvedValue([
      { id: 'order-1', buyerPubky: BUYER, sellerPubky: SELLER },
    ] as never);
    vi.spyOn(CommerceApplication, 'getListing').mockImplementation(async (compositeId: string) =>
      compositeId === `${SELLER}:boots-1` ? ({ id: compositeId } as never) : null,
    );
  });

  afterEach(() => {
    useAuthStore.setState({ currentUserPubky: null });
    vi.restoreAllMocks();
  });

  it('follows the seller when the buyer writes about their order', async () => {
    useAuthStore.setState({ currentUserPubky: BUYER });
    await ChatController.commitSendMessage({
      peerPubky: SELLER,
      body: 'Shipped yet?',
      context: { orderId: 'order-1' },
    });
    await settle();
    expect(UserApplication.ensureSellerFollow).toHaveBeenCalledWith({ follower: BUYER, seller: SELLER });
  });

  it('does not follow the buyer when the seller replies about the same order', async () => {
    useAuthStore.setState({ currentUserPubky: SELLER });
    await ChatController.commitSendMessage({ peerPubky: BUYER, body: 'Shipped.', context: { orderId: 'order-1' } });
    await settle();
    expect(UserApplication.ensureSellerFollow).not.toHaveBeenCalled();
  });

  it('follows the seller when the buyer writes about a listing that is theirs', async () => {
    useAuthStore.setState({ currentUserPubky: BUYER });
    await ChatController.commitSendMessage({ peerPubky: SELLER, body: 'Size 43?', context: { listingId: 'boots-1' } });
    await settle();
    expect(UserApplication.ensureSellerFollow).toHaveBeenCalledWith({ follower: BUYER, seller: SELLER });
  });

  it('ignores a listing context the peer does not own, and messages without context', async () => {
    useAuthStore.setState({ currentUserPubky: SELLER });
    await ChatController.commitSendMessage({ peerPubky: BUYER, body: 'Hi', context: { listingId: 'boots-1' } });
    await ChatController.commitSendMessage({ peerPubky: BUYER, body: 'Hello' });
    await settle();
    expect(UserApplication.ensureSellerFollow).not.toHaveBeenCalled();
  });
});

describe('ChatController.handleInboxPings', () => {
  const PEER = 'p'.repeat(52);
  const folder = 'f'.repeat(32);
  const payload = JSON.stringify({ v: 0, t: 'chat', folder, file: '1700000000000-aaaaaaaa.json' });
  const ping = (slot: string, body: string, revision = 'r1') => ({
    sender: PEER,
    slot,
    revision,
    received_at: '',
    expires_at: '',
    payload: body,
  });

  beforeEach(() => {
    useAuthStore.setState({ currentUserPubky: 'm'.repeat(52) });
    vi.spyOn(ChatController, 'getOrFetchIdentity').mockResolvedValue('ready');
  });

  afterEach(() => {
    useAuthStore.setState({ currentUserPubky: null });
    vi.restoreAllMocks();
  });

  it('handles nothing, and acks nothing, while the sign-in lacks the chat scopes', async () => {
    vi.spyOn(ChatController, 'getOrFetchIdentity').mockResolvedValue('needs_reauth');
    const handle = vi.spyOn(ChatApplication, 'handlePing').mockResolvedValue();

    expect(await ChatController.handleInboxPings([ping(`chat-${folder}`, payload)])).toEqual([]);
    expect(handle).not.toHaveBeenCalled();
  });

  it("acks handled chat pings, drops unreadable ones, and never touches another app's slot", async () => {
    const handle = vi.spyOn(ChatApplication, 'handlePing').mockResolvedValue();
    const ours = ping(`chat-${folder}`, payload);
    const junk = ping(`chat-${folder}`, 'not json', 'r2');
    const foreign = ping(`app-${folder}`, payload, 'r3');

    const acked = await ChatController.handleInboxPings([foreign, junk, ours]);

    expect(handle).toHaveBeenCalledTimes(1);
    expect(acked.map((ref) => ref.revision).sort()).toEqual(['r1', 'r2']);
  });

  it('leaves a failing chat ping on the inbox, then drops it after repeated failures', async () => {
    vi.spyOn(ChatApplication, 'handlePing').mockRejectedValue(new Error('peer homeserver down'));
    const failing = ping(`chat-${folder}`, payload, 'r9');
    const outcomes: number[] = [];
    for (let attempt = 1; attempt <= CHAT_PING_MAX_HANDLING_ATTEMPTS; attempt += 1) {
      outcomes.push((await ChatController.handleInboxPings([failing])).length);
    }
    expect(outcomes).toEqual([...Array.from({ length: CHAT_PING_MAX_HANDLING_ATTEMPTS - 1 }, () => 0), 1]);
  });
});
