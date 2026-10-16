import { describe, expect, it } from 'vitest';
import { createPaymentFixture } from '@/test/fixtures/commerce/orders';
import { createPaykitOrderFixture } from '@/test/fixtures/commerce/paykit-orders';
import {
  bitcoinPaidConfirmation,
  bitcoinPaymentHasBeenSeen,
  buyerBitcoinWalletCopy,
  buyerCheckoutProgressCopy,
  sellerBitcoinDecision,
} from './bitcoin-buyer-status';
import { bitcoinPaymentBreakdown, orderAmountEntry } from './bitcoin-payment-code';
import { isSellerBoundBitcoinOrder, isSellerReservation, isSellerSalesOrder } from './checkout-phase';
import {
  isUsdtFulfilmentBlocked,
  usdtAmountLabel,
  usdtPaidAsLine,
  usdtPhaseCopy,
  usdtSettlementPhase,
} from './usdt-buyer-status';
import { isUsdtPaymentReviewOrder, paymentReviewRail } from './usdt-payment-review';
import { isUsdtRefundOrder } from './usdt-refund';

const SELLER = 's'.repeat(52);
const BUYER = 'b'.repeat(52);
const NOW = Date.parse('2026-08-20T21:00:00.000Z');

describe('a single-bind Paykit order before any payment', () => {
  const { order, payment } = createPaykitOrderFixture('unpaid');

  it('is neither a Bitcoin nor a USDT order, so no rail copy applies yet', () => {
    expect(usdtSettlementPhase(order, payment)).toBeNull();
    expect(usdtPhaseCopy(order, payment, true)).toBeNull();
    expect(usdtAmountLabel(order)).toBeNull();
    expect(isUsdtFulfilmentBlocked(order)).toBe(false);
    expect(isUsdtPaymentReviewOrder(order)).toBe(false);
    expect(isUsdtRefundOrder(order)).toBe(false);
    expect(bitcoinPaidConfirmation(order, payment)).toBeNull();
  });

  it('shows the reserved-while-you-pay line, not a Bitcoin or USDT line', () => {
    expect(buyerCheckoutProgressCopy(order, payment, NOW)).toBe('Awaiting payment · Item reserved · 15:00');
    expect(buyerBitcoinWalletCopy(order, payment).kind).toBe('pay');
  });

  it('is a seller reservation until a Bitcoin payment is seen', () => {
    expect(isSellerBoundBitcoinOrder(order)).toBe(false);
    expect(isSellerReservation(order, SELLER, payment)).toBe(true);
    expect(isSellerSalesOrder(order, SELLER, payment)).toBe(false);
  });

  it('becomes a seller sale and follows the Bitcoin tables once the service sees a Bitcoin payment', () => {
    const seen = { ...order, paykitRequestState: 'awaiting_seller_confirmation' as const };
    expect(isSellerBoundBitcoinOrder(seen)).toBe(true);
    expect(isSellerSalesOrder(seen, SELLER, payment)).toBe(true);
    expect(sellerBitcoinDecision(seen, payment)).toBe('confirm');
    expect(bitcoinPaymentHasBeenSeen(seen, payment)).toBe(true);
    expect(usdtSettlementPhase(seen, payment)).toBeNull();
  });

  it('shows the Bitcoin amount breakdown when the order already carries one', () => {
    const quoted = {
      ...order,
      subtotal: { amountMinor: 50_000, currency: 'SAT', exponent: 0 },
      shipping: { amountMinor: 1_200, currency: 'SAT', exponent: 0 },
      paykitTotalSats: 51_637,
    };
    expect(bitcoinPaymentBreakdown(quoted)?.payable.amountMinor).toBe(51_637);
  });

  it('lets a seller resolve a payment held for review when no rail was observed', () => {
    const review = createPaymentFixture('manual_review', { adapter: 'paykit' });
    expect(sellerBitcoinDecision(order, review)).toBe('resolve');
    expect(paymentReviewRail(order)).toBe('bitcoin');
  });
});

describe('a single-bind Paykit order paid in Bitcoin', () => {
  const { order, payment } = createPaykitOrderFixture('paid-bitcoin');

  it('reads every Bitcoin table off the observed asset', () => {
    expect(bitcoinPaidConfirmation(order, payment)).toMatchObject({ sellerConfirmed: true });
    expect(usdtSettlementPhase(order, payment)).toBeNull();
    expect(isUsdtFulfilmentBlocked(order)).toBe(false);
    expect(isUsdtRefundOrder(order)).toBe(false);
  });

  it('records a refund in satoshis', () => {
    const sats = { ...order, total: { amountMinor: 1_255, currency: 'SAT', exponent: 0 } };
    expect(orderAmountEntry(sats)).toEqual({ amountMinor: 1_255, exponent: 0, unitLabel: '₿' });
  });

  it('is never held back by USDT finality', () => {
    expect(isUsdtFulfilmentBlocked({ ...order, paymentFinality: 'pending' })).toBe(false);
  });
});

describe('a single-bind Paykit order paid in USDT', () => {
  const { order, payment } = createPaykitOrderFixture('paid-usdt');

  it('reads every USDT table off the observed asset', () => {
    expect(usdtSettlementPhase(order, payment)).toBe('received');
    expect(usdtAmountLabel(order)).toBe('137.000000 USDT');
    expect(usdtPaidAsLine(order)).toBe('$137.00, paid as 137.000000 USDT');
    expect(bitcoinPaidConfirmation(order, payment)).toBeNull();
    expect(isUsdtPaymentReviewOrder(order)).toBe(true);
    expect(paymentReviewRail(order)).toBe('usdt');
    expect(isUsdtRefundOrder(order)).toBe(true);
  });

  it('holds physical fulfilment until payment_finality is final', () => {
    expect(isUsdtFulfilmentBlocked({ ...order, paymentFinality: 'pending' })).toBe(true);
    expect(isUsdtFulfilmentBlocked({ ...order, paymentFinality: 'reverted' })).toBe(true);
    expect(isUsdtFulfilmentBlocked({ ...order, paymentFinality: undefined })).toBe(true);
    expect(isUsdtFulfilmentBlocked({ ...order, paymentFinality: 'final' })).toBe(false);
  });

  it('never follows the Bitcoin flow, even with a request state', () => {
    const withState = { ...order, paykitRequestState: 'detected' as const };
    expect(bitcoinPaymentHasBeenSeen(withState, payment)).toBe(false);
    expect(sellerBitcoinDecision(withState, payment)).toBeNull();
    expect(isSellerBoundBitcoinOrder({ ...withState, state: 'pending_payment' })).toBe(false);
  });
});

describe('a legacy order placed before the single bind', () => {
  it('still follows its method when no asset was recorded', () => {
    const legacyBitcoin = { paymentMethod: 'bitcoin' as const, paykitRequestState: 'pending' as const };
    expect(
      isSellerBoundBitcoinOrder({ ...legacyBitcoin, state: 'pending_payment', sellerPubky: SELLER, buyerPubky: BUYER }),
    ).toBe(true);
    expect(sellerBitcoinDecision({ ...legacyBitcoin, paykitRequestState: 'awaiting_seller_confirmation' }, null)).toBe(
      'confirm',
    );
  });
});
