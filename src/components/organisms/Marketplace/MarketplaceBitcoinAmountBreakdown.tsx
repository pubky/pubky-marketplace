import { Typography } from '@/atoms/Typography/Typography';
import {
  BITCOIN_PAYMENT_CODE_EXPLANATION,
  bitcoinPaymentBreakdown,
  formatBitcoinAwareMoney,
} from '@/libs/commerce/bitcoin-payment-code';
import { cn } from '@/libs/utils/utils';
import type { MarketplaceOrder } from '@/services/marketplace/marketplace';

/**
 * Items + shipping + payment code = the exact bitcoin amount. The code is
 * the small unique amount added so the payment can be matched.
 */
export function MarketplaceBitcoinAmountBreakdown({
  order,
  showExact = false,
  explainCode = false,
  className,
}: {
  order: MarketplaceOrder;
  /** The payment step names the figure the buyer sends. */
  showExact?: boolean;
  /** The payment step says what the payment code is. */
  explainCode?: boolean;
  className?: string;
}) {
  const breakdown = bitcoinPaymentBreakdown(order);
  if (!breakdown) return null;

  return (
    <div className={cn('grid gap-6', className)} data-testid="bitcoin-amount-breakdown">
      <table className="w-full text-sm" aria-label="Bitcoin payment breakdown">
        <tbody>
          {[
            { label: 'Items', amount: breakdown.items },
            { label: 'Shipping', amount: breakdown.shipping },
            { label: explainCode ? 'Payment code*' : 'Payment code', amount: breakdown.paymentCode },
          ].map(({ label, amount }) => (
            <tr key={label} className="last:[&>td]:pb-4 last:[&>th]:pb-4">
              <th scope="row" className="py-1.5 pr-4 text-left font-normal text-muted-foreground">
                {label}
              </th>
              <td className="py-1.5 text-right tabular-nums">{formatBitcoinAwareMoney(amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border">
            <th scope="row" className="pt-4 pr-4 text-left font-semibold">
              Total
            </th>
            <td
              className={cn('pt-4 text-right font-semibold tabular-nums', showExact && 'text-lg text-brand')}
              data-testid={showExact ? 'bitcoin-amount-due' : undefined}
            >
              {formatBitcoinAwareMoney(breakdown.payable)}
            </td>
          </tr>
        </tfoot>
      </table>
      {explainCode ? (
        <Typography as="p" className="text-xs text-muted-foreground" data-testid="bitcoin-payment-code-explanation">
          *{BITCOIN_PAYMENT_CODE_EXPLANATION}
        </Typography>
      ) : null}
    </div>
  );
}
