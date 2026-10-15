'use client';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/atoms/Tooltip/Tooltip';
import { Typography } from '@/atoms/Typography/Typography';
import { resolveListingCurrency } from '@/config/currencies';
import { useIndicativeBtcRate } from '@/hooks/useIndicativeBtcRate/useIndicativeBtcRate';
import type { CommerceMoney } from '@/libs/commerce/transaction-contracts';
import { cn } from '@/libs/utils/utils';
import { indicativeHintLabel } from '@/pipes/money/money.convert';
import { fxRateSnapshotFromBtcRate } from '@/pipes/money/money.rates';
import { useMarketplaceDisplayStore } from '@/stores/marketplace-display/marketplace-display.store';

/**
 * The approximate converted counterpart of a listing price, in the buyer's
 * display currency: "≈ €11.50" under a dollar price. When the buyer displays
 * in the price's own currency the hint is the other side of the fiat and
 * bitcoin pair instead ("≈ ₿N" under a fiat price, "≈ $X" under a bitcoin
 * price). Marked approximate and explained in a tooltip because it is
 * display-only: the amount a payment settles is fixed by the service at
 * checkout, never by this estimate (docs/ecommerce/pricing.md).
 *
 * Renders NOTHING unless all of these hold: the user has the estimate toggle
 * on, the price is in a listing currency, and the rate fetch succeeded with a
 * rate for both currencies. No rate, no estimate — never an error state, never
 * a fallback.
 */
export function MarketplaceIndicativePrice({
  money,
  className,
  showApproximation = true,
}: {
  money: CommerceMoney;
  className?: string;
  showApproximation?: boolean;
}) {
  const showFxEstimate = useMarketplaceDisplayStore((state) => state.showFxEstimate);
  const displayCurrency = useMarketplaceDisplayStore((state) => state.displayCurrency);
  const isConvertible = resolveListingCurrency(money) !== null;
  const rates = useIndicativeBtcRate(showFxEstimate && isConvertible);
  if (rates === null) return null;

  const label = indicativeHintLabel(money, displayCurrency, fxRateSnapshotFromBtcRate(rates));
  if (label === null) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Typography as="span" className={cn('cursor-help text-xs text-muted-foreground', className)}>
          {showApproximation ? label : label.replace(/^≈\s*/, '')}
        </Typography>
      </TooltipTrigger>
      <TooltipContent>At current rate, indicative only</TooltipContent>
    </Tooltip>
  );
}
