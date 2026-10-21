/**
 * Whether a freshly read order already shows the outcome of an order command.
 *
 * A revision conflict means the revision the dialog held was stale. The
 * command may still have landed (the return window can close, and the
 * request can commit, between open and confirm). The caller re-reads and
 * uses this to decide: the visible result is success; anything else stays
 * a conflict.
 */

export type CommandOrderSnapshot = {
  state: string;
  buyerPubky?: string;
  sellerPubky?: string;
  cancellationReason?: string | null;
  shipment?: { carrier: string; trackingNumber: string; state: string } | null;
  returnRequest?: { state: string; reason: string; requestedAmountMinor: number } | null;
  externalRefund?: { amountMinor: number; transactionId: string } | null;
  refundDestination?: { address: string } | null;
  reviews?:
    | {
        reviewerPubky?: string;
        listingAggregateId?: string;
        rating: number;
        text: string;
        shipping?: number | null;
        communication?: number | null;
      }[]
    | null;
};

// A refunded order proves delivery only through its delivered shipment:
// a PayPal refund or reversal also moves a `shipped` order to
// `refunded_external`.
const DELIVERED_OR_LATER = new Set([
  'delivered',
  'completed',
  'return_requested',
  'return_approved',
  'return_received',
]);

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function minor(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

export function orderShowsCommandResult(
  order: CommandOrderSnapshot,
  kind: string,
  payload: Record<string, unknown>,
): boolean {
  switch (kind) {
    case 'return.request': {
      const request = order.returnRequest;
      return (
        request != null &&
        request.reason === text(payload.reason) &&
        request.requestedAmountMinor === minor(payload.requestedAmountMinor)
      );
    }
    case 'return.approve':
      return (
        order.returnRequest?.state === 'approved' ||
        order.returnRequest?.state === 'received' ||
        order.returnRequest?.state === 'refunded'
      );
    case 'return.cancel':
      return order.returnRequest == null && order.state !== 'return_requested';
    case 'return.receive':
      return (
        order.returnRequest?.state === 'received' ||
        order.returnRequest?.state === 'refunded' ||
        order.state === 'return_received' ||
        order.state === 'refunded_external' ||
        order.state === 'refunded_partial'
      );
    case 'order.cancel_request':
      return (
        order.cancellationReason === text(payload.reason) &&
        (order.state === 'cancel_requested' || order.state === 'cancelled')
      );
    case 'order.cancel_approve':
      return order.state === 'cancelled';
    case 'fulfillment.ship':
    case 'fulfillment.update_tracking':
      return (
        order.shipment != null &&
        order.shipment.carrier === text(payload.carrier) &&
        order.shipment.trackingNumber === (text(payload.trackingNumber) ?? '')
      );
    case 'fulfillment.confirm_delivery':
      return order.shipment?.state === 'delivered' || DELIVERED_OR_LATER.has(order.state);
    case 'refund.record_external':
      return (
        order.externalRefund != null &&
        order.externalRefund.amountMinor === minor(payload.amountMinor) &&
        order.externalRefund.transactionId === text(payload.transactionId)
      );
    case 'refund.confirm_destination':
      return (
        order.refundDestination != null &&
        text(payload.address) !== null &&
        order.refundDestination.address.toLowerCase() === text(payload.address)?.toLowerCase()
      );
    case 'review.create':
    case 'review.update': {
      if (Array.isArray(payload.items)) return orderShowsReviewItems(order, payload);
      const rating = minor(payload.rating);
      const reviewText = text(payload.text);
      return (order.reviews ?? []).some((review) => review.rating === rating && review.text === reviewText);
    }
    default:
      return false;
  }
}

/**
 * Per-item review terms (buyer only): shown once the order carries the
 * buyer's review of every named listing with the sent stars and text, and
 * the sent seller ratings on every one of the buyer's reviews of the order.
 */
function orderShowsReviewItems(order: CommandOrderSnapshot, payload: Record<string, unknown>): boolean {
  if (order.buyerPubky === undefined || order.sellerPubky === undefined) return false;
  const buyerReviews = (order.reviews ?? []).filter((review) => review.reviewerPubky === order.buyerPubky);
  const items = payload.items as Record<string, unknown>[];
  const itemsShown = items.every((item) => {
    const listingId = text(item.listingId);
    if (listingId === null) return false;
    const aggregateId = `listing:${order.sellerPubky}_${listingId}`;
    return buyerReviews.some(
      (review) =>
        review.listingAggregateId === aggregateId &&
        review.rating === minor(item.rating) &&
        review.text === (text(item.text) ?? ''),
    );
  });
  if (!itemsShown) return false;
  const seller = payload.seller as { shipping?: unknown; communication?: unknown } | undefined;
  if (seller === undefined) return true;
  return buyerReviews.every(
    (review) => review.shipping === minor(seller.shipping) && review.communication === minor(seller.communication),
  );
}
