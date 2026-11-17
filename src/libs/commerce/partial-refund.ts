import { formatBitcoinAwareMoney } from '@/libs/commerce/bitcoin-payment-code';
import { formatBitcoinAmount } from '@/libs/commerce/pricing';
import {
  type CommerceMoney,
  PARTIAL_REFUND_ORDER_STATE,
  type RefundCap,
  type RefundUnit,
} from '@/libs/commerce/transaction-contracts';

export { PARTIAL_REFUND_ORDER_STATE };

type RefundOrder = {
  state: string;
  total: CommerceMoney;
  externalRefund?: { amountMinor: number; amountUnit?: RefundUnit } | null;
  externalRefundFull?: boolean | null;
  refundCap?: RefundCap | null;
};

/**
 * Whether a refund recorded in sats covers the sats received: the service's
 * `externalRefundFull`, which every participant sees, else the seller's
 * `refundCap`. Null when neither says. A partial refund leaves the order
 * `refunded_external` like a full one, so the state cannot tell.
 */
export function satsRefundIsFull(order: RefundOrder): boolean | null {
  const refund = order.externalRefund;
  if (refund?.amountUnit !== 'sat') return null;
  if (typeof order.externalRefundFull === 'boolean') return order.externalRefundFull;
  return order.refundCap?.unit === 'sat' ? refund.amountMinor >= order.refundCap.amountMinor : null;
}

/**
 * "Refunded $X of $Y" when the service marks a partial state or stores less
 * than the most it could. A refund recorded in sats is read against the sats
 * received: the seller's `refundCap` names them, while the buyer's label
 * names the sats refunded alone. Any other refund is read against the order
 * total, or `capMinor` (in the total's units) when the order received another
 * amount.
 */
export function partialRefundLabel(
  order: RefundOrder | null | undefined,
  capMinor: number = order?.total.amountMinor ?? 0,
): string | null {
  const refund = order?.externalRefund;
  if (!order || !refund) return null;
  if (refund.amountUnit === 'sat') {
    if (satsRefundIsFull(order) !== false) return null;
    const refunded = formatBitcoinAmount(refund.amountMinor);
    return order.refundCap?.unit === 'sat'
      ? `Refunded ${refunded} of ${formatBitcoinAmount(order.refundCap.amountMinor)}`
      : `Partly refunded ${refunded}`;
  }
  const partial = order.state === PARTIAL_REFUND_ORDER_STATE || refund.amountMinor < capMinor;
  if (!partial) return null;
  const refunded = formatBitcoinAwareMoney({ ...order.total, amountMinor: refund.amountMinor });
  const total = formatBitcoinAwareMoney({ ...order.total, amountMinor: capMinor });
  return `Refunded ${refunded} of ${total}`;
}

/**
 * The seller-facing sentence from a `refund.record_external` refusal.
 * Plain text only: the service's static refusal, not markup or a dumped body.
 */
export function plainRefundRefusal(message: unknown): string | null {
  if (typeof message !== 'string') return null;
  const text = message.trim();
  if (text.length === 0 || text.length > 240) return null;
  if (/[\u0000-\u001f<>]/.test(text)) return null;
  return text;
}
