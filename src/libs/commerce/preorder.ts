import {
  COMMERCE_PREORDER_DEFAULT_GRACE_DAYS,
  type CommerceListingPreorder,
  commercePreorderShipBy,
} from '@/libs/commerce/marketplace-records';

const preorderDateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A preorder date (`YYYY-MM-DD` or an instant) as the buyer and seller read it, in UTC. */
export function formatPreorderDate(date: string | Date): string {
  return preorderDateFormat.format(typeof date === 'string' ? new Date(`${date.slice(0, 10)}T00:00:00.000Z`) : date);
}

/** The day the buyer may cancel an unshipped preorder from, for copy. */
export function preorderCancelFrom(preorder: CommerceListingPreorder): string {
  return formatPreorderDate(commercePreorderShipBy(preorder));
}

/** The frozen preorder the service projects on an order. */
export interface MarketplaceOrderPreorder {
  shipsFrom: string;
  graceDays: number;
  shipBy: string;
  overdueAt: string | null;
}

/** Whether the buyer may cancel the order alone now: still paid at or after its ship-by deadline. */
export function preorderLateCancelOpen(
  order: { state: string; preorder?: MarketplaceOrderPreorder | null },
  now: Date = new Date(),
): boolean {
  return order.state === 'paid' && !!order.preorder && now.getTime() >= Date.parse(order.preorder.shipBy);
}

export const PREORDER_COPY = {
  buyLabel: 'Preorder',
  badge: (shipsFrom: string) => `Preorder · ships from ${formatPreorderDate(shipsFrom)}`,
  checkoutTerms: (preorder: CommerceListingPreorder) =>
    `Preorder: you pay now and the seller ships from ${formatPreorderDate(preorder.shipsFrom)}. ` +
    `If it has not shipped by ${preorderCancelFrom(preorder)}, you can cancel for a refund.`,
  orderShipsFrom: (preorder: MarketplaceOrderPreorder) =>
    `Preorder · ships from ${formatPreorderDate(preorder.shipsFrom)}. Cancel for a refund from ${formatPreorderDate(preorder.shipBy)} if it has not shipped.`,
  sellerShipBy: (preorder: MarketplaceOrderPreorder) =>
    `Preorder · ship by ${formatPreorderDate(preorder.shipBy)} or the buyer can cancel for a refund.`,
  overdue: 'Not shipped in time',
  buyerLateCancel: 'Cancel, not shipped in time',
  buyerLateCancelHint: 'The seller missed the ship-by date. Cancelling is immediate and the seller owes your refund.',
  lateCancelReason: 'Not shipped in time',
  refundDue: 'Refund due',
  refundDueHint: 'The buyer cancelled this preorder because it did not ship in time. Send the refund, then record it.',
  buyerRefundDue: 'Cancelled: not shipped in time. The seller owes your refund.',
  defaultGraceDays: COMMERCE_PREORDER_DEFAULT_GRACE_DAYS,
} as const;
