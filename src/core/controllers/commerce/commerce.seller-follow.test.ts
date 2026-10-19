import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import {
  CommerceApplication,
  type CommerceCheckoutFulfillmentInput,
  type CommerceCheckoutLineInput,
} from '@/application/commerce/commerce';
import { UserApplication } from '@/application/user/user';
import { Logger } from '@/libs/logger/logger';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { COMMERCE_FIXTURE_BUYER, COMMERCE_FIXTURE_SELLER } from '@/test/fixtures/commerce/commerce';
import { CommerceController } from './commerce';

const BUYER = COMMERCE_FIXTURE_BUYER;
const SELLER = COMMERCE_FIXTURE_SELLER;
const OTHER_SELLER = 'o'.repeat(52);
const LISTING_ID = 'boots_01';
const LISTING_AGGREGATE = `listing:${SELLER}_${LISTING_ID}`;

const OK = { ok: true } as Awaited<ReturnType<typeof CommerceApplication.executeMarketplaceCommand>>;
const REFUSED = { ok: false, error: { code: 'INVALID_STATE', message: 'refused' } } as Awaited<
  ReturnType<typeof CommerceApplication.executeMarketplaceCommand>
>;

const baseCommand = {
  version: 1,
  commandId: '00000000-0000-4000-8000-000000000820',
  expectedRevision: 1,
  issuedAt: '2026-08-19T23:00:00.000Z',
};

const money = { amountMinor: 10_000, currency: 'USD', exponent: 2 };

const checkoutLine = (sellerPubky: string, listingId: string): CommerceCheckoutLineInput => ({
  listingAggregateId: `listing:${sellerPubky}_${listingId}`,
  sellerPubky,
  publishedFulfillmentMethods: ['shipping'],
  expectedRevision: 1,
  quantity: 1,
});

describe('CommerceController seller auto-follow', () => {
  let ensure: MockInstance<typeof UserApplication.ensureSellerFollow>;

  beforeEach(() => {
    vi.restoreAllMocks();
    ensure = vi.spyOn(UserApplication, 'ensureSellerFollow').mockResolvedValue(undefined);
    useAuthStore.setState({ currentUserPubky: BUYER });
    useCommerceStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('follows the seller when the buyer adds to the cart', async () => {
    vi.spyOn(CommerceApplication, 'commitUpsertCartItem').mockResolvedValue(undefined);

    await CommerceController.commitUpsertCartItem(`${SELLER}:${LISTING_ID}`, 'default', 1);

    expect(ensure).toHaveBeenCalledOnce();
    expect(ensure).toHaveBeenCalledWith({ follower: BUYER, seller: SELLER });
  });

  it('follows the seller when an awarded offer goes to the cart', async () => {
    vi.spyOn(CommerceApplication, 'commitUpsertAwardCartItem').mockResolvedValue(undefined);

    await CommerceController.commitUpsertAwardCartItem(
      `${SELLER}:${LISTING_ID}`,
      'default',
      1,
      '00000000-0000-4000-8000-000000000821',
      2,
    );

    expect(ensure).toHaveBeenCalledWith({ follower: BUYER, seller: SELLER });
  });

  it('does not follow when the cart write is rejected', async () => {
    vi.spyOn(CommerceApplication, 'commitUpsertCartItem').mockRejectedValue(new Error('cart failed'));

    await expect(CommerceController.commitUpsertCartItem(`${SELLER}:${LISTING_ID}`, 'default', 1)).rejects.toThrow(
      'cart failed',
    );

    expect(ensure).not.toHaveBeenCalled();
  });

  it('follows the seller when the buyer adds to the watchlist, but not when removing', async () => {
    vi.spyOn(CommerceApplication, 'commitCreateFavorite').mockResolvedValue(undefined);
    vi.spyOn(CommerceApplication, 'commitDeleteFavorite').mockResolvedValue(undefined);
    vi.spyOn(CommerceController, 'syncWatchlist').mockResolvedValue(undefined as never);

    await CommerceController.commitDeleteFavorite(`${SELLER}:${LISTING_ID}`);
    expect(ensure).not.toHaveBeenCalled();

    await CommerceController.commitCreateFavorite(`${SELLER}:${LISTING_ID}`);
    expect(ensure).toHaveBeenCalledWith({ follower: BUYER, seller: SELLER });
  });

  it('follows the seller when the buyer follows the shop, but not when unfollowing it', async () => {
    vi.spyOn(CommerceApplication, 'commitCreateShopFollow').mockResolvedValue(undefined);
    vi.spyOn(CommerceApplication, 'commitDeleteShopFollow').mockResolvedValue(undefined);

    await CommerceController.commitDeleteShopFollow(SELLER);
    expect(ensure).not.toHaveBeenCalled();

    await CommerceController.commitCreateShopFollow(SELLER);
    expect(ensure).toHaveBeenCalledWith({ follower: BUYER, seller: SELLER });
  });

  it('follows the seller after a successful offer and bid, from the listing aggregate', async () => {
    vi.spyOn(CommerceApplication, 'executeMarketplaceCommand').mockResolvedValue(OK);

    await CommerceController.executeMarketplaceCommand({
      ...baseCommand,
      aggregateId: LISTING_AGGREGATE,
      kind: 'offer.create',
      payload: { amount: money, quantity: 1, expiresInSeconds: 3600, message: '' },
    });
    await CommerceController.executeMarketplaceCommand({
      ...baseCommand,
      aggregateId: LISTING_AGGREGATE,
      kind: 'auction.place_bid',
      payload: { maximumAmount: money },
    });

    expect(ensure).toHaveBeenCalledTimes(2);
    expect(ensure).toHaveBeenNthCalledWith(1, { follower: BUYER, seller: SELLER });
    expect(ensure).toHaveBeenNthCalledWith(2, { follower: BUYER, seller: SELLER });
  });

  it('does not follow when the offer or bid is refused', async () => {
    vi.spyOn(CommerceApplication, 'executeMarketplaceCommand').mockResolvedValue(REFUSED);

    await CommerceController.executeMarketplaceCommand({
      ...baseCommand,
      aggregateId: LISTING_AGGREGATE,
      kind: 'auction.place_bid',
      payload: { maximumAmount: money },
    });

    expect(ensure).not.toHaveBeenCalled();
  });

  it('does not follow for marketplace commands that are not an offer or bid', async () => {
    vi.spyOn(CommerceApplication, 'executeMarketplaceCommand').mockResolvedValue(OK);

    await CommerceController.executeMarketplaceCommand({
      ...baseCommand,
      aggregateId: `offer:00000000-0000-4000-8000-000000000822`,
      kind: 'offer.withdraw',
      payload: { offerId: '00000000-0000-4000-8000-000000000822' },
    });

    expect(ensure).not.toHaveBeenCalled();
  });

  it('follows every distinct seller once after a successful checkout', async () => {
    const commit = vi.spyOn(CommerceApplication, 'commitCreateMarketplaceCheckout').mockResolvedValue(OK);
    const input = {
      lines: [checkoutLine(SELLER, 'boots_01'), checkoutLine(SELLER, 'boots_02'), checkoutLine(OTHER_SELLER, 'hat_01')],
    } as CommerceCheckoutFulfillmentInput;

    await CommerceController.commitCreateMarketplaceCheckout(input);

    expect(commit).toHaveBeenCalledWith(BUYER, input);
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(ensure).toHaveBeenCalledWith({ follower: BUYER, seller: SELLER });
    expect(ensure).toHaveBeenCalledWith({ follower: BUYER, seller: OTHER_SELLER });
  });

  it('does not follow when checkout is refused', async () => {
    vi.spyOn(CommerceApplication, 'commitCreateMarketplaceCheckout').mockResolvedValue(REFUSED);

    await CommerceController.commitCreateMarketplaceCheckout({ lines: [checkoutLine(SELLER, 'boots_01')] });

    expect(ensure).not.toHaveBeenCalled();
  });

  it('follows the seller after a successful offer checkout', async () => {
    vi.spyOn(CommerceApplication, 'commitOfferCheckout').mockResolvedValue(OK);

    await CommerceController.commitOfferCheckout({
      ...baseCommand,
      aggregateId: 'offer:00000000-0000-4000-8000-000000000823',
      kind: 'offer.checkout',
      payload: {
        offerId: '00000000-0000-4000-8000-000000000823',
        awardId: '00000000-0000-4000-8000-000000000824',
        listingAggregateId: LISTING_AGGREGATE,
        listingRevision: 1,
        listingRecordSha256: 'a'.repeat(64),
        variantId: 'default',
        quantity: 1,
        fulfillment: 'pickup',
      },
    });

    expect(ensure).toHaveBeenCalledWith({ follower: BUYER, seller: SELLER });
  });

  it('never blocks the buyer action when the follow fails, and reports the failure quietly', async () => {
    const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(CommerceApplication, 'commitUpsertCartItem').mockResolvedValue(undefined);
    ensure.mockRejectedValue(new Error('homeserver unavailable'));

    await expect(
      CommerceController.commitUpsertCartItem(`${SELLER}:${LISTING_ID}`, 'default', 1),
    ).resolves.toBeUndefined();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
  });

  it('does not wait for the follow before resolving the buyer action', async () => {
    vi.spyOn(CommerceApplication, 'commitUpsertCartItem').mockResolvedValue(undefined);
    let release: () => void = () => undefined;
    ensure.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));

    await expect(
      CommerceController.commitUpsertCartItem(`${SELLER}:${LISTING_ID}`, 'default', 1),
    ).resolves.toBeUndefined();

    release();
  });
});
