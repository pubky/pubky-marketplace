/**
 * Whether the buyer may still request a return, from the listing's return
 * policy the service froze on the order when its payment started. The service
 * refuses the request in the same cases (`returns_not_accepted`,
 * `return_window_closed`); an order without a frozen policy takes a request
 * as before.
 */
export type OrderReturnPolicy = { acceptsReturns: boolean; returnWindowDays: number | null };

export type ReturnClosure = 'final_sale' | 'window_closed' | null;

const DAY_MS = 86_400_000;

export const ORDER_RETURN_COPY = {
  finalSale: "Final sale: the seller doesn't accept returns on this item.",
  windowClosed: 'The return window for this order has closed.',
} as const;

export function orderReturnClosure(
  order: { returnPolicy?: OrderReturnPolicy | null; shipment?: { deliveredAt: string | null } | null },
  nowMs: number | null,
): ReturnClosure {
  const policy = order.returnPolicy;
  if (!policy) return null;
  if (!policy.acceptsReturns) return 'final_sale';
  const deliveredAt = order.shipment?.deliveredAt ? Date.parse(order.shipment.deliveredAt) : NaN;
  if (policy.returnWindowDays === null || nowMs === null || Number.isNaN(deliveredAt)) return null;
  return nowMs > deliveredAt + policy.returnWindowDays * DAY_MS ? 'window_closed' : null;
}
