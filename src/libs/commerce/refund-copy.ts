import {
  bitcoinPaymentBreakdown,
  type BitcoinPaymentOrder,
  formatBitcoinAmountBreakdown,
  formatBitcoinAwareMoney,
  satoshiCount,
} from '@/libs/commerce/bitcoin-payment-code';
import { MARKETPLACE_FAILURE_MESSAGES } from '@/libs/commerce/failure-messages';
import { partialRefundLabel, satsRefundIsFull } from '@/libs/commerce/partial-refund';
import { formatBitcoinAmount } from '@/libs/commerce/pricing';
import type { CommerceMoney, RefundCap, RefundUnit } from '@/libs/commerce/transaction-contracts';
import {
  isUsdtRefundOrder,
  type RefundDestination,
  usdtRefundCap,
  usdtRefundCapMinor,
  usdtRefundRecordLine,
} from '@/libs/commerce/usdt-refund';

type RefundCopyOrder = {
  state: string;
  total: CommerceMoney;
  paymentMethod?: BitcoinPaymentOrder['paymentMethod'];
  paymentAsset?: string | null;
  paymentAmountMinor?: number | null;
  refundDestination?: RefundDestination | null;
  subtotal?: CommerceMoney;
  shipping?: CommerceMoney;
  merchandiseTotal?: CommerceMoney | null;
  bitcoinPayable?: CommerceMoney | null;
  paykitTotalSats?: number | null;
  bitcoinQuote?: BitcoinPaymentOrder['bitcoinQuote'];
  externalRefund?: { amountMinor: number; transactionId: string; amountUnit?: RefundUnit } | null;
  externalRefundFull?: boolean | null;
  refundCap?: RefundCap | null;
  paymentReversedAt?: string | null;
  paymentReversalCancelledAt?: string | null;
  gatewayRefundReviewAt?: string | null;
  gatewayRefundUnmatched?: boolean;
};

export const REFUND_ORDER_NOTICES = {
  reversed:
    'PayPal reversed this payment after a dispute or chargeback. This order updates if PayPal cancels the reversal.',
  reversalCancelled: 'PayPal cancelled the payment reversal and returned the money to the seller.',
  refundOnHold:
    'PayPal sent a refund notice for this order that does not match its payment. It is on hold and has not changed this order.',
  refundNeedsCheck:
    'PayPal reported a refund the Shop could not apply to this order automatically. Check it in PayPal.',
} as const;

export type RefundOrderNotice = keyof typeof REFUND_ORDER_NOTICES;

/** The order-card state pill for refunded orders. Null when the state is not refund-specific. */
export function refundStateLabel(order: RefundCopyOrder): string | null {
  const partial = usdtRefundCap(order) ? null : partialRefundLabel(order, usdtRefundCapMinor(order) ?? undefined);
  if (partial) return partial;
  if (order.state !== 'refunded_external') return null;
  if (isUsdtRefundOrder(order)) return 'Refund recorded';
  return order.paymentReversedAt ? 'Payment reversed' : 'Refunded';
}

/** The refund amount and its reference, without claiming the Shop moved the money. */
export function refundRecordLine(order: RefundCopyOrder): string | null {
  const refund = order.externalRefund;
  if (!refund) return null;
  const partial = partialRefundLabel(order);
  if (isUsdtRefundOrder(order)) return usdtRefundRecordLine(order);
  const breakdown = refundBreakdown(order);
  const equation = breakdown ? formatBitcoinAmountBreakdown(breakdown) : null;
  if (partial && equation) return `${partial}. ${equation}. Reference: ${refund.transactionId}`;
  if (partial) return `${partial}. Reference: ${refund.transactionId}`;
  if (refund.amountUnit !== 'sat') {
    return `Refunded in full (${equation ?? formatBitcoinAwareMoney(order.total)}). Reference: ${refund.transactionId}`;
  }
  // Not known to be partial, nor to be full: no claim either way.
  if (satsRefundIsFull(order) !== true) {
    return `Refunded ${formatBitcoinAmount(refund.amountMinor)}. Reference: ${refund.transactionId}`;
  }
  // A refund in sats is the sats received, which an over- or underpaid order
  // holds apart from the payable its breakdown adds up to.
  const full =
    equation !== null && satoshiCount(breakdown?.payable) === refund.amountMinor
      ? equation
      : formatBitcoinAmount(refund.amountMinor);
  return `Refunded in full (${full}). Reference: ${refund.transactionId}`;
}

function refundBreakdown(order: RefundCopyOrder) {
  if (!order.subtotal || !order.shipping) return null;
  return bitcoinPaymentBreakdown({
    paymentMethod: order.paymentMethod,
    paymentAsset: order.paymentAsset,
    subtotal: order.subtotal,
    shipping: order.shipping,
    total: order.total,
    merchandiseTotal: order.merchandiseTotal,
    bitcoinPayable: order.bitcoinPayable,
    paykitTotalSats: order.paykitTotalSats,
    bitcoinQuote: order.bitcoinQuote,
  });
}

/** Plain lines for PayPal reversals and held refund notices, in display order. */
export function refundOrderNotices(order: RefundCopyOrder): RefundOrderNotice[] {
  const notices: RefundOrderNotice[] = [];
  if (order.paymentReversedAt) notices.push('reversed');
  else if (order.paymentReversalCancelledAt) notices.push('reversalCancelled');
  if (order.gatewayRefundUnmatched) notices.push('refundOnHold');
  if (order.gatewayRefundReviewAt) notices.push('refundNeedsCheck');
  return notices;
}

/** The revision-conflict toast, naming a refund or reversal that landed while the user acted. */
export function orderChangedMessage(before: RefundCopyOrder, after: RefundCopyOrder | null | undefined): string {
  if (!after) return MARKETPLACE_FAILURE_MESSAGES.orderChanged;
  if (after.paymentReversedAt && !before.paymentReversedAt) return MARKETPLACE_FAILURE_MESSAGES.orderReversedMeanwhile;
  if (after.state === 'refunded_external' && before.state !== 'refunded_external') {
    return MARKETPLACE_FAILURE_MESSAGES.orderRefundedMeanwhile;
  }
  if ((after.externalRefund?.amountMinor ?? 0) > (before.externalRefund?.amountMinor ?? 0)) {
    return MARKETPLACE_FAILURE_MESSAGES.orderRefundRecordedMeanwhile;
  }
  return MARKETPLACE_FAILURE_MESSAGES.orderChanged;
}
