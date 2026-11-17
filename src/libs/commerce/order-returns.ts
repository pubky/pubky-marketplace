import { COMMERCE_DEFAULT_AUTO_COMPLETE_DAYS } from '@/config/commerce';
import { formatTermDays } from '@/libs/commerce/seller-delivery-terms';

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
/**
 * The page reads the device clock. A clock running ahead must not hide the
 * button while the service would still take the request, so the Shop keeps it
 * a day past the window; a later request gets the service's
 * `return_window_closed` refusal.
 */
const DEVICE_CLOCK_GRACE_MS = DAY_MS;

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
  return nowMs > deliveredAt + policy.returnWindowDays * DAY_MS + DEVICE_CLOCK_GRACE_MS ? 'window_closed' : null;
}

/**
 * When a delivered order completes, for its delivered card. The service
 * completes it on the auto-complete period alone: the seller's frozen
 * `autoCompleteDays`, or the default (a buyer's review completes it earlier).
 * The return window is separate: it counts from delivery, and a completed
 * order still takes a return until it closes, so a window longer than the
 * auto-complete period is still open after completion. An open return keeps
 * the order from completing. A final sale takes no return, so it says nothing
 * of one.
 */
export function deliveredCompletionNote(order: {
  returnPolicy?: OrderReturnPolicy | null;
  autoCompleteDays?: number | null;
}): string {
  const autoCompleteDays = order.autoCompleteDays ?? COMMERCE_DEFAULT_AUTO_COMPLETE_DAYS;
  const completes = `Completes automatically ${formatTermDays(autoCompleteDays)} after delivery`;
  const policy = order.returnPolicy;
  if (policy && !policy.acceptsReturns) return `${completes}.`;
  const windowDays = policy?.returnWindowDays ?? null;
  if (windowDays === null) return `${completes} unless a return is requested.`;
  const afterCompletion = windowDays > autoCompleteDays ? ', even after the order completes' : '';
  return `${completes} unless a return is requested. A return can be requested within ${formatTermDays(windowDays)} of delivery${afterCompletion}.`;
}
