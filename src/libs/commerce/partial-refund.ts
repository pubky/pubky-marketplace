import { formatBitcoinAwareMoney } from '@/libs/commerce/bitcoin-payment-code';
import { type CommerceMoney, PARTIAL_REFUND_ORDER_STATE } from '@/libs/commerce/transaction-contracts';

export { PARTIAL_REFUND_ORDER_STATE };

type RefundOrder = {
  state: string;
  total: CommerceMoney;
  externalRefund?: { amountMinor: number } | null;
};

/**
 * "Refunded $X of $Y" when the service marks a partial state or stores less
 * than the most it could: the order total, or `capMinor` (in the total's units)
 * when the order received another amount.
 */
export function partialRefundLabel(
  order: RefundOrder | null | undefined,
  capMinor: number = order?.total.amountMinor ?? 0,
): string | null {
  const refund = order?.externalRefund;
  if (!order || !refund) return null;
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
