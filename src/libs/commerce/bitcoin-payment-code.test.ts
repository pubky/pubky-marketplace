import { describe, expect, it } from 'vitest';
import { marketplaceOrderSchema } from '@/core/services/marketplace/marketplace-projections';
import projectionSamples from '@/libs/commerce/contracts/samples/projections.json';
import { createBitcoinQuotedOrderFixture, createOrderFixture } from '@/test/fixtures/commerce/orders';
import {
  bitcoinPaymentBreakdown,
  bitcoinRefundReceivedNote,
  formatBitcoinAmountBreakdown,
  orderAmountEntry,
  orderRefundEntry,
  orderReturnEntry,
} from './bitcoin-payment-code';
import { toCamelCaseWire } from './wire-casing';

const PLACEHOLDERS: Record<string, string> = {
  '<uuid:1>': '018f47d2-6a27-7c23-a49d-000000000001',
  '<uuid:2>': '018f47d2-6a27-7c23-a49d-000000000002',
  '<uuid:3>': '018f47d2-6a27-7c23-a49d-000000000003',
  '<uuid:4>': '018f47d2-6a27-7c23-a49d-000000000004',
  '<uuid:5>': '018f47d2-6a27-7c23-a49d-000000000005',
  '<uuid:6>': '018f47d2-6a27-7c23-a49d-000000000006',
  '<pubky:buyer>': 'b'.repeat(52),
  '<pubky:seller>': 's'.repeat(52),
  '<timestamp:1>': '2026-08-20T20:00:00.000Z',
  '<timestamp:2>': '2026-08-20T21:00:00.000Z',
  '<timestamp:3>': '2026-08-27T20:00:00.000Z',
  '<paykit-reference:1>': 'paykit-reference-1',
  '<paykit-reference:2>': 'paykit-reference-2',
  '<paykit-reference:3>': 'paykit-reference-3',
};

function projectionBody(scene: keyof typeof projectionSamples): Record<string, unknown> {
  const source = projectionSamples[scene].response.body;
  return JSON.parse(
    JSON.stringify(source, (_key, value: unknown) =>
      typeof value === 'string' ? (PLACEHOLDERS[value] ?? value) : value,
    ),
  ) as Record<string, unknown>;
}

function parseOrder(wire: Record<string, unknown>) {
  return marketplaceOrderSchema.parse(toCamelCaseWire(wire));
}

const SAMPLE_EQUATION = 'Items ₿50,000 · Shipping ₿1,200 · Payment code ₿437 = Total ₿51,637';
const CANARY_EQUATION = 'Items ₿1,000 · Shipping ₿0 · Payment code ₿255 = Total ₿1,255';

describe('bitcoin payment code', () => {
  it('pins the vendored Paykit projection: 50,000 + 1,200 + 437 = 51,637', () => {
    const order = parseOrder(projectionBody('buyer_awaiting_confirmation'));

    expect(order.paykitTotalSats).toBe(51_637);
    expect(order.total).toEqual({ amountMinor: 51_637, currency: 'SAT', exponent: 0 });
    const breakdown = bitcoinPaymentBreakdown(order);
    expect(breakdown).toEqual({
      items: { amountMinor: 50_000, currency: 'SAT', exponent: 0 },
      shipping: { amountMinor: 1_200, currency: 'SAT', exponent: 0 },
      paymentCode: { amountMinor: 437, currency: 'SAT', exponent: 0 },
      payable: { amountMinor: 51_637, currency: 'SAT', exponent: 0 },
    });
    expect(formatBitcoinAmountBreakdown(breakdown!)).toBe(SAMPLE_EQUATION);
    expect(breakdown!.items.amountMinor + breakdown!.shipping.amountMinor + breakdown!.paymentCode.amountMinor).toBe(
      breakdown!.payable.amountMinor,
    );
  });

  it('reads merchandise_total and bitcoin_payable from the service payload', () => {
    const wire = projectionBody('buyer_awaiting_confirmation');
    wire.merchandise_total = { amount_minor: 51_200, currency: 'SAT', exponent: 0 };
    wire.bitcoin_payable = { amount_minor: 51_637, currency: 'SAT', exponent: 0 };

    const order = parseOrder(wire);

    expect(order.merchandiseTotal).toEqual({ amountMinor: 51_200, currency: 'SAT', exponent: 0 });
    expect(order.bitcoinPayable).toEqual({ amountMinor: 51_637, currency: 'SAT', exponent: 0 });
    expect(formatBitcoinAmountBreakdown(bitcoinPaymentBreakdown(order)!)).toBe(SAMPLE_EQUATION);
  });

  it('explains a BTC listing whose payable is denominated in SAT', () => {
    const wire = projectionBody('buyer_awaiting_confirmation');
    const btc = (amount: number) => ({ amount_minor: amount, currency: 'BTC', exponent: 8 });
    wire.subtotal = btc(1_000);
    wire.shipping = btc(0);
    wire.merchandise_total = btc(1_000);
    wire.total = btc(1_255);
    wire.bitcoin_payable = { amount_minor: 1_255, currency: 'SAT', exponent: 0 };
    wire.paykit_total_sats = 1_255;
    const lines = wire.lines as Array<Record<string, unknown>>;
    lines[0].unit_price = btc(1_000);
    lines[0].subtotal = btc(1_000);

    const order = parseOrder(wire);
    const breakdown = bitcoinPaymentBreakdown(order);

    expect(breakdown?.paymentCode).toEqual({ amountMinor: 255, currency: 'BTC', exponent: 8 });
    expect(breakdown?.payable).toEqual({ amountMinor: 1_255, currency: 'BTC', exponent: 8 });
    expect(formatBitcoinAmountBreakdown(breakdown!)).toBe(CANARY_EQUATION);
    expect(orderAmountEntry(order)).toEqual({ amountMinor: 1_255, exponent: 0, unitLabel: '₿' });
    expect(breakdown!.items.amountMinor + breakdown!.shipping.amountMinor + breakdown!.paymentCode.amountMinor).toBe(
      breakdown!.payable.amountMinor,
    );
  });

  it('keeps a fiat order in its own currency and puts the code on the bitcoin amount', () => {
    const order = marketplaceOrderSchema.parse({
      ...createBitcoinQuotedOrderFixture(),
      bitcoinPayable: { amountMinor: 3_000, currency: 'SAT', exponent: 0 },
      paykitTotalSats: 3_000,
    });

    expect(formatBitcoinAmountBreakdown(bitcoinPaymentBreakdown(order)!)).toBe(
      'Items $125.00 · Shipping $12.00 · Payment code ₿412 = Total ₿3,000',
    );
  });

  it('drops a malformed payable and still parses the order', () => {
    const wire = projectionBody('buyer_awaiting_confirmation');
    wire.bitcoin_payable = { amount_minor: '1255', currency: 'SAT', exponent: 0 };
    wire.merchandise_total = { amount_minor: false };

    const order = parseOrder(wire);

    expect(order.bitcoinPayable).toBeUndefined();
    expect(order.merchandiseTotal).toBeUndefined();
    expect(formatBitcoinAmountBreakdown(bitcoinPaymentBreakdown(order)!)).toBe(SAMPLE_EQUATION);
  });

  it('reads the refund cap the seller projection carries and drops a malformed one', () => {
    const wire = projectionBody('buyer_awaiting_confirmation');
    wire.refund_cap = { amount_minor: 53_000, unit: 'sat', exponent: 0 };
    expect(parseOrder(wire).refundCap).toEqual({ amountMinor: 53_000, unit: 'sat', exponent: 0 });
    wire.refund_cap = { amount_minor: 53_000, unit: 'cents', exponent: 0 };
    expect(parseOrder(wire).refundCap).toBeUndefined();
  });

  it('reads the unit a refund record names and drops an unknown one', () => {
    const wire = projectionBody('buyer_awaiting_confirmation');
    const record = { amount_minor: 20_000, transaction_id: 'txid', recorded_at: '2026-08-27T20:00:00.000Z' };
    wire.external_refund = { ...record, amount_unit: 'sat' };
    expect(parseOrder(wire).externalRefund?.amountUnit).toBe('sat');
    wire.external_refund = { ...record, amount_unit: 'cents' };
    expect(parseOrder(wire).externalRefund?.amountUnit).toBeUndefined();
    wire.external_refund = record;
    expect(parseOrder(wire).externalRefund?.amountUnit).toBeUndefined();
  });

  it('reads whether the refund is full and drops a malformed flag', () => {
    const wire = projectionBody('buyer_awaiting_confirmation');
    wire.external_refund_full = false;
    expect(parseOrder(wire).externalRefundFull).toBe(false);
    wire.external_refund_full = null;
    expect(parseOrder(wire).externalRefundFull).toBeNull();
    wire.external_refund_full = 'false';
    expect(parseOrder(wire).externalRefundFull).toBeUndefined();
  });

  it('stays quiet before a code exists, on other rails, and when the parts would not add', () => {
    expect(bitcoinPaymentBreakdown(createOrderFixture('pending_payment', { paymentMethod: 'bitcoin' }))).toBeNull();
    expect(
      bitcoinPaymentBreakdown(
        createOrderFixture('paid', {
          paymentMethod: 'paypal',
          paykitTotalSats: 51_637,
        }),
      ),
    ).toBeNull();
    const exact = projectionBody('buyer_awaiting_confirmation');
    exact.paykit_total_sats = 51_200;
    exact.total = { amount_minor: 51_200, currency: 'SAT', exponent: 0 };
    expect(bitcoinPaymentBreakdown(parseOrder(exact))).toBeNull();
  });
});

describe('refund amount entry for a USDT payment', () => {
  const sats = { amountMinor: 150_000, currency: 'SAT', exponent: 0 };

  it('is recorded in USDT millionths, capped at the amount paid, on an order priced in satoshis', () => {
    const order = createOrderFixture('return_received', {
      total: sats,
      paymentMethod: 'paykit',
      paymentAsset: 'USDT',
      paymentAmountMinor: 41_250_000,
    });
    expect(orderAmountEntry(order)).toEqual({ amountMinor: 41_250_000, exponent: 6, unitLabel: 'USDT' });
  });

  it('keeps cents on a USD order paid in USDT and satoshis on one paid in Bitcoin', () => {
    const usd = createOrderFixture('return_received', {
      paymentMethod: 'paykit',
      paymentAsset: 'USDT',
      paymentAmountMinor: 13_700_000,
    });
    expect(orderAmountEntry(usd)).toEqual({
      amountMinor: usd.total.amountMinor,
      exponent: usd.total.exponent,
      unitLabel: usd.total.currency,
    });
    const bitcoin = createOrderFixture('return_received', {
      total: sats,
      paymentMethod: 'paykit',
      paymentAsset: 'BTC',
    });
    expect(orderAmountEntry(bitcoin)).toEqual({ amountMinor: 150_000, exponent: 0, unitLabel: '₿' });
  });

  it('caps a USDT refund at what arrived, while a return request stays within the total', () => {
    const usdt = (paymentAmountMinor: number) =>
      createOrderFixture('cancelled', {
        total: { amountMinor: 13_700, currency: 'USD', exponent: 2 },
        paymentMethod: 'paykit',
        paymentAsset: 'USDT',
        paymentAmountMinor,
      });
    expect(orderRefundEntry(usdt(137_000_000))).toEqual({ amountMinor: 13_700, exponent: 2, unitLabel: 'USD' });
    expect(orderRefundEntry(usdt(136_000_000))).toEqual({ amountMinor: 13_600, exponent: 2, unitLabel: 'USD' });
    expect(orderRefundEntry(usdt(138_000_000))).toEqual({ amountMinor: 13_800, exponent: 2, unitLabel: 'USD' });
    expect(orderAmountEntry(usdt(138_000_000))).toEqual({ amountMinor: 13_700, exponent: 2, unitLabel: 'USD' });
    const paypal = createOrderFixture('cancelled', { paymentMethod: 'paypal' });
    expect(orderRefundEntry(paypal)).toEqual(orderAmountEntry(paypal));
  });
});

describe('return amount entry', () => {
  const sats = { amountMinor: 150_000, currency: 'SAT', exponent: 0 };

  it('asks for a USDT order in its own currency, never in USDT', () => {
    const satPriced = createOrderFixture('delivered', {
      total: sats,
      paymentMethod: 'paykit',
      paymentAsset: 'USDT',
      paymentAmountMinor: 41_250_000,
    });
    expect(orderReturnEntry(satPriced)).toEqual({ amountMinor: 150_000, exponent: 0, unitLabel: '₿' });
    const euroPriced = createOrderFixture('delivered', {
      total: { amountMinor: 13_700, currency: 'EUR', exponent: 2 },
      paymentMethod: 'paykit',
      paymentAsset: 'USDT',
      paymentAmountMinor: 148_539_999,
    });
    expect(orderReturnEntry(euroPriced)).toEqual({ amountMinor: 13_700, exponent: 2, unitLabel: 'EUR' });
  });

  it('leaves the payment code out of a Bitcoin order and keeps a fiat price in its currency', () => {
    const wire = projectionBody('buyer_awaiting_confirmation');
    wire.paykit_total_sats = 1_255;
    wire.total = { amount_minor: 1_255, currency: 'BTC', exponent: 8 };
    wire.merchandise_total = { amount_minor: 1_000, currency: 'BTC', exponent: 8 };
    expect(orderReturnEntry(parseOrder(wire))).toEqual({ amountMinor: 1_000, exponent: 0, unitLabel: '₿' });
    const quoted = marketplaceOrderSchema.parse({
      ...createBitcoinQuotedOrderFixture(),
      bitcoinPayable: { amountMinor: 3_000, currency: 'SAT', exponent: 0 },
      paykitTotalSats: 3_000,
    });
    expect(orderReturnEntry(quoted)).toEqual({ amountMinor: 13_700, exponent: 2, unitLabel: 'USD' });
  });

  it('falls back to the total when the merchandise total is absent or in another unit', () => {
    const order = createOrderFixture('delivered');
    expect(orderReturnEntry(order)).toEqual({ amountMinor: 13_700, exponent: 2, unitLabel: 'USD' });
    expect(orderReturnEntry({ ...order, merchandiseTotal: { amountMinor: 1, currency: 'EUR', exponent: 2 } })).toEqual({
      amountMinor: 13_700,
      exponent: 2,
      unitLabel: 'USD',
    });
  });
});

describe('refund amount entry for a Bitcoin payment', () => {
  const usd = (cents: number) => ({ amountMinor: cents, currency: 'USD', exponent: 2 });
  const sat = (sats: number) => ({ amountMinor: sats, currency: 'SAT', exponent: 0 });
  const usdPriced = {
    paymentMethod: 'paykit' as const,
    paymentAsset: null,
    subtotal: usd(12_500),
    shipping: usd(1_200),
    total: usd(13_700),
    paykitTotalSats: 51_637,
    bitcoinPayable: sat(51_637),
  };

  it('is the sats the service caps a Bitcoin refund at, whatever the price currency', () => {
    expect(
      orderRefundEntry(
        createOrderFixture('cancelled', { ...usdPriced, refundCap: { amountMinor: 53_000, unit: 'sat', exponent: 0 } }),
      ),
    ).toEqual({ amountMinor: 53_000, exponent: 0, unitLabel: '₿' });
  });

  it('keeps the order total when the service caps it there', () => {
    // A request that also offered USDT and records no rail: the service does
    // not take it for Bitcoin, so the Shop does not either.
    const unknownRail = createOrderFixture('cancelled', {
      ...usdPriced,
      refundCap: { amountMinor: 13_700, unit: 'order', exponent: 2 },
    });
    expect(orderRefundEntry(unknownRail)).toEqual({ amountMinor: 13_700, exponent: 2, unitLabel: 'USD' });
    const satPriced = createOrderFixture('cancelled', {
      paymentMethod: 'paykit',
      total: sat(50_037),
      refundCap: { amountMinor: 50_037, unit: 'order', exponent: 0 },
    });
    expect(orderRefundEntry(satPriced)).toEqual({ amountMinor: 50_037, exponent: 0, unitLabel: '₿' });
  });

  it('is the USDT paid when the service caps it there', () => {
    const order = createOrderFixture('cancelled', {
      paymentMethod: 'paykit',
      paymentAsset: 'USDT',
      paymentAmountMinor: 41_250_000,
      total: { amountMinor: 3_800, currency: 'EUR', exponent: 2 },
      refundCap: { amountMinor: 41_250_000, unit: 'usdt0', exponent: 6 },
    });
    expect(orderRefundEntry(order)).toEqual({ amountMinor: 41_250_000, exponent: 6, unitLabel: 'USDT' });
  });

  it('is the USDT received in cents for a USD order, above the total when overpaid', () => {
    const order = createOrderFixture('cancelled', {
      paymentMethod: 'paykit',
      paymentAsset: 'USDT',
      paymentAmountMinor: 138_000_000,
      total: usd(13_700),
      refundCap: { amountMinor: 13_800, unit: 'order', exponent: 2 },
    });
    expect(orderRefundEntry(order)).toEqual({ amountMinor: 13_800, exponent: 2, unitLabel: 'USD' });
  });

  it('keeps the earlier entry without a projected cap', () => {
    const bitcoin = createOrderFixture('cancelled', usdPriced);
    expect(orderRefundEntry(bitcoin)).toEqual(orderAmountEntry(bitcoin));
    // A USDT order is still capped at the USDT it received.
    const underpaid = createOrderFixture('cancelled', {
      paymentMethod: 'paykit',
      paymentAsset: 'USDT',
      paymentAmountMinor: 136_000_000,
      total: usd(13_700),
    });
    expect(orderRefundEntry(underpaid)).toEqual({ amountMinor: 13_600, exponent: 2, unitLabel: 'USD' });
  });

  it('names the sats received beside the form unless the breakdown already ends on them', () => {
    const received = (amountMinor: number) => ({ amountMinor, unit: 'sat' as const, exponent: 0 });
    const order = createOrderFixture('cancelled', { ...usdPriced, refundCap: received(51_637) });
    expect(bitcoinRefundReceivedNote(order)).toBe('Received ₿51,637. Record the refund in bitcoin, up to that amount.');
    const brokenDown = createOrderFixture('cancelled', {
      ...usdPriced,
      subtotal: sat(48_000),
      shipping: sat(2_000),
      merchandiseTotal: sat(50_000),
      total: sat(51_637),
      refundCap: received(51_637),
    });
    expect(bitcoinRefundReceivedNote(brokenDown)).toBeNull();
    expect(bitcoinRefundReceivedNote({ ...brokenDown, refundCap: received(50_500) })).toBe(
      'Received ₿50,500. Record the refund in bitcoin, up to that amount.',
    );
    expect(
      bitcoinRefundReceivedNote({ ...order, refundCap: { amountMinor: 13_700, unit: 'order', exponent: 2 } }),
    ).toBeNull();
    expect(bitcoinRefundReceivedNote({ ...order, refundCap: undefined })).toBeNull();
  });
});
