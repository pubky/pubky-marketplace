import { describe, expect, it } from 'vitest';
import { type CommandOrderSnapshot, orderShowsCommandResult } from './order-command-result';

const order = (overrides: Partial<CommandOrderSnapshot> = {}): CommandOrderSnapshot => ({
  state: 'delivered',
  ...overrides,
});

describe('orderShowsCommandResult', () => {
  it('matches the return the buyer just submitted', () => {
    expect(
      orderShowsCommandResult(
        order({
          state: 'return_requested',
          returnRequest: { state: 'requested', reason: 'mistake on my part', requestedAmountMinor: 250 },
        }),
        'return.request',
        { reason: 'mistake on my part', requestedAmountMinor: 250 },
      ),
    ).toBe(true);
  });

  it('rejects a return whose reason or amount is different', () => {
    const landed = order({
      state: 'return_requested',
      returnRequest: { state: 'requested', reason: 'mistake on my part', requestedAmountMinor: 250 },
    });
    expect(orderShowsCommandResult(landed, 'return.request', { reason: 'other', requestedAmountMinor: 250 })).toBe(
      false,
    );
    expect(
      orderShowsCommandResult(landed, 'return.request', { reason: 'mistake on my part', requestedAmountMinor: 100 }),
    ).toBe(false);
    expect(
      orderShowsCommandResult(order({ state: 'completed' }), 'return.request', {
        reason: 'mistake on my part',
        requestedAmountMinor: 250,
      }),
    ).toBe(false);
  });

  it('matches later states that still show the same command', () => {
    expect(
      orderShowsCommandResult(
        order({
          state: 'shipped',
          shipment: { carrier: 'Local Courier', trackingNumber: 'LC-1', state: 'shipped' },
        }),
        'fulfillment.ship',
        { carrier: 'Local Courier', trackingNumber: 'LC-1' },
      ),
    ).toBe(true);
    expect(
      orderShowsCommandResult(
        order({
          state: 'delivered',
          shipment: { carrier: 'Local Courier', trackingNumber: 'LC-1', state: 'delivered' },
        }),
        'fulfillment.confirm_delivery',
        {},
      ),
    ).toBe(true);
    expect(orderShowsCommandResult(order({ state: 'shipped' }), 'fulfillment.confirm_delivery', {})).toBe(false);
    expect(
      orderShowsCommandResult(
        order({ state: 'cancel_requested', cancellationReason: 'Changed my mind' }),
        'order.cancel_request',
        {
          reason: 'Changed my mind',
        },
      ),
    ).toBe(true);
    expect(
      orderShowsCommandResult(
        order({ state: 'cancelled', cancellationReason: 'Changed my mind' }),
        'order.cancel_approve',
        {},
      ),
    ).toBe(true);
    expect(orderShowsCommandResult(order({ state: 'cancel_requested' }), 'order.cancel_approve', {})).toBe(false);
    expect(
      orderShowsCommandResult(
        order({
          state: 'return_approved',
          returnRequest: { state: 'approved', reason: 'mistake on my part', requestedAmountMinor: 250 },
        }),
        'return.approve',
        {},
      ),
    ).toBe(true);
    expect(
      orderShowsCommandResult(
        order({
          state: 'return_received',
          returnRequest: { state: 'received', reason: 'mistake on my part', requestedAmountMinor: 250 },
        }),
        'return.receive',
        {},
      ),
    ).toBe(true);
    expect(
      orderShowsCommandResult(
        order({
          state: 'refunded_external',
          externalRefund: { amountMinor: 189, transactionId: 'PAYPAL-REFUND-189' },
        }),
        'refund.record_external',
        { amountMinor: 189, transactionId: 'PAYPAL-REFUND-189' },
      ),
    ).toBe(true);
    expect(
      orderShowsCommandResult(order({ reviews: [{ rating: 5, text: 'Fast' }] }), 'review.create', {
        rating: 5,
        text: 'Fast',
      }),
    ).toBe(true);
    expect(
      orderShowsCommandResult(order({ reviews: [{ rating: 5, text: 'Fast' }] }), 'review.update', {
        rating: 4,
        text: 'Fast',
      }),
    ).toBe(false);
  });

  it('does not read a PayPal refund of a shipped order as a confirmed delivery', () => {
    const shipped = { carrier: 'Local Courier', trackingNumber: 'LC-1', state: 'shipped' };
    expect(
      orderShowsCommandResult(
        order({ state: 'refunded_external', shipment: shipped }),
        'fulfillment.confirm_delivery',
        {},
      ),
    ).toBe(false);
    expect(
      orderShowsCommandResult(
        order({ state: 'refunded_external', shipment: { ...shipped, state: 'delivered' } }),
        'fulfillment.confirm_delivery',
        {},
      ),
    ).toBe(true);
  });

  it('matches a refund address the buyer just confirmed, ignoring address case', () => {
    const address = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
    const landed = order({ state: 'paid', refundDestination: { address } });
    expect(orderShowsCommandResult(landed, 'refund.confirm_destination', { address })).toBe(true);
    expect(orderShowsCommandResult(landed, 'refund.confirm_destination', { address: address.toLowerCase() })).toBe(
      true,
    );
    expect(
      orderShowsCommandResult(landed, 'refund.confirm_destination', {
        address: '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
      }),
    ).toBe(false);
    expect(orderShowsCommandResult(order({ state: 'paid' }), 'refund.confirm_destination', { address })).toBe(false);
    expect(orderShowsCommandResult(landed, 'refund.confirm_destination', {})).toBe(false);
  });

  it('does not treat an unrecognized command as applied', () => {
    expect(orderShowsCommandResult(order({ state: 'delivered' }), 'fulfillment.confirm_pickup', {})).toBe(false);
  });
});

describe('orderShowsCommandResult shipment tracking', () => {
  const shipped = (carrier: string, trackingNumber: string) =>
    order({ state: 'shipped', shipment: { carrier, trackingNumber, state: 'shipped' } });

  it('reads a ship without a number as landed when the shipment has none', () => {
    expect(orderShowsCommandResult(shipped('Other', ''), 'fulfillment.ship', { carrier: 'Other' })).toBe(true);
    expect(orderShowsCommandResult(shipped('Other', 'X-1'), 'fulfillment.ship', { carrier: 'Other' })).toBe(false);
  });

  it('matches a tracking update only when carrier and number both match', () => {
    const payload = { carrier: 'UPS', trackingNumber: '1Z999AA10123456784' };
    expect(orderShowsCommandResult(shipped('UPS', '1Z999AA10123456784'), 'fulfillment.update_tracking', payload)).toBe(
      true,
    );
    expect(orderShowsCommandResult(shipped('UPS', ''), 'fulfillment.update_tracking', payload)).toBe(false);
    expect(
      orderShowsCommandResult(shipped('FedEx', '1Z999AA10123456784'), 'fulfillment.update_tracking', payload),
    ).toBe(false);
  });
});

describe('orderShowsCommandResult per-item reviews', () => {
  const BUYER = 'b'.repeat(52);
  const SELLER = 's'.repeat(52);
  const review = (
    listingId: string,
    rating: number,
    text: string,
    seller?: { shipping: number; communication: number },
  ) => ({
    reviewerPubky: BUYER,
    listingAggregateId: `listing:${SELLER}_${listingId}`,
    rating,
    text,
    ...(seller ?? {}),
  });
  const landed = (reviews: ReturnType<typeof review>[]) =>
    order({ buyerPubky: BUYER, sellerPubky: SELLER, reviews, state: 'completed' });
  const payload = {
    items: [
      { listingId: 'boots', rating: 5, text: 'Great boots.' },
      { listingId: 'belt', rating: 3, text: '' },
    ],
  };

  it('matches once every named listing carries the sent stars and text', () => {
    const reviews = [review('boots', 5, 'Great boots.'), review('belt', 3, '')];

    expect(orderShowsCommandResult(landed(reviews), 'review.create', payload)).toBe(true);
    expect(orderShowsCommandResult(landed(reviews), 'review.update', payload)).toBe(true);
  });

  it('does not match while a named listing is missing or differs', () => {
    expect(orderShowsCommandResult(landed([review('boots', 5, 'Great boots.')]), 'review.create', payload)).toBe(false);
    expect(
      orderShowsCommandResult(
        landed([review('boots', 4, 'Great boots.'), review('belt', 3, '')]),
        'review.create',
        payload,
      ),
    ).toBe(false);
  });

  it("does not match another reviewer's review of the listing", () => {
    const foreign = { ...review('boots', 5, 'Great boots.'), reviewerPubky: SELLER };

    expect(orderShowsCommandResult(landed([foreign, review('belt', 3, '')]), 'review.create', payload)).toBe(false);
  });

  it('requires the sent seller ratings on every one of the buyer reviews', () => {
    const withSeller = { ...payload, seller: { shipping: 4, communication: 5 } };
    const rated = { shipping: 4, communication: 5 };

    expect(
      orderShowsCommandResult(
        landed([review('boots', 5, 'Great boots.', rated), review('belt', 3, '', rated)]),
        'review.update',
        withSeller,
      ),
    ).toBe(true);
    expect(
      orderShowsCommandResult(
        landed([review('boots', 5, 'Great boots.', rated), review('belt', 3, '')]),
        'review.update',
        withSeller,
      ),
    ).toBe(false);
  });

  it('cannot tell without the parties of the order', () => {
    expect(
      orderShowsCommandResult(order({ reviews: [review('boots', 5, 'Great boots.')] }), 'review.create', {
        items: [{ listingId: 'boots', rating: 5, text: 'Great boots.' }],
      }),
    ).toBe(false);
  });
});
