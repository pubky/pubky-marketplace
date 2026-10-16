import { Badge } from '@/atoms/Badge/Badge';
import { CHECKOUT_IN_PROGRESS_LABEL } from '@/libs/commerce/checkout-phase';
import { MarketplacePaymentStatusLabels } from '@/molecules/Marketplace/MarketplacePaymentStatusBadge';
import type { MarketplaceOrder, MarketplacePayment } from '@/services/marketplace/marketplace';

/** Shared status row above the products in a checkout or a resumed checkout. */
export function MarketplaceCheckoutStatusLabels({
  order,
  payment,
  isSandbox = false,
  showCheckoutPhase = true,
}: {
  order: MarketplaceOrder;
  payment: MarketplacePayment | null;
  isSandbox?: boolean;
  showCheckoutPhase?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 empty:hidden" data-testid="marketplace-checkout-status-labels">
      {showCheckoutPhase && order.state === 'pending_payment' && (
        <Badge variant="outline">{CHECKOUT_IN_PROGRESS_LABEL}</Badge>
      )}
      {payment && <MarketplacePaymentStatusLabels order={order} payment={payment} isBuyer isSandbox={isSandbox} />}
      {order.fulfillment === 'pickup' && <Badge variant="outline">Local pickup</Badge>}
      {order.fulfillment === 'digital' && <Badge variant="outline">Digital delivery</Badge>}
    </div>
  );
}
