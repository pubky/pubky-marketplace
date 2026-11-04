import { describe, expect, it } from 'vitest';
import { MARKETPLACE_FAILURE_MESSAGES } from '@/libs/commerce/failure-messages';
import {
  orderChangedMessage,
  REFUND_ORDER_NOTICES,
  refundOrderNotices,
  refundRecordLine,
  refundStateLabel,
} from './refund-copy';

const total = { amountMinor: 250, currency: 'USD', exponent: 2 };
const refund = (amountMinor: number) => ({
  amountMinor,
  transactionId: '9RF12345AB678901C',
  recordedAt: '2026-09-24T18:00:00.000Z',
});

describe('refund copy', () => {
  it('names a full refund "Refunded" instead of the raw state', () => {
    expect(refundStateLabel({ state: 'refunded_external', total, externalRefund: refund(250) })).toBe('Refunded');
    expect(refundStateLabel({ state: 'paid', total })).toBeNull();
  });

  it('names a fully reversed payment and keeps the partial amount first', () => {
    const reversed = { state: 'refunded_external', total, paymentReversedAt: '2026-09-24T18:00:00.000Z' };
    expect(refundStateLabel({ ...reversed, externalRefund: refund(250) })).toBe('Payment reversed');
    expect(refundStateLabel({ state: 'shipped', total, externalRefund: refund(100) })).toBe('Refunded $1.00 of $2.50');
  });

  it('measures a USD order paid in USDT against the USDT it received', () => {
    const usdt = {
      state: 'refunded_external',
      total: { amountMinor: 13_700, currency: 'USD', exponent: 2 },
      paymentAsset: 'USDT',
      paymentAmountMinor: 136_000_000,
    };
    expect(refundStateLabel({ ...usdt, externalRefund: refund(13_600) })).toBe('Refund recorded');
    expect(refundStateLabel({ ...usdt, externalRefund: refund(10_000) })).toBe('Refunded $100.00 of $136.00');
    expect(refundStateLabel({ ...usdt, paymentAmountMinor: 138_000_000, externalRefund: refund(13_700) })).toBe(
      'Refunded $137.00 of $138.00',
    );
  });

  it('states the refund amount and reference in plain words', () => {
    expect(refundRecordLine({ state: 'refunded_external', total, externalRefund: refund(250) })).toBe(
      'Refunded in full ($2.50). Reference: 9RF12345AB678901C',
    );
    expect(refundRecordLine({ state: 'paid', total, externalRefund: refund(100) })).toBe(
      'Refunded $1.00 of $2.50. Reference: 9RF12345AB678901C',
    );
    expect(refundRecordLine({ state: 'paid', total })).toBeNull();
  });

  it('puts the payment-code equation on a Bitcoin refund record', () => {
    const bitcoin = {
      paymentMethod: 'bitcoin' as const,
      paykitTotalSats: 1_255,
      merchandiseTotal: { amountMinor: 1_000, currency: 'BTC', exponent: 8 },
      bitcoinPayable: { amountMinor: 1_255, currency: 'SAT', exponent: 0 },
      subtotal: { amountMinor: 1_000, currency: 'BTC', exponent: 8 },
      shipping: { amountMinor: 0, currency: 'BTC', exponent: 8 },
      total: { amountMinor: 1_255, currency: 'BTC', exponent: 8 },
    };
    const equation = 'Items ₿1,000 · Shipping ₿0 · Payment code ₿255 = Total ₿1,255';
    expect(refundRecordLine({ state: 'refunded_external', ...bitcoin, externalRefund: refund(1_255) })).toBe(
      `Refunded in full (${equation}). Reference: 9RF12345AB678901C`,
    );
    expect(refundRecordLine({ state: 'paid', ...bitcoin, externalRefund: refund(500) })).toBe(
      `Refunded ₿500 of ₿1,255. ${equation}. Reference: 9RF12345AB678901C`,
    );
    expect(refundStateLabel({ state: 'paid', ...bitcoin, externalRefund: refund(500) })).toBe(
      'Refunded ₿500 of ₿1,255',
    );
  });

  describe('a refund recorded in sats', () => {
    // The service leaves a partial refund `refunded_external` like a full one;
    // `externalRefundFull` tells them apart for every participant.
    const state = 'refunded_external';
    const sats = (amountMinor: number) => ({ ...refund(amountMinor), amountUnit: 'sat' as const });
    const received = (amountMinor: number) => ({ amountMinor, unit: 'sat' as const, exponent: 0 });
    // 137.00 USD paid as 51,637 sats.
    const usdPriced = {
      paymentMethod: 'paykit' as const,
      paymentAsset: null,
      paykitTotalSats: 51_637,
      bitcoinPayable: { amountMinor: 51_637, currency: 'SAT', exponent: 0 },
      subtotal: { amountMinor: 12_500, currency: 'USD', exponent: 2 },
      shipping: { amountMinor: 1_200, currency: 'USD', exponent: 2 },
      total: { amountMinor: 13_700, currency: 'USD', exponent: 2 },
    };

    it("reads the seller's sats against the sats received, not the cents", () => {
      const seller = { ...usdPriced, refundCap: received(51_637) };
      const full = { ...seller, externalRefundFull: true };
      expect(refundStateLabel({ state, ...full, externalRefund: sats(51_637) })).toBe('Refunded');
      expect(refundRecordLine({ state, ...full, externalRefund: sats(51_637) })).toBe(
        'Refunded in full (₿51,637). Reference: 9RF12345AB678901C',
      );
      // More sats than the order's cents, and still part of what was paid.
      const partial = { ...seller, externalRefundFull: false };
      expect(refundStateLabel({ state, ...partial, externalRefund: sats(20_000) })).toBe('Refunded ₿20,000 of ₿51,637');
      expect(refundRecordLine({ state, ...partial, externalRefund: sats(5_000) })).toBe(
        'Refunded ₿5,000 of ₿51,637. Reference: 9RF12345AB678901C',
      );
    });

    it('reads an overpayment against what the seller received, not the payable', () => {
      const overpaid = { ...usdPriced, refundCap: received(53_000) };
      expect(refundStateLabel({ state, ...overpaid, externalRefundFull: false, externalRefund: sats(51_637) })).toBe(
        'Refunded ₿51,637 of ₿53,000',
      );
      expect(refundRecordLine({ state, ...overpaid, externalRefundFull: true, externalRefund: sats(53_000) })).toBe(
        'Refunded in full (₿53,000). Reference: 9RF12345AB678901C',
      );
    });

    it('tells the buyer a partial refund from a full one without the seller-only cap', () => {
      // 25,819 of the 51,637 sats received.
      const partial = { state, ...usdPriced, externalRefundFull: false, externalRefund: sats(25_819) };
      expect(refundStateLabel(partial)).toBe('Partly refunded ₿25,819');
      expect(refundRecordLine(partial)).toBe('Partly refunded ₿25,819. Reference: 9RF12345AB678901C');
      // An overpaid order refunded in full is not "₿53,000 of ₿51,637".
      const full = { state, ...usdPriced, externalRefundFull: true, externalRefund: sats(53_000) };
      expect(refundStateLabel(full)).toBe('Refunded');
      expect(refundRecordLine(full)).toBe('Refunded in full (₿53,000). Reference: 9RF12345AB678901C');
    });

    it('claims neither part nor all when nothing says which', () => {
      const unknown = { state, ...usdPriced, externalRefund: sats(25_819) };
      expect(refundStateLabel(unknown)).toBe('Refunded');
      expect(refundRecordLine(unknown)).toBe('Refunded ₿25,819. Reference: 9RF12345AB678901C');
      expect(refundRecordLine({ ...unknown, externalRefundFull: null })).toBe(
        'Refunded ₿25,819. Reference: 9RF12345AB678901C',
      );
    });

    it('records a full refund of an underpaid sats-priced order as the amount received', () => {
      const underpaid = {
        paymentMethod: 'paykit' as const,
        paymentAsset: null,
        paykitTotalSats: 1_255,
        merchandiseTotal: { amountMinor: 1_000, currency: 'SAT', exponent: 0 },
        bitcoinPayable: { amountMinor: 1_255, currency: 'SAT', exponent: 0 },
        subtotal: { amountMinor: 1_000, currency: 'SAT', exponent: 0 },
        shipping: { amountMinor: 0, currency: 'SAT', exponent: 0 },
        total: { amountMinor: 1_255, currency: 'SAT', exponent: 0 },
        externalRefundFull: true,
      };
      for (const order of [underpaid, { ...underpaid, refundCap: received(1_200) }]) {
        expect(refundStateLabel({ state, ...order, externalRefund: sats(1_200) })).toBe('Refunded');
        expect(refundRecordLine({ state, ...order, externalRefund: sats(1_200) })).toBe(
          'Refunded in full (₿1,200). Reference: 9RF12345AB678901C',
        );
      }
      expect(refundRecordLine({ state, ...underpaid, externalRefund: sats(1_255) })).toBe(
        'Refunded in full (Items ₿1,000 · Shipping ₿0 · Payment code ₿255 = Total ₿1,255). Reference: 9RF12345AB678901C',
      );
    });

    it("reads a record that names no unit in the order's own units", () => {
      const legacy = { ...usdPriced, refundCap: received(51_637), externalRefundFull: null };
      expect(refundRecordLine({ state, ...legacy, externalRefund: refund(5_000) })).toBe(
        'Refunded $50.00 of $137.00. Reference: 9RF12345AB678901C',
      );
      expect(refundRecordLine({ state, ...legacy, externalRefund: refund(13_700) })).toBe(
        'Refunded in full ($137.00). Reference: 9RF12345AB678901C',
      );
    });
  });

  it('lists a reversal, a cancelled reversal, and each held refund notice', () => {
    expect(refundOrderNotices({ state: 'paid', total })).toEqual([]);
    expect(
      refundOrderNotices({ state: 'refunded_external', total, paymentReversedAt: '2026-09-24T18:00:00.000Z' }),
    ).toEqual(['reversed']);
    expect(
      refundOrderNotices({ state: 'paid', total, paymentReversalCancelledAt: '2026-09-24T19:00:00.000Z' }),
    ).toEqual(['reversalCancelled']);
    expect(
      refundOrderNotices({
        state: 'paid',
        total,
        paymentReversedAt: '2026-09-24T20:00:00.000Z',
        paymentReversalCancelledAt: '2026-09-24T19:00:00.000Z',
        gatewayRefundUnmatched: true,
        gatewayRefundReviewAt: '2026-09-24T18:00:00.000Z',
      }),
    ).toEqual(['reversed', 'refundOnHold', 'refundNeedsCheck']);
  });

  it('keeps every notice free of service codes', () => {
    for (const text of Object.values(REFUND_ORDER_NOTICES)) {
      expect(text).not.toMatch(/_|gateway|ipn|inbox|refunded_external/i);
    }
  });

  it('names the refund or reversal that caused a revision conflict', () => {
    const before = { state: 'shipped', total };
    expect(orderChangedMessage(before, { state: 'refunded_external', total, externalRefund: refund(250) })).toBe(
      MARKETPLACE_FAILURE_MESSAGES.orderRefundedMeanwhile,
    );
    expect(
      orderChangedMessage(before, {
        state: 'refunded_external',
        total,
        externalRefund: refund(250),
        paymentReversedAt: '2026-09-24T18:00:00.000Z',
      }),
    ).toBe(MARKETPLACE_FAILURE_MESSAGES.orderReversedMeanwhile);
    expect(orderChangedMessage(before, { state: 'shipped', total, externalRefund: refund(100) })).toBe(
      MARKETPLACE_FAILURE_MESSAGES.orderRefundRecordedMeanwhile,
    );
    expect(orderChangedMessage(before, { state: 'delivered', total })).toBe(MARKETPLACE_FAILURE_MESSAGES.orderChanged);
    expect(orderChangedMessage(before, null)).toBe(MARKETPLACE_FAILURE_MESSAGES.orderChanged);
    expect(MARKETPLACE_FAILURE_MESSAGES.orderReversedMeanwhile).toMatch(/^PayPal reversed the payment/);
    expect(MARKETPLACE_FAILURE_MESSAGES.orderRefundedMeanwhile).toMatch(/^This order was refunded/);
    expect(MARKETPLACE_FAILURE_MESSAGES.orderRefundRecordedMeanwhile).toMatch(/^A refund was recorded/);
  });
});

describe('USDT refund copy', () => {
  const usdtOrder = {
    state: 'refunded_external',
    total,
    paymentAsset: 'USDT',
    refundDestination: {
      address: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      network: 'arbitrum-one' as const,
      asset: 'USDT' as const,
      source: 'buyer_entered',
      confirmedAt: '2026-10-09T16:00:00.000Z',
    },
    externalRefund: { ...refund(250), transactionId: `0x${'ab'.repeat(32)}` },
  };

  it('names a recorded USDT refund as recorded, never as refunded or verified', () => {
    expect(refundStateLabel(usdtOrder)).toBe('Refund recorded');
    expect(refundRecordLine(usdtOrder)).toBe(
      `The seller recorded a refund of 2.500000 USDT to 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed (transaction 0x${'ab'.repeat(32)}). The Shop hasn't checked it on Arbitrum.`,
    );
  });

  it('leaves every non-USDT refund line exactly as before', () => {
    const bitcoinAsset = { ...usdtOrder, paymentAsset: null, refundDestination: null };
    expect(refundStateLabel(bitcoinAsset)).toBe('Refunded');
    expect(refundRecordLine(bitcoinAsset)).toMatch(/^Refunded in full \(\$2\.50\)\. Reference: /);
  });
});
