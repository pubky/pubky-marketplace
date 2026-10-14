import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatApplication } from '@/application/chat/chat';
import { CommerceApplication } from '@/application/commerce/commerce';
import { UserApplication } from '@/application/user/user';
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
