/**
 * Staging `GET /v1/orders` captured on 2026-11-26 for James's test buyer.
 * See `orders-staging-2026-11-26.md`. The JSON file is the captured body.
 * The helpers below build labelled copies for the checkout and parse-error scenes.
 */
import stagingOrdersWire from './orders-staging-2026-11-26.json';

export const STAGING_ORDERS_BUYER_PUBKY = 'idgopdnhi9psboqguyzsmsj1hyyy7gks7wxa4ym9eazz6pibsfay';
export const STAGING_ORDERS_SELLER_PUBKY = '9kshs8g7cd33qr3jkg6hyu1nwayyrdp73qet3bi8yewncgbhcrxo';

/** The captured order whose payment review reason is `upstream_inconsistent`. */
export const UPSTREAM_INCONSISTENT_ORDER_ID = '470c02d8-9326-4d89-98f6-199df5a2ffcb';

/** Cancelled source copied into the derived active-payment order. */
export const DERIVED_PAYING_SOURCE_ORDER_ID = '06cc87e9-60f8-4942-b1f2-1ca6c24b4535';

/**
 * Distinct from the source so checkout can open this row while `06cc87e9-…` stays cancelled.
 * The short reference the UI shows is `d06cc87e`.
 */
export const DERIVED_PAYING_ORDER_ID = 'd06cc87e-60f8-4942-b1f2-1ca6c24b4535';
export const DERIVED_PAYING_PAYMENT_ID = 'd7f3b222-0473-4987-bc88-bdd6ad9311b1';

/**
 * Thirty minutes after the VRT frozen clock (`2026-01-01T12:00:00.000Z` in
 * `src/test-utils/vrt.clock.ts`), so the paying view's pay-by line stays open.
 */
export const DERIVED_HOLD_EXPIRES_AT = '2026-01-01T12:30:00.000Z';

/**
 * Paths rewritten on the derived order, compared with `06cc87e9-…`.
 *
 * Identity, so the copy is a second order and its embedded payment still names it:
 * `id`, `payment_id`, `payment.id`, `payment.order_id`.
 *
 * Payment window, the only fields changed to make the copy an active payment:
 * `state` `cancelled` → `pending_payment`,
 * `payment.state` `expired` → `awaiting_entitlement`,
 * `hold_expires_at` `null` → `2026-01-01T12:30:00.000Z`.
 *
 * `paykit_request_state` is already `pending` on the source and is not rewritten.
 * Every other field, including `470c02d8-…` elsewhere in the list, is unchanged.
 */
export const DERIVED_PAYING_ORDER_CHANGED_PATHS = [
  'hold_expires_at',
  'id',
  'payment.id',
  'payment.order_id',
  'payment.state',
  'payment_id',
  'state',
] as const;

/** Copy of the last captured order with a review reason the client schema rejects. */
export const MALFORMED_ORDER_SOURCE_ID = '0fdd4ee2-109c-4b64-851b-e320b097adc8';
export const MALFORMED_ORDER_ID = 'bad0fdd4-109c-4b64-851b-e320b097adc8';
export const MALFORMED_PAYMENT_ID = 'bad7614d-638c-458d-8f22-46edc8b3b300';
export const MALFORMED_REVIEW_REASON = 'not_a_real_reason';

export const MALFORMED_ORDER_CHANGED_PATHS = [
  'id',
  'payment.id',
  'payment.order_id',
  'payment.review_reason',
  'payment_id',
] as const;

export function stagingOrdersResponse() {
  return structuredClone(stagingOrdersWire);
}

export function stagingCheckoutPayingResponse() {
  const body = stagingOrdersResponse();
  const source = body.orders.find((order) => order.id === DERIVED_PAYING_SOURCE_ORDER_ID);
  if (!source) throw new Error(`Missing source order ${DERIVED_PAYING_SOURCE_ORDER_ID}`);
  const derived = {
    ...source,
    id: DERIVED_PAYING_ORDER_ID,
    state: 'pending_payment',
    hold_expires_at: DERIVED_HOLD_EXPIRES_AT,
    payment_id: DERIVED_PAYING_PAYMENT_ID,
    payment: {
      ...source.payment,
      id: DERIVED_PAYING_PAYMENT_ID,
      order_id: DERIVED_PAYING_ORDER_ID,
      state: 'awaiting_entitlement',
    },
  };
  return { orders: [derived, ...body.orders] };
}

export function stagingOrdersWithMalformedResponse() {
  const body = stagingOrdersResponse();
  const source = body.orders.find((order) => order.id === MALFORMED_ORDER_SOURCE_ID);
  if (!source) throw new Error(`Missing source order ${MALFORMED_ORDER_SOURCE_ID}`);
  const malformed = {
    ...source,
    id: MALFORMED_ORDER_ID,
    payment_id: MALFORMED_PAYMENT_ID,
    payment: {
      ...source.payment,
      id: MALFORMED_PAYMENT_ID,
      order_id: MALFORMED_ORDER_ID,
      review_reason: MALFORMED_REVIEW_REASON,
    },
  };
  return { orders: [...body.orders, malformed] };
}
