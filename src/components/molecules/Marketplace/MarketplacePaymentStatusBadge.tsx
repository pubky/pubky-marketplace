import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/atoms/Badge/Badge';
import {
  bitcoinPaidConfirmation,
  bitcoinSeenBadgeLabel,
  PAYMENT_CONFIRMED_ON_CHAIN_LABEL,
  PAYMENT_SELLER_CONFIRMED_LABEL,
} from '@/libs/commerce/bitcoin-buyer-status';
import { PAYMENT_WINDOW_ELAPSED_REASON } from '@/libs/commerce/checkout-hold';
import { type BuyerVisiblePaymentStatus, buyerVisiblePaymentStatus } from '@/libs/commerce/locks-payment';
import { isPaykitOrder, observedPaymentRail, PAYMENT_RAIL_BADGE } from '@/libs/commerce/paykit-rail';
import { USDT_PHASE_BADGE_LABEL, usdtSettlementPhase } from '@/libs/commerce/usdt-buyer-status';
import type { MarketplaceOrder, MarketplacePayment } from '@/services/marketplace/marketplace';

const BUYER_VISIBLE_STATUS_LABELS: Record<BuyerVisiblePaymentStatus, string> = {
  awaiting_entitlement: 'Awaiting payment',
  confirmed: 'Payment confirmed',
  expired: 'Payment window expired',
  manual_review: 'Under manual review',
};

export function MarketplacePaymentStatusBadge({
  order,
  payment,
}: {
  order: MarketplaceOrder;
  payment: MarketplacePayment;
}) {
  const visibleStatus = buyerVisiblePaymentStatus(payment.state);
  const isTerminal = ['completed', 'cancelled', 'refunded_external', 'refunded_partial', 'closed'].includes(
    order.state,
  );
  const seenBadge =
    visibleStatus === 'awaiting_entitlement' && !isTerminal ? bitcoinSeenBadgeLabel(order, payment) : null;
  const paidBitcoin = bitcoinPaidConfirmation(order, payment);
  const paidBitcoinBadge = paidBitcoin
    ? paidBitcoin.sellerConfirmed
      ? PAYMENT_SELLER_CONFIRMED_LABEL
      : PAYMENT_CONFIRMED_ON_CHAIN_LABEL
    : null;
  const usdtPhase = usdtSettlementPhase(order, payment);
  const usdtBadge = usdtPhase !== null && usdtPhase !== 'awaiting' ? USDT_PHASE_BADGE_LABEL[usdtPhase] : null;
  // A reorged USDT payment stays paid but is not settled, so it never wears the confirmed check.
  const settled = visibleStatus === 'confirmed' && usdtPhase !== 'rechecking';
  // A cancel expires the payment too: a stated reason other than the lapse at Pay by reads as
  // cancelled; an order with no reason keeps the expired window it always showed (#359).
  const buyerCancelledUnpaid =
    order.state === 'cancelled' &&
    visibleStatus === 'expired' &&
    Boolean(order.cancellationReason) &&
    order.cancellationReason !== PAYMENT_WINDOW_ELAPSED_REASON;
  const visibleStatusLabel =
    seenBadge ??
    paidBitcoinBadge ??
    usdtBadge ??
    (isTerminal && (visibleStatus === 'awaiting_entitlement' || buyerCancelledUnpaid)
      ? order.state === 'cancelled'
        ? 'Order cancelled'
        : 'Not paid'
      : BUYER_VISIBLE_STATUS_LABELS[visibleStatus]);

  return (
    <Badge
      variant={settled ? 'default' : 'outline'}
      className={settled ? 'bg-brand text-primary-foreground' : undefined}
    >
      {settled && <Check aria-hidden="true" />}
      {visibleStatusLabel}
    </Badge>
  );
}

/** Payment labels can share an order's status row without duplicating its details panel. */
export function MarketplacePaymentStatusLabels({
  order,
  payment,
  isBuyer,
  isSandbox = false,
  statusHint,
}: {
  order: MarketplaceOrder;
  payment: MarketplacePayment;
  isBuyer: boolean;
  isSandbox?: boolean;
  statusHint?: ReactNode;
}) {
  const visibleStatus = buyerVisiblePaymentStatus(payment.state);
  const paidBitcoin = bitcoinPaidConfirmation(order, payment);
  return (
    <>
      <MarketplacePaymentStatusBadge order={order} payment={payment} />
      {statusHint}
      {paidBitcoin?.sellerConfirmed && paidBitcoin.onChain && (
        <Badge variant="outline" data-testid="bitcoin-on-chain-badge">
          {PAYMENT_CONFIRMED_ON_CHAIN_LABEL}
        </Badge>
      )}
      {payment.adapter === 'locks' && <Badge variant="outline">Locks/Paykit</Badge>}
      {isPaykitOrder(order) && (
        <Badge variant="outline">{PAYMENT_RAIL_BADGE[observedPaymentRail(order) ?? 'paykit']}</Badge>
      )}
      {isBuyer &&
        visibleStatus === 'awaiting_entitlement' &&
        order.state === 'pending_payment' &&
        order.paymentMethod === 'paypal' && <Badge variant="outline">Item reserved</Badge>}
      {order.paymentMethod === 'paypal' && <Badge variant="outline">PayPal</Badge>}
      {/* How a fiat rail is verified stays on the order: a gateway-notified
            PayPal payment was confirmed by PayPal's own notification;
            seller-attested is the seller saying so. */}
      {order.fiatVerification === 'gateway-notified' && (!isBuyer || visibleStatus === 'confirmed') && (
        <Badge variant="outline">{isBuyer ? 'Confirmed by PayPal' : 'PayPal-verified'}</Badge>
      )}
      {order.fiatVerification === 'seller-attested' && (!isBuyer || visibleStatus === 'confirmed') && (
        <Badge variant="outline">{isBuyer ? 'Confirmed by seller' : 'Seller-attested'}</Badge>
      )}
      {isSandbox && <Badge variant="outline">Sandbox · simulated payment · no real funds</Badge>}
    </>
  );
}
