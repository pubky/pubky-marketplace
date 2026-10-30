import { describe, expect, it } from 'vitest';
import { BITCOIN_BUYER_STATUS_TABLE } from '@/libs/commerce/bitcoin-buyer-status';
import { createPaymentFixture } from '@/test/fixtures/commerce/orders';
import { createUsdtOrderFixture } from '@/test/fixtures/commerce/usdt-orders';
import {
  isUsdtFulfilmentBlocked,
  USDT_ABANDONED_ADDRESS_CONFIRMED_COPY,
  USDT_BUYER_PHASE_COPY,
  USDT_FINALITY_EXPECTATION_COPY,
  USDT_MULTI_SELLER_COPY,
  USDT_PHASE_BADGE_LABEL,
  USDT_SELLER_PHASE_COPY,
  usdtAmountLabel,
  usdtFulfilmentWaitsForFinality,
  usdtPaidAsLine,
  usdtParityMillionths,
  usdtPhaseCopy,
  usdtReceivedLine,
  usdtSettlementPhase,
} from './usdt-buyer-status';

const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD', exponent: 2 });

describe('usdtSettlementPhase', () => {
  it('walks awaiting, received (inclusion, not final), final and re-checking', () => {
    const phases = (['awaiting', 'received', 'final', 'rechecking'] as const).map((phase) => {
      const { order, payment } = createUsdtOrderFixture(phase);
      return usdtSettlementPhase(order, payment);
    });
    expect(phases).toEqual(['awaiting', 'received', 'final', 'rechecking']);
  });

  it('fails closed to received when a paid USDT order reports no finality', () => {
    const { order, payment } = createUsdtOrderFixture('final', { paymentFinality: undefined });
    expect(usdtSettlementPhase(order, payment)).toBe('received');
    expect(isUsdtFulfilmentBlocked(order)).toBe(true);
  });

  it('puts a manual-review payment in review whatever its finality', () => {
    const { order } = createUsdtOrderFixture('final');
    expect(usdtSettlementPhase(order, createPaymentFixture('manual_review', { adapter: 'paykit' }))).toBe('review');
  });

  it('names a received payment whose review ended abandoned, never as awaited', () => {
    const { order } = createUsdtOrderFixture('final', { state: 'cancelled', receiptId: null, paymentFinality: null });
    const abandoned = createPaymentFixture('expired', { resolutionOutcome: 'abandoned' });
    expect(usdtSettlementPhase(order, abandoned)).toBe('abandoned');
    expect(usdtPhaseCopy(order, abandoned, true)).toMatch(/^Your USDT payment was received but not applied/);
    expect(usdtPhaseCopy(order, abandoned, false)).toMatch(/^The buyer's USDT payment was received but not applied/);
    expect(usdtSettlementPhase(order, createPaymentFixture('expired'))).toBe('awaiting');
  });

  it('follows an abandoned payment to its refund: the address, then the recorded refund', () => {
    const { order } = createUsdtOrderFixture('final', { state: 'cancelled', receiptId: null, paymentFinality: null });
    const abandoned = createPaymentFixture('expired', { resolutionOutcome: 'abandoned' });
    const withAddress = { ...order, refundDestination: { address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045' } };
    expect(usdtSettlementPhase(withAddress, abandoned)).toBe('abandoned');
    expect(usdtPhaseCopy(withAddress, abandoned, true)).toBe(USDT_ABANDONED_ADDRESS_CONFIRMED_COPY.buyer);
    expect(usdtPhaseCopy(withAddress, abandoned, false)).toBe(USDT_ABANDONED_ADDRESS_CONFIRMED_COPY.seller);
    expect(usdtPhaseCopy(withAddress, abandoned, true)).not.toMatch(/Confirm a refund address/);

    const refunded = {
      ...withAddress,
      state: 'refunded_external' as const,
      externalRefund: {
        amountMinor: 13_600,
        transactionId: `0x${'ab'.repeat(32)}`,
        recordedAt: '2026-10-28T19:00:00.000Z',
      },
    };
    expect(usdtSettlementPhase(refunded, abandoned)).toBe('refunded');
    expect(usdtPhaseCopy(refunded, abandoned, true)).toBe(USDT_BUYER_PHASE_COPY.refunded);
    expect(usdtPhaseCopy(refunded, abandoned, false)).toBe(USDT_SELLER_PHASE_COPY.refunded);
    expect(USDT_PHASE_BADGE_LABEL.refunded).toBe('Refunded');
  });

  it('names what an unapplied payment sent, not the quote, and nothing without an observation', () => {
    const { order } = createUsdtOrderFixture('final', { state: 'cancelled', receiptId: null });
    expect(usdtReceivedLine({ ...order, paykitObservation: { asset: 'USDT', observedUnits: 136_000_000 } })).toBe(
      '136.000000 USDT received',
    );
    expect(usdtReceivedLine({ ...order, paykitObservation: { asset: 'USDT', observedUnits: null } })).toBeNull();
    expect(usdtReceivedLine({ ...order, paykitObservation: null })).toBeNull();
  });

  it('is null for every order that is not a USDT order', () => {
    for (const method of ['bitcoin', 'paypal', null] as const) {
      const { order, payment } = createUsdtOrderFixture('final', { paymentMethod: method, paymentAsset: null });
      expect(usdtSettlementPhase(order, payment)).toBeNull();
      expect(usdtPhaseCopy(order, payment, true)).toBeNull();
      expect(usdtAmountLabel(order)).toBeNull();
      expect(usdtPaidAsLine(order)).toBeNull();
      expect(isUsdtFulfilmentBlocked(order)).toBe(false);
    }
  });
});

describe('USDT finality gate', () => {
  it('blocks ship, mark ready and pickup until the payment is final', () => {
    expect(isUsdtFulfilmentBlocked(createUsdtOrderFixture('received').order)).toBe(true);
    expect(isUsdtFulfilmentBlocked(createUsdtOrderFixture('rechecking').order)).toBe(true);
    expect(isUsdtFulfilmentBlocked(createUsdtOrderFixture('final').order)).toBe(false);
  });
});

describe('USDT status copy', () => {
  it('uses the agreed buyer and seller sentences for each phase', () => {
    expect(USDT_BUYER_PHASE_COPY).toEqual({
      awaiting: 'Waiting for your USDT payment',
      seen: 'USDT payment received. The seller confirms it, then your order is paid.',
      received: 'USDT payment received. The seller ships once Arbitrum finalizes it.',
      final: 'USDT payment confirmed',
      rechecking: "Your payment is being re-checked on Arbitrum. You don't need to do anything yet.",
      abandoned:
        'Your USDT payment was received but not applied to the order. Confirm a refund address so the seller can return it.',
      refunded: 'Your USDT payment was not applied to the order, and the seller recorded its refund to your address.',
    });
    expect(USDT_SELLER_PHASE_COPY).toEqual({
      awaiting: "Waiting for the buyer's USDT payment",
      seen: "The buyer's USDT payment arrived. Check it in Bitkit, then confirm it below to mark the order paid.",
      received: "Payment received. Don't ship yet: Arbitrum hasn't finalized it. Shipping unlocks on its own.",
      final: 'Payment final. You can ship.',
      rechecking: "The buyer's payment is being re-checked on Arbitrum. Don't ship.",
      abandoned:
        "The buyer's USDT payment was received but not applied to the order. Return it to the refund address they confirm, then record the refund.",
      refunded: "The buyer's USDT payment was not applied to the order, and you recorded its refund.",
    });
  });

  it('reads a seller-confirmed transfer that waits for the seller as seen, not paid', () => {
    const { order } = createUsdtOrderFixture('received');
    const waiting = { ...order, paykitRequestState: 'awaiting_seller_confirmation' as const };
    const payment = createPaymentFixture('awaiting_entitlement', { adapter: 'paykit' });
    expect(usdtSettlementPhase(waiting, payment)).toBe('seen');
    expect(usdtSettlementPhase({ ...waiting, paykitRequestState: 'pending' as const }, payment)).toBe('awaiting');
    expect(USDT_PHASE_BADGE_LABEL.seen).toBe('Payment seen');
  });

  it('picks the copy for the viewing party', () => {
    const received = createUsdtOrderFixture('received');
    expect(usdtPhaseCopy(received.order, received.payment, true)).toBe(USDT_BUYER_PHASE_COPY.received);
    expect(usdtPhaseCopy(received.order, received.payment, false)).toBe(USDT_SELLER_PHASE_COPY.received);
  });

  it('never calls a USDT order or its status Bitcoin or on-chain', () => {
    const copies = [
      ...Object.values(USDT_BUYER_PHASE_COPY),
      ...Object.values(USDT_SELLER_PHASE_COPY),
      ...Object.values(USDT_PHASE_BADGE_LABEL),
    ];
    for (const copy of copies) expect(copy).not.toMatch(/bitcoin|₿|on-chain|sats/i);
  });

  it('keeps the Bitcoin status table untouched', () => {
    expect(BITCOIN_BUYER_STATUS_TABLE.some((row) => /usdt/i.test(JSON.stringify(row)))).toBe(false);
  });

  it('says the buyer review states in USDT terms, reusing the existing review sentences', () => {
    const { order } = createUsdtOrderFixture('final');
    const review = (reviewReason: 'amount_mismatch' | 'late_settlement' | 'refund_required') =>
      usdtPhaseCopy(order, createPaymentFixture('manual_review', { adapter: 'paykit', reviewReason }), true);
    expect(review('amount_mismatch')).toBe('The USDT amount does not match. The seller is reviewing it.');
    expect(review('late_settlement')).toBe('Payment received — the seller is reviewing it.');
    expect(review('refund_required')).toMatch(/another buyer took this item/);
    expect(usdtPhaseCopy(order, createPaymentFixture('manual_review', { adapter: 'paykit' }), false)).toBeNull();
  });
});

describe('USDT amounts', () => {
  it('writes the receipt line as "$137.00, paid as 137.000000 USDT"', () => {
    const { order } = createUsdtOrderFixture('final');
    expect(usdtAmountLabel(order)).toBe('137.000000 USDT');
    expect(usdtPaidAsLine(order)).toBe('$137.00, paid as 137.000000 USDT');
  });

  it('groups the digits of a large receipt amount but not the amount to pay', () => {
    const { order } = createUsdtOrderFixture('final', {
      total: usd(125_000),
      paymentAmountMinor: 1_250_000_000,
    });
    expect(usdtPaidAsLine(order)).toBe('$1,250.00, paid as 1,250.000000 USDT');
    expect(usdtAmountLabel(order)).toBe('1250.000000 USDT');
  });

  it('writes no line until the service sends the USDT amount', () => {
    const { order } = createUsdtOrderFixture('final', { paymentAmountMinor: undefined });
    expect(usdtPaidAsLine(order)).toBeNull();
  });

  it('quotes parity exactly: one cent is 10,000 millionths, with no rounding', () => {
    expect(usdtParityMillionths([usd(2_500)])).toBe(25_000_000);
    expect(usdtParityMillionths([usd(1)])).toBe(10_000);
    expect(usdtParityMillionths([usd(12_500), usd(1_200)])).toBe(137_000_000);
  });

  it('quotes nothing for a total that is not USD with two decimals', () => {
    expect(usdtParityMillionths([])).toBeNull();
    expect(usdtParityMillionths([{ amountMinor: 100, currency: 'BTC', exponent: 8 }])).toBeNull();
    expect(usdtParityMillionths([usd(100), { amountMinor: 100, currency: 'SAT', exponent: 0 }])).toBeNull();
    expect(usdtParityMillionths([{ amountMinor: 100, currency: 'USD', exponent: 0 }])).toBeNull();
    expect(usdtParityMillionths([usd(Number.MAX_SAFE_INTEGER)])).toBeNull();
  });
});

describe('USDT expectation copy', () => {
  it('states the buyer expectations in the agreed words', () => {
    expect(USDT_FINALITY_EXPECTATION_COPY).toBe(
      'The seller ships once Arbitrum finalizes your payment, usually in about 15–20 minutes.',
    );
    expect(USDT_MULTI_SELLER_COPY).toBe("You'll approve one request per seller in Bitkit.");
  });

  it('never claims the payment is verified or confirmed on-chain', () => {
    for (const copy of [USDT_FINALITY_EXPECTATION_COPY, USDT_MULTI_SELLER_COPY]) {
      expect(copy).not.toMatch(/verified|confirmed|bitcoin|₿/i);
    }
  });

  it('waits for finality on any shipped or pickup line, never on an all-digital cart', () => {
    expect(usdtFulfilmentWaitsForFinality(['shipping'])).toBe(true);
    expect(usdtFulfilmentWaitsForFinality(['pickup', 'digital'])).toBe(true);
    expect(usdtFulfilmentWaitsForFinality(['digital', 'digital'])).toBe(false);
    expect(usdtFulfilmentWaitsForFinality([])).toBe(false);
  });
});
