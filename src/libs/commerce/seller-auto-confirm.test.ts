import { describe, expect, it } from 'vitest';
import type { MarketplaceOrder } from '@/services/marketplace/marketplace';
import { createOrderFixture } from '@/test/fixtures/commerce/orders';
import { autoConfirmableRail, awaitsSellerConfirmation, mayAwaitSellerConfirmation } from './seller-auto-confirm';

const SELLER = 's'.repeat(52);

function waitingPaykit(
  observation: MarketplaceOrder['paykitObservation'] = { amountMatched: true, disappeared: false },
) {
  return createOrderFixture('pending_payment', {
    sellerPubky: SELLER,
    paymentMethod: 'paykit',
    paykitRequestState: 'awaiting_seller_confirmation',
    paykitObservation: observation,
  });
}

function seenPaypal(overrides: Partial<MarketplaceOrder> = {}) {
  return createOrderFixture('pending_payment', {
    sellerPubky: SELLER,
    paymentMethod: 'paypal',
    paymentConfirmation: 'seller',
    gatewayPaymentSeenAt: '2026-10-28T09:00:00.000Z',
    ...overrides,
  });
}

describe('autoConfirmableRail', () => {
  it('confirms a Paykit payment that matched and is still there', () => {
    expect(autoConfirmableRail(waitingPaykit(), SELLER)).toBe('paykit');
  });

  it('leaves a short, vanished or unread Paykit observation to the seller', () => {
    expect(autoConfirmableRail(waitingPaykit({ amountMatched: false }), SELLER)).toBeNull();
    expect(autoConfirmableRail(waitingPaykit({ amountMatched: true, disappeared: true }), SELLER)).toBeNull();
    expect(autoConfirmableRail(waitingPaykit({}), SELLER)).toBeNull();
  });

  it('confirms a PayPal payment PayPal reported with nothing taken back', () => {
    expect(autoConfirmableRail(seenPaypal(), SELLER)).toBe('paypal');
  });

  it('leaves a refunded, reversed or unreported PayPal payment to the seller', () => {
    expect(
      autoConfirmableRail(
        seenPaypal({ externalRefund: { amountMinor: 100, transactionId: 'R', recordedAt: '2026-10-28T09:01:00Z' } }),
        SELLER,
      ),
    ).toBeNull();
    expect(autoConfirmableRail(seenPaypal({ paymentReversedAt: '2026-10-28T09:01:00Z' }), SELLER)).toBeNull();
    expect(autoConfirmableRail(seenPaypal({ gatewayPaymentSeenAt: null }), SELLER)).toBeNull();
  });

  it('only ever acts for this seller on an open, unpaid order', () => {
    expect(autoConfirmableRail(waitingPaykit(), 'b'.repeat(52))).toBeNull();
    expect(autoConfirmableRail({ ...seenPaypal(), state: 'cancelled' }, SELLER)).toBeNull();
    expect(autoConfirmableRail({ ...waitingPaykit(), receiptId: crypto.randomUUID() }, SELLER)).toBeNull();
  });
});

describe('mayAwaitSellerConfirmation', () => {
  it('picks the list rows worth re-reading', () => {
    expect(mayAwaitSellerConfirmation(waitingPaykit({}), SELLER)).toBe(true);
    expect(mayAwaitSellerConfirmation(seenPaypal(), SELLER)).toBe(true);
    expect(mayAwaitSellerConfirmation(createOrderFixture('pending_payment', { sellerPubky: SELLER }), SELLER)).toBe(
      false,
    );
    expect(mayAwaitSellerConfirmation(waitingPaykit(), 'b'.repeat(52))).toBe(false);
  });
});

describe('awaitsSellerConfirmation', () => {
  const awaiting = { state: 'awaiting_entitlement' };
  const paypal = (overrides: Partial<MarketplaceOrder>) =>
    createOrderFixture('pending_payment', { paymentMethod: 'paypal', ...overrides });

  it('is the money a pending order holds for its seller to confirm', () => {
    expect(awaitsSellerConfirmation(waitingPaykit(), awaiting)).toBe(true);
    expect(awaitsSellerConfirmation(paypal({ paymentReportedAt: '2026-10-28T18:45:00.000Z' }), awaiting)).toBe(true);
    expect(awaitsSellerConfirmation(paypal({ gatewayPaymentSeenAt: '2026-10-28T18:45:00.000Z' }), awaiting)).toBe(true);
  });

  it('is not a hold nobody paid, a paid order, or a payment already decided', () => {
    expect(awaitsSellerConfirmation(paypal({}), awaiting)).toBe(false);
    expect(
      awaitsSellerConfirmation(paypal({ paymentReportedAt: '2026-10-28T18:45:00.000Z' }), { state: 'confirmed' }),
    ).toBe(false);
    expect(awaitsSellerConfirmation(waitingPaykit(), { state: 'manual_review' })).toBe(false);
    expect(
      awaitsSellerConfirmation(
        createOrderFixture('paid', { paymentMethod: 'paypal', gatewayPaymentSeenAt: '2026-10-28T18:45:00.000Z' }),
        awaiting,
      ),
    ).toBe(false);
  });
});
