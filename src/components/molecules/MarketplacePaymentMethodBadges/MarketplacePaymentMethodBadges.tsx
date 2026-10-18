import type { LucideProps } from 'lucide-react';
import type { ComponentType } from 'react';
import { Badge } from '@/atoms/Badge/Badge';
import { BTCIcon, PaypalIcon, Tether } from '@/icons';
import { SELLER_PAYMENT_BADGE_LABELS, type SellerPaymentBadge } from '@/libs/commerce/payment-badges';
import { cn } from '@/libs/utils/utils';

const BADGE_ICONS: Record<SellerPaymentBadge, ComponentType<LucideProps>> = {
  bitcoin: BTCIcon,
  usdt: Tether,
  paypal: PaypalIcon,
};

/**
 * The payment rails a seller accepts, as small brand badges. Renders nothing
 * for an empty set, so a seller with no rails (or one not yet known) leaves
 * no empty row behind.
 */
export function MarketplacePaymentMethodBadges({
  methods,
  className,
  testId,
}: {
  methods: readonly SellerPaymentBadge[];
  className?: string;
  testId?: string;
}) {
  if (methods.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} data-testid={testId}>
      <span className="text-xs text-muted-foreground" aria-hidden="true">
        Accepts
      </span>
      <ul aria-label="Accepted payment methods" className="flex flex-wrap items-center gap-1.5">
        {methods.map((method) => {
          const Icon = BADGE_ICONS[method];
          return (
            <li key={method}>
              <Badge variant="secondary" data-payment-method={method}>
                <Icon aria-hidden="true" focusable="false" />
                {SELLER_PAYMENT_BADGE_LABELS[method]}
              </Badge>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
