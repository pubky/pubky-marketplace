import { PAYMENT_RECEIVED_REVIEW_COPY } from './bitcoin-buyer-status';
import { CHECKOUT_HOLD_COPY } from './checkout-hold';
import { formatCommerceMoney } from './format';
import { observedPaymentRail } from './paykit-rail';
import { formatUsdt, USDT_EXPONENT } from './payment-options';
import type { CommerceMoney } from './transaction-contracts';
import type { PaymentFinality } from './usdt-settlement-contract';

/**
 * Buyer and seller copy for a USDT order (docs/ecommerce/usdt-payments.md).
 * USDT is paid at verified inclusion; physical fulfilment waits for Arbitrum
 * to finalize. This table is rail-keyed on purpose: the Bitcoin tables in
 * `bitcoin-buyer-status.ts` keep their exact strings and nothing here is a
 * substitution of them.
 */

export const USDT_NETWORK_LABEL = 'USDT0 on Arbitrum One';

export const USDT_WALLET_HINT = 'Pay with a Bitkit version that supports USDT.';

/** Shown while a bound USDT request is unpaid: a wallet that cannot cover amount plus fees never says so. */
export const USDT_FUNDS_HINT =
  "If your wallet can't cover the amount plus network fees, choose another method before the hold ends.";

/** Shown before and while a buyer pays in USDT for goods the seller has to ship or hand over. */
export const USDT_FINALITY_EXPECTATION_COPY =
  'The seller ships once Arbitrum finalizes your payment, usually in about 15–20 minutes.';

/** The same expectation before the buyer has chosen an asset: it applies only if they pay in USDT. */
export const PAYKIT_USDT_FINALITY_EXPECTATION_COPY =
  'If you pay in USDT, the seller ships once Arbitrum finalizes your payment, usually in about 15–20 minutes.';

/** A multi-seller USDT cart sends one Paykit request per seller. */
export const USDT_MULTI_SELLER_COPY = "You'll approve one request per seller in Bitkit.";

/** Seller-facing refusal and disabled-action copy for ship, mark ready and pickup. */
export const PAYMENT_NOT_FINAL_COPY =
  "Wait to ship: this USDT payment isn't final on Arbitrum yet. This usually takes about 15–20 minutes.";

export const USDT_AMOUNT_MISMATCH_COPY = 'The USDT amount does not match. The seller is reviewing it.';

type UsdtStatusOrder = {
  paymentMethod?: string | null;
  paymentAsset?: string | null;
  paymentAmountMinor?: number | null;
  paymentFinality?: PaymentFinality | null;
  paykitRequestState?: string | null;
  total?: CommerceMoney;
};

type UsdtStatusPayment = { state?: string | null; reviewReason?: string | null } | null;

export type UsdtSettlementPhase = 'awaiting' | 'seen' | 'received' | 'final' | 'rechecking' | 'review';

/**
 * Shipped and pickup lines wait for Arbitrum finality before the seller acts;
 * a service-sealed digital line releases at inclusion and never waits.
 */
export function usdtFulfilmentWaitsForFinality(fulfillments: readonly (string | undefined)[]): boolean {
  return fulfillments.some((fulfillment) => fulfillment !== 'digital');
}

/** The order was, or is being, paid in USDT: the observed asset, else a legacy `usdt` method. */
export function isUsdtOrder(order: { paymentMethod?: string | null; paymentAsset?: string | null }): boolean {
  return observedPaymentRail(order) === 'usdt';
}

/**
 * Where a USDT order sits. `seen` is a transfer that arrived on a
 * seller-confirmed order and waits for the seller; `received` is paid with
 * finality not yet reported (an absent value fails closed, the same as
 * `pending`); `rechecking` is a reorged payment that stays paid but not final.
 * Null for any order that is not a USDT order.
 */
export function usdtSettlementPhase(order: UsdtStatusOrder, payment: UsdtStatusPayment): UsdtSettlementPhase | null {
  if (!isUsdtOrder(order)) return null;
  if (payment?.state === 'manual_review') return 'review';
  if (payment?.state !== 'confirmed') {
    return order.paykitRequestState === 'awaiting_seller_confirmation' ? 'seen' : 'awaiting';
  }
  if (order.paymentFinality === 'final') return 'final';
  if (order.paymentFinality === 'reverted') return 'rechecking';
  return 'received';
}

/**
 * Physical fulfilment (ship, mark ready, pickup handover) on a USDT order
 * waits until the payment is final. Absent finality fails closed. The service
 * refuses the same commands with `payment_not_final`, so this only avoids
 * offering a button that cannot succeed.
 */
export function isUsdtFulfilmentBlocked(order: UsdtStatusOrder): boolean {
  return isUsdtOrder(order) && order.paymentFinality !== 'final';
}

export const USDT_BUYER_PHASE_COPY: Record<Exclude<UsdtSettlementPhase, 'review'>, string> = {
  awaiting: 'Waiting for your USDT payment',
  seen: 'USDT payment received. The seller confirms it, then your order is paid.',
  received: 'USDT payment received. The seller ships once Arbitrum finalizes it.',
  final: 'USDT payment confirmed',
  rechecking: "Your payment is being re-checked on Arbitrum. You don't need to do anything yet.",
};

export const USDT_SELLER_PHASE_COPY: Record<Exclude<UsdtSettlementPhase, 'review'>, string> = {
  awaiting: "Waiting for the buyer's USDT payment",
  seen: "The buyer's USDT payment arrived. Check it in Bitkit, then confirm it below to mark the order paid.",
  received: "Payment received. Don't ship yet: Arbitrum hasn't finalized it. Shipping unlocks on its own.",
  final: 'Payment final. You can ship.',
  rechecking: "The buyer's payment is being re-checked on Arbitrum. Don't ship.",
};

/**
 * What the seller does while a reorged payment is re-checked. Plan §2.5: money
 * that never settles owes no refund, and the seller checks Bitkit before
 * approving a cancellation. The order carries no re-check timestamp, so the
 * line shows for the whole re-checking phase and reads as conditional.
 */
export const USDT_RECHECKING_NEXT_STEP_COPY =
  "If the payment doesn't come back, check Bitkit before approving any cancellation.";

/** The seller's review line for a USDT payment, keyed by why it needs a decision. */
export const USDT_SELLER_REVIEW_COPY = {
  late_settlement:
    'This USDT payment arrived after the payment window ended, so you decide the outcome below. No funds are held by this marketplace.',
  amount_mismatch:
    "This USDT payment doesn't match the order total, so you decide the outcome below. No funds are held by this marketplace.",
} as const;

export const USDT_PHASE_BADGE_LABEL: Record<UsdtSettlementPhase, string> = {
  awaiting: 'Awaiting payment',
  seen: 'Payment seen',
  received: 'Payment received',
  final: 'Payment confirmed',
  rechecking: 'Payment being re-checked',
  review: 'Under manual review',
};

/** One sentence for the order's USDT phase, for the viewing party. Null when the order is not USDT. */
export function usdtPhaseCopy(order: UsdtStatusOrder, payment: UsdtStatusPayment, isBuyer: boolean): string | null {
  const phase = usdtSettlementPhase(order, payment);
  if (phase === null) return null;
  if (phase === 'review') return isBuyer ? usdtBuyerReviewCopy(payment) : null;
  return (isBuyer ? USDT_BUYER_PHASE_COPY : USDT_SELLER_PHASE_COPY)[phase];
}

/**
 * The seller's reason-keyed line for a USDT payment in manual review, or null
 * for a reason that has none (`refund_required` has its own copy, and an
 * unknown or missing reason keeps the generic review line).
 */
export function usdtSellerReviewCopy(payment: UsdtStatusPayment): string | null {
  const reason = payment?.reviewReason;
  return reason === 'late_settlement' || reason === 'amount_mismatch' ? USDT_SELLER_REVIEW_COPY[reason] : null;
}

function usdtBuyerReviewCopy(payment: UsdtStatusPayment): string {
  if (payment?.reviewReason === 'refund_required') return CHECKOUT_HOLD_COPY.refundRequiredBuyer;
  if (payment?.reviewReason === 'amount_mismatch') return USDT_AMOUNT_MISMATCH_COPY;
  return PAYMENT_RECEIVED_REVIEW_COPY;
}

/** The USDT amount the order was bound at, or null when the service sent none. */
export function usdtAmountLabel(order: UsdtStatusOrder): string | null {
  const minor = order.paymentAmountMinor;
  if (minor === null || minor === undefined || !isUsdtOrder(order)) return null;
  return formatUsdt(minor);
}

/**
 * The receipt line: "$1,250.00, paid as 1,250.000000 USDT". Null until the
 * order carries both amounts. It is a record, so the USDT figure is grouped
 * like the dollar figure beside it; the amount to pay stays ungrouped.
 */
export function usdtPaidAsLine(order: UsdtStatusOrder): string | null {
  const minor = order.paymentAmountMinor;
  if (minor === null || minor === undefined || !isUsdtOrder(order) || !order.total) return null;
  return `${formatCommerceMoney(order.total)}, paid as ${formatUsdt(minor, { grouped: true })}`;
}

const USDT_MILLIONTHS_PER_CENT = 10 ** (USDT_EXPONENT - 2);

/**
 * The exact USDT a USD total settles at (parity, no rounding), or null when
 * any total is not USD with two decimals. Checkout quotes it before any order
 * exists; the bound order then carries the service's own figure.
 */
export function usdtParityMillionths(totals: readonly CommerceMoney[]): number | null {
  if (totals.length === 0) return null;
  let cents = 0;
  for (const money of totals) {
    if (money.currency !== 'USD' || money.exponent !== 2) return null;
    cents += money.amountMinor;
  }
  const millionths = cents * USDT_MILLIONTHS_PER_CENT;
  return Number.isSafeInteger(millionths) ? millionths : null;
}
