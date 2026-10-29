import type { MarketplaceOrder } from '@/services/marketplace/marketplace';

/**
 * The seller's own automatic confirmation (seller-confirmed payment). While
 * the seller is signed in and has turned it on in this browser, the seller's
 * Shop session confirms every payment that waits for them and matched the
 * order: a Paykit payment the service saw for the order's amount, or a PayPal
 * payment PayPal's verified notification reported. It is the seller's software
 * acting on the seller's rule; the service never confirms for them.
 */

/** Recorded with each automatic Paykit confirmation, so the seller's audit row says how it was made. */
export const SELLER_AUTO_CONFIRM_REASON = 'Confirmed automatically by the seller’s Shop session.';

/** How often the seller's open Shop looks for payments waiting for them. */
export const SELLER_AUTO_CONFIRM_INTERVAL_MS = 30_000;

/** A pass is abandoned after this long, inside the interval, so a request that never answers cannot hold the next one. */
export const SELLER_AUTO_CONFIRM_PASS_TIMEOUT_MS = 25_000;

export type AutoConfirmRail = 'paykit' | 'paypal';

type AutoConfirmOrder = Pick<
  MarketplaceOrder,
  | 'sellerPubky'
  | 'state'
  | 'receiptId'
  | 'paymentMethod'
  | 'paykitRequestState'
  | 'paykitObservation'
  | 'gatewayPaymentSeenAt'
  | 'externalRefund'
  | 'paymentReversedAt'
>;

/**
 * Which confirmation the seller's session may make for `order`, or null. Only
 * an open order of this seller qualifies, and only money that matched: a Paykit
 * observation that says the amount matched and has not disappeared, or a PayPal
 * notification with no refund or reversal recorded since. Anything else stays
 * with the seller to decide by hand.
 */
export function autoConfirmableRail(order: AutoConfirmOrder, sellerPubky: string): AutoConfirmRail | null {
  if (order.sellerPubky !== sellerPubky || order.state !== 'pending_payment' || order.receiptId) return null;
  if (order.paykitRequestState === 'awaiting_seller_confirmation') {
    const observation = order.paykitObservation;
    return observation?.amountMatched === true && observation.disappeared !== true ? 'paykit' : null;
  }
  if (
    order.paymentMethod === 'paypal' &&
    order.gatewayPaymentSeenAt &&
    !order.externalRefund &&
    !order.paymentReversedAt
  ) {
    return 'paypal';
  }
  return null;
}

/**
 * Whether a list row may be waiting for the seller. List rows can omit the
 * seller-only observation, so a candidate is re-read in full before any
 * confirmation.
 */
export function mayAwaitSellerConfirmation(order: AutoConfirmOrder, sellerPubky: string): boolean {
  if (order.sellerPubky !== sellerPubky || order.state !== 'pending_payment') return false;
  return (
    order.paykitRequestState === 'awaiting_seller_confirmation' ||
    (order.paymentMethod === 'paypal' && Boolean(order.gatewayPaymentSeenAt))
  );
}

/**
 * Whether a pending order's money waits for its seller to confirm it: a Paykit
 * payment in the seller window (Bitcoin or USDT), or a PayPal payment the buyer
 * reported or PayPal's verified notification reported. Such an order is still
 * a reservation, and its card must carry the seller's confirmation, or the
 * hold lapses with the buyer's money unconfirmed.
 */
export function awaitsSellerConfirmation(
  order: Pick<
    MarketplaceOrder,
    'state' | 'paymentMethod' | 'paykitRequestState' | 'paymentReportedAt' | 'gatewayPaymentSeenAt'
  >,
  payment: { state?: string | null } | null | undefined,
): boolean {
  if (order.state !== 'pending_payment' || payment?.state !== 'awaiting_entitlement') return false;
  if (order.paykitRequestState === 'awaiting_seller_confirmation') return true;
  return order.paymentMethod === 'paypal' && Boolean(order.paymentReportedAt || order.gatewayPaymentSeenAt);
}

/** Shop settings: what a seller-confirmed deployment means for the seller. */
export const SELLER_CONFIRMS_PAYMENTS_COPY =
  'An order is marked paid only when you confirm it: Bitcoin and USDT once the payment reaches your wallet, PayPal once it is in your PayPal account. Digital items are released when you do. If you don’t confirm a Bitcoin or USDT payment within 24 hours it goes to review; a PayPal checkout you don’t confirm in 24 hours ends, and you can still confirm it later.';

/** Shop settings: the automatic confirmation switch. */
export const SELLER_AUTO_CONFIRM_COPY =
  'While you’re signed in on this browser, it confirms payments that match the order for you. Off by default.';

export const SELLER_AUTO_CONFIRM_HINT_COPY =
  'This browser checks your orders every 30 seconds while the Shop is open. It confirms a Bitcoin or USDT payment that was seen for the order’s exact amount, and a PayPal payment PayPal’s verified notification reported, and releases digital items. Anything that doesn’t match, or was refunded or reversed, waits for you. It stops when you sign out or close the Shop.';
