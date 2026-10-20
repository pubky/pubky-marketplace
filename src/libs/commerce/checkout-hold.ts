/** Exact Shop copy for exclusive checkout holds (issue #50). */
import { formatDateTime } from '@/libs/utils/dateTime';

export const PAYMENT_WINDOW_ELAPSED_REASON = 'payment window elapsed';

export const UNBOUND_BACK_CANCEL_REASON = 'Released hold before choosing a payment method.';

export const CHECKOUT_HOLD_COPY = {
  listingReserved:
    'Another buyer is currently paying for this item. If payment does not complete, it will become available again.',
  heldForYouCta: 'Held for you · view your order',
  heldForYouOfferCta: 'Held for you · continue checkout',
  heldWhileAnotherPays: 'Held while another buyer pays',
  holdOwnerCheckPrompt: 'Is this your hold? Approve purchases to check.',
  expiredNoLateMoney: 'Payment window elapsed. The item is available again.',
  pendingBitcoinPaymentBuyer:
    'If a payment is still pending in Bitkit, another wallet or another device, let it finish or resolve it before you order again.',
  lateCompleteBuyer:
    'Your payment arrived after the hold window. The item was still available, so this order is now paid.',
  lateCompleteSeller: 'A late payment completed this order. The item is sold.',
  refundRequiredBuyer:
    'Your payment arrived after another buyer took this item. This order cannot be completed. The seller must return your funds.',
  refundRequiredBitcoinSeller:
    'Return the observed bitcoin to the buyer. This marketplace cannot reverse Bitcoin. Message the buyer for a return address, send the transaction, then record it as an external refund.',
  refundRequiredUsdtSeller:
    'Return the received USDT to the buyer. This marketplace cannot reverse an Arbitrum transfer. Send it from Bitkit, then record the refund.',
  refundRequiredPaypalSeller:
    'Refund this PayPal payment from your PayPal account. This marketplace cannot refund PayPal. Then record the refund.',
} as const;

/** An exact local timestamp including the day. Holds can run 24 hours. */
export function formatOrderInstant(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatDateTime(date);
}

export function formatHoldDeadline(holdExpiresAt: string | null | undefined): string | null {
  return formatOrderInstant(holdExpiresAt);
}

type PayByOrder = {
  createdAt?: string | null;
  holdExpiresAt?: string | null;
  paykitExpiresAt?: string | null;
  paykitRequestState?: string | null;
  auctionAggregateId?: string | null;
};

/**
 * The deadline the buyer is told to pay by. An auction winner's order starts
 * from the reservation-based hold; once Paykit activates the request, the
 * request's own deadline is the wallet's real one, so that is shown instead.
 * Every other order keeps the hold deadline.
 */
export function buyerPayByDeadline(order: PayByOrder): string | null {
  const requestDeadline = order.paykitExpiresAt;
  const activated = Boolean(order.paykitRequestState) && order.paykitRequestState !== 'preparing';
  if (order.auctionAggregateId && activated && requestDeadline && formatHoldDeadline(requestDeadline)) {
    return requestDeadline;
  }
  return order.holdExpiresAt ?? null;
}

export const APPROVE_IN_BITKIT_FALLBACK_COPY =
  'Approve in Bitkit soon: Bitkit expires a request you have not approved before the payment window ends.';

/**
 * The midpoint stays at or after activation only while the buyer bound the
 * request within one payment window of creating the order, so the span from
 * creation to the deadline is at most two windows. Past twice the Shop's
 * 30-minute Bitcoin window (`BITCOIN_PAYMENT_WINDOW_SECONDS`), the request was
 * bound late (a re-bind, a long hold) and the line names no time.
 */
const MAX_TIMED_APPROVAL_SPAN_MS = 60 * 60 * 1000;

/**
 * The latest instant the buyer can approve the request in Bitkit, or null when
 * the Shop cannot tell. Bitkit expires a request the buyer has not approved at
 * its `proposal_expires_at`, which paykit-server sets at activation to at most
 * half the payment window, well before Pay by (issue #358). The order carries
 * only the payment deadline (or its hold, 60 s later), so this takes the
 * midpoint of order creation and that deadline: activation never precedes
 * creation, so it is not later than the wallet's own. An auction order is
 * created at close and may activate much later, so it gets no time, as does
 * any order bound long after creation. Replace with the request's own
 * `proposal_expires_at` once the service projects it.
 */
export function approveInBitkitDeadline(order: PayByOrder): string | null {
  if (order.auctionAggregateId) return null;
  const created = order.createdAt ? new Date(order.createdAt).getTime() : NaN;
  const requestDeadline = order.paykitExpiresAt ?? order.holdExpiresAt;
  const deadline = requestDeadline ? new Date(requestDeadline).getTime() : NaN;
  if (!Number.isFinite(created) || !Number.isFinite(deadline) || deadline <= created) return null;
  if (deadline - created > MAX_TIMED_APPROVAL_SPAN_MS) return null;
  return new Date(created + (deadline - created) / 2).toISOString();
}

export function approveInBitkitCopy(order: PayByOrder): string {
  const deadline = formatOrderInstant(approveInBitkitDeadline(order));
  return deadline ? `Approve in Bitkit by ${deadline}.` : APPROVE_IN_BITKIT_FALLBACK_COPY;
}

export function holderUnboundCopy(holdExpiresAt: string | null | undefined): string {
  const deadline = formatHoldDeadline(holdExpiresAt);
  return deadline ? `The item is held for you until ${deadline}.` : 'The item is held for you once a payment starts.';
}

export function holderBoundCopy(holdExpiresAt: string | null | undefined): string {
  const deadline = formatHoldDeadline(holdExpiresAt);
  return deadline
    ? `Pay by ${deadline}. If the window ends, the item restocks.`
    : 'If the window ends, the item restocks.';
}

export function isLateCompletionOrder(order: { state: string; cancellationReason?: string | null }): boolean {
  return order.state === 'paid' && order.cancellationReason === PAYMENT_WINDOW_ELAPSED_REASON;
}

export function isRefundRequiredPayment(payment: { reviewReason?: string | null } | null | undefined): boolean {
  return payment?.reviewReason === 'refund_required';
}

export function isHoldExpiredNoLateMoney(
  order: { state: string; cancellationReason?: string | null },
  payment: { state: string; reviewReason?: string | null } | null | undefined,
): boolean {
  return (
    (order.state === 'cancelled' || payment?.state === 'expired') &&
    order.cancellationReason === PAYMENT_WINDOW_ELAPSED_REASON &&
    payment?.reviewReason !== 'refund_required' &&
    !isLateCompletionOrder(order)
  );
}

export function refundRequiredSellerCopy(paymentMethod: string | null | undefined): string {
  if (paymentMethod === 'paypal') return CHECKOUT_HOLD_COPY.refundRequiredPaypalSeller;
  if (paymentMethod === 'usdt') return CHECKOUT_HOLD_COPY.refundRequiredUsdtSeller;
  return CHECKOUT_HOLD_COPY.refundRequiredBitcoinSeller;
}

export function refundRequiredCopyForRole(isBuyer: boolean, paymentMethod: string | null | undefined): string {
  return isBuyer ? CHECKOUT_HOLD_COPY.refundRequiredBuyer : refundRequiredSellerCopy(paymentMethod);
}

type ViewerHoldOrderLine = {
  listingAggregateId: string;
};

type ViewerHoldOrder = {
  id: string;
  buyerPubky: string;
  state: string;
  lines: readonly ViewerHoldOrderLine[];
};

type ViewerHoldOrderView = {
  order: ViewerHoldOrder;
};

/**
 * Match a reserved listing to the viewer's own pending-payment order.
 * Compare `order.buyerPubky` to the authenticated pubky — never a session id.
 */
export function findViewerPendingHoldOrder(
  orders: readonly ViewerHoldOrderView[],
  listingAggregateId: string,
  viewerPubky: string | null | undefined,
): { orderId: string } | null {
  if (!viewerPubky) return null;
  for (const { order } of orders) {
    if (order.buyerPubky !== viewerPubky) continue;
    if (order.state !== 'pending_payment') continue;
    if (!order.lines.some((line) => line.listingAggregateId === listingAggregateId)) continue;
    return { orderId: order.id };
  }
  return null;
}

type ViewerAcceptedOffer = {
  id: string;
  state: string;
  buyerPubky: string;
  listingAggregateId: string;
  award?: { state: string } | null;
};

/**
 * Match a reserved listing to the viewer's accepted offer award.
 * Compare `offer.buyerPubky` to `MarketplaceSessionService.getActiveSession().pubky`.
 * A pending-payment order hold wins over this match.
 */
export function findViewerAcceptedOfferHold(
  offers: readonly ViewerAcceptedOffer[],
  listingAggregateId: string,
  sessionPubky: string | null | undefined,
): { offerId: string } | null {
  if (!sessionPubky) return null;
  for (const offer of offers) {
    if (offer.buyerPubky !== sessionPubky) continue;
    if (offer.state !== 'accepted') continue;
    if (offer.listingAggregateId !== listingAggregateId) continue;
    if (offer.award?.state !== 'active') continue;
    return { offerId: offer.id };
  }
  return null;
}
