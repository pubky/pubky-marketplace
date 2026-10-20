import { describe, expect, it } from 'vitest';
import { createOrderFixture, ORDER_FIXTURE_BUYER } from '@/test/fixtures/commerce/orders';
import { setupFixedDateLocale } from '@/test-utils/date-locale';
import {
  APPROVE_IN_BITKIT_FALLBACK_COPY,
  approveInBitkitCopy,
  approveInBitkitDeadline,
  buyerPayByDeadline,
  CHECKOUT_HOLD_COPY,
  findViewerAcceptedOfferHold,
  findViewerPendingHoldOrder,
  formatHoldDeadline,
  formatOrderInstant,
  holderBoundCopy,
  holderUnboundCopy,
  isHoldExpiredNoLateMoney,
  isLateCompletionOrder,
  isRefundRequiredPayment,
  PAYMENT_WINDOW_ELAPSED_REASON,
  refundRequiredCopyForRole,
  refundRequiredSellerCopy,
  UNBOUND_BACK_CANCEL_REASON,
} from './checkout-hold';

setupFixedDateLocale();

describe('buyerPayByDeadline', () => {
  const HOLD = '2026-08-20T21:15:00.000Z';
  const REQUEST = '2026-08-20T21:07:00.000Z';
  const activeAuction = {
    holdExpiresAt: HOLD,
    paykitExpiresAt: REQUEST,
    paykitRequestState: 'pending',
    auctionAggregateId: 'listing:seller_boots',
  };

  it('shows the activated request deadline on an auction order', () => {
    expect(buyerPayByDeadline(activeAuction)).toBe(REQUEST);
    expect(holderBoundCopy(buyerPayByDeadline(activeAuction))).toBe(
      `Pay by 20 Aug 2026, 21:07. If the window ends, the item restocks.`,
    );
  });

  it.each([
    ['not yet activated (preparing)', { paykitRequestState: 'preparing' }],
    ['no request state yet', { paykitRequestState: null }],
    ['no request deadline yet', { paykitExpiresAt: null }],
    ['a malformed request deadline', { paykitExpiresAt: 'not a date' }],
  ])('keeps the reservation-based hold deadline while %s', (_label, override) => {
    expect(buyerPayByDeadline({ ...activeAuction, ...override })).toBe(HOLD);
  });

  it('keeps the hold deadline on an order that is not an auction win', () => {
    expect(buyerPayByDeadline({ ...activeAuction, auctionAggregateId: null })).toBe(HOLD);
    expect(buyerPayByDeadline({ ...activeAuction, auctionAggregateId: undefined })).toBe(HOLD);
  });

  it('is null when nothing carries a deadline', () => {
    expect(buyerPayByDeadline({})).toBeNull();
  });
});

describe('approveInBitkitCopy', () => {
  const CREATED = '2026-10-19T12:34:58.080Z';
  const REQUEST = '2026-10-19T13:04:58.080Z';
  const HOLD = '2026-10-19T13:05:58.080Z';
  const ordinary = { createdAt: CREATED, holdExpiresAt: HOLD, paykitExpiresAt: REQUEST, paykitRequestState: 'pending' };

  it('names an approval deadline before Pay by, as Bitkit expires an unapproved request first (#358)', () => {
    expect(approveInBitkitCopy(ordinary)).toBe('Approve in Bitkit by 19 Oct 2026, 12:49.');
    expect(holderBoundCopy(buyerPayByDeadline(ordinary))).toContain('Pay by 19 Oct 2026, 13:05.');
  });

  it('is never later than the wallet deadline paykit-server sets at activation', () => {
    // paykit-server: proposal_expires_at = activated_at + min(acceptance window, payment window / 2).
    const activatedAt = new Date('2026-10-19T12:36:58.080Z').getTime();
    const wallet = activatedAt + (new Date(REQUEST).getTime() - activatedAt) / 2;
    expect(new Date(approveInBitkitDeadline(ordinary)!).getTime()).toBeLessThanOrEqual(wallet);
  });

  it('matches the 20 Oct mainnet order Bitkit expired at 21:35 CEST', () => {
    const order = {
      createdAt: '2026-10-20T19:17:00.000Z',
      paykitExpiresAt: '2026-10-20T19:47:00.000Z',
      holdExpiresAt: '2026-10-20T19:48:00.000Z',
    };
    expect(approveInBitkitDeadline(order)).toBe('2026-10-20T19:32:00.000Z');
  });

  it('falls back to the hold when the request deadline is not projected', () => {
    expect(approveInBitkitDeadline({ createdAt: CREATED, holdExpiresAt: '2026-10-19T13:34:58.080Z' })).toBe(
      '2026-10-19T13:04:58.080Z',
    );
  });

  it('names no time on an auction order, which activates long after it is created', () => {
    expect(approveInBitkitCopy({ ...ordinary, auctionAggregateId: 'listing:seller_boots' })).toBe(
      APPROVE_IN_BITKIT_FALLBACK_COPY,
    );
  });

  it.each([
    ['no deadline at all', {}],
    ['a null hold', { createdAt: CREATED, holdExpiresAt: null }],
    ['a malformed hold', { createdAt: CREATED, holdExpiresAt: 'not a date' }],
    ['no creation time', { holdExpiresAt: HOLD, paykitExpiresAt: REQUEST }],
    ['a deadline before creation', { createdAt: HOLD, paykitExpiresAt: CREATED }],
  ])('names no time for %s', (_label, order) => {
    expect(approveInBitkitCopy(order)).toBe(APPROVE_IN_BITKIT_FALLBACK_COPY);
  });

  it('never states a length of time', () => {
    expect(APPROVE_IN_BITKIT_FALLBACK_COPY).not.toMatch(/\d|minute|hour/i);
    expect(approveInBitkitCopy(ordinary)).not.toMatch(/minute|hour/i);
  });
});

describe('checkout-hold copy', () => {
  it('asks a Bitcoin buyer to settle a pending payment before ordering again, without claiming a wallet guards it', () => {
    expect(CHECKOUT_HOLD_COPY.pendingBitcoinPaymentBuyer).toBe(
      'If a payment is still pending in Bitkit, another wallet or another device, let it finish or resolve it before you order again.',
    );
    expect(CHECKOUT_HOLD_COPY.pendingBitcoinPaymentBuyer).not.toMatch(/duplicate|dedup|prevent|block/i);
    expect(CHECKOUT_HOLD_COPY.expiredNoLateMoney).toBe('Payment window elapsed. The item is available again.');
  });

  it("formats hold deadlines using Pubky's local date and time", () => {
    expect(formatHoldDeadline('2026-08-20T21:15:00.000Z')).toBe(`20 Aug 2026, 21:15`);
  });

  it('formats order timestamps with the day, and nothing for a missing or invalid value', () => {
    expect(formatOrderInstant('2026-10-01T08:10:00.000Z')).toBe(`1 Oct 2026, 08:10`);
    expect(formatOrderInstant(null)).toBeNull();
    expect(formatOrderInstant(undefined)).toBeNull();
    expect(formatOrderInstant('')).toBeNull();
    expect(formatOrderInstant('not a date')).toBeNull();
  });

  it('renders unbound and bound holder copy with the deadline', () => {
    expect(holderUnboundCopy('2026-08-20T21:15:00.000Z')).toBe(`The item is held for you until 20 Aug 2026, 21:15.`);
    expect(holderBoundCopy('2026-08-20T21:15:00.000Z')).toBe(
      `Pay by 20 Aug 2026, 21:15. If the window ends, the item restocks.`,
    );
    expect(holderUnboundCopy(null)).toBe('The item is held for you once a payment starts.');
  });

  it('detects late completion from paid plus leftover elapsed reason', () => {
    expect(isLateCompletionOrder({ state: 'paid', cancellationReason: PAYMENT_WINDOW_ELAPSED_REASON })).toBe(true);
    expect(isLateCompletionOrder({ state: 'paid', cancellationReason: null })).toBe(false);
    expect(isLateCompletionOrder({ state: 'cancelled', cancellationReason: PAYMENT_WINDOW_ELAPSED_REASON })).toBe(
      false,
    );
  });

  it('detects refund_required and elapsed-without-late-money', () => {
    expect(isRefundRequiredPayment({ reviewReason: 'refund_required' })).toBe(true);
    expect(
      isHoldExpiredNoLateMoney(
        { state: 'cancelled', cancellationReason: PAYMENT_WINDOW_ELAPSED_REASON },
        { state: 'expired', reviewReason: null },
      ),
    ).toBe(true);
    expect(
      isHoldExpiredNoLateMoney(
        { state: 'cancelled', cancellationReason: PAYMENT_WINDOW_ELAPSED_REASON },
        { state: 'manual_review', reviewReason: 'refund_required' },
      ),
    ).toBe(false);
  });

  it('picks seller refund instructions per rail', () => {
    expect(refundRequiredSellerCopy('paypal')).toBe(CHECKOUT_HOLD_COPY.refundRequiredPaypalSeller);
    expect(refundRequiredSellerCopy('bitcoin')).toBe(CHECKOUT_HOLD_COPY.refundRequiredBitcoinSeller);
    expect(refundRequiredSellerCopy('usdt')).toBe(CHECKOUT_HOLD_COPY.refundRequiredUsdtSeller);
    expect(CHECKOUT_HOLD_COPY.refundRequiredUsdtSeller).not.toMatch(/bitcoin/i);
    expect(UNBOUND_BACK_CANCEL_REASON.length).toBeGreaterThanOrEqual(1);
    expect(UNBOUND_BACK_CANCEL_REASON.length).toBeLessThanOrEqual(500);
  });

  it('splits refund_required copy by buyer vs seller role', () => {
    expect(refundRequiredCopyForRole(true, 'bitcoin')).toBe(CHECKOUT_HOLD_COPY.refundRequiredBuyer);
    expect(refundRequiredCopyForRole(true, 'paypal')).toBe(CHECKOUT_HOLD_COPY.refundRequiredBuyer);
    expect(refundRequiredCopyForRole(false, 'bitcoin')).toBe(CHECKOUT_HOLD_COPY.refundRequiredBitcoinSeller);
    expect(refundRequiredCopyForRole(false, 'paypal')).toBe(CHECKOUT_HOLD_COPY.refundRequiredPaypalSeller);
  });
});

describe('findViewerPendingHoldOrder', () => {
  const listingAggregateId = 'listing:yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy_boots_01';
  const sessionId = 'sess_not-a-pubky-identifier';

  const ownHold = {
    order: createOrderFixture('pending_payment', {
      buyerPubky: ORDER_FIXTURE_BUYER,
      lines: [
        {
          ...createOrderFixture('pending_payment').lines[0],
          listingAggregateId,
        },
      ],
    }),
  };

  it('matches the viewer pubky to a pending_payment order on this listing', () => {
    expect(findViewerPendingHoldOrder([ownHold], listingAggregateId, ORDER_FIXTURE_BUYER)).toEqual({
      orderId: ownHold.order.id,
    });
  });

  it('does not treat a session id as the hold owner', () => {
    expect(findViewerPendingHoldOrder([ownHold], listingAggregateId, sessionId)).toBeNull();
    const sessionKeyed = {
      order: { ...ownHold.order, buyerPubky: sessionId },
    };
    expect(findViewerPendingHoldOrder([sessionKeyed], listingAggregateId, ORDER_FIXTURE_BUYER)).toBeNull();
  });

  it('ignores paid orders and holds on other listings', () => {
    const paid = { order: createOrderFixture('paid', { buyerPubky: ORDER_FIXTURE_BUYER }) };
    expect(findViewerPendingHoldOrder([paid], listingAggregateId, ORDER_FIXTURE_BUYER)).toBeNull();
    expect(findViewerPendingHoldOrder([ownHold], 'listing:other_item', ORDER_FIXTURE_BUYER)).toBeNull();
  });
});

describe('findViewerAcceptedOfferHold', () => {
  const listingAggregateId = 'listing:yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy_boots_01';
  const sessionPubky = 'b'.repeat(52);
  const otherPubky = 'c'.repeat(52);
  const activeAward = { state: 'active' as const };

  const ownOffer = {
    id: '018f47d2-6a27-7c23-b51e-000000000003',
    state: 'accepted',
    buyerPubky: sessionPubky,
    listingAggregateId,
    award: activeAward,
  };

  it('links the award buyer to checkout when the accepted offer buyerPubky matches the session pubky', () => {
    expect(findViewerAcceptedOfferHold([ownOffer], listingAggregateId, sessionPubky)).toEqual({
      offerId: ownOffer.id,
    });
  });

  it("does not treat another pubky accepted offer as the viewer's hold", () => {
    expect(
      findViewerAcceptedOfferHold([{ ...ownOffer, buyerPubky: otherPubky }], listingAggregateId, sessionPubky),
    ).toBeNull();
  });

  it('does not claim an offer hold without an active session pubky', () => {
    expect(findViewerAcceptedOfferHold([ownOffer], listingAggregateId, null)).toBeNull();
    expect(findViewerAcceptedOfferHold([ownOffer], listingAggregateId, undefined)).toBeNull();
  });

  it('ignores an accepted offer that does not hold this listing', () => {
    expect(findViewerAcceptedOfferHold([ownOffer], 'listing:other_item', sessionPubky)).toBeNull();
    expect(
      findViewerAcceptedOfferHold([{ ...ownOffer, award: { state: 'expired' } }], listingAggregateId, sessionPubky),
    ).toBeNull();
    expect(
      findViewerAcceptedOfferHold([{ ...ownOffer, state: 'pending' }], listingAggregateId, sessionPubky),
    ).toBeNull();
    expect(
      findViewerAcceptedOfferHold([{ ...ownOffer, award: undefined }], listingAggregateId, sessionPubky),
    ).toBeNull();
  });
});
