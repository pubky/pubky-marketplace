'use client';

import { Typography } from '@/atoms/Typography/Typography';
import type { MarketplaceSellerAnnualLimit } from '@/core/services/marketplace/marketplace-projections';
import { InfoHint } from '@/molecules/InfoHint/InfoHint';

const euro = new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

function euros(cents: number): string {
  return euro.format(cents / 100);
}

/**
 * A seller's counters under the EU annual limit (legal launch plan C4): shown only to sellers
 * resident in the EU, with one line on why, and a prompt to re-confirm a private status once the
 * seller's sales to EU buyers reach the same numbers.
 */
export function SellerAnnualLimitNotice({ limit }: { limit: MarketplaceSellerAnnualLimit }) {
  const showCounters = limit.residentInEu && limit.sales !== undefined && limit.eurCents !== undefined;
  if (!showCounters && !limit.reconfirmationRequired) return null;

  return (
    <div className="grid gap-2 rounded-md border p-4" data-testid="seller-annual-limit">
      {showCounters && (
        <div className="flex items-center gap-1.5">
          <Typography as="p" className="text-sm font-medium" data-testid="seller-annual-limit-counters">
            Sales this year: {limit.sales} of {limit.salesLimit}, {euros(limit.eurCents ?? 0)} of{' '}
            {euros(limit.eurLimitCents ?? 0)}
          </Typography>
          <InfoHint label="About the yearly limit" data-testid="seller-annual-limit-info">
            {`Sellers based in the EU can make ${limit.salesLimit} sales or ${euros(limit.eurLimitCents ?? 0)} a calendar year, whichever comes first. After that, buyers can’t order from your shop until the new year.`}
          </InfoHint>
        </div>
      )}
      {limit.reconfirmationRequired && (
        <Typography as="p" className="text-sm font-medium" role="status" data-testid="seller-annual-limit-reconfirm">
          You’ve sold {limit.euBuyerSales} times to buyers in the EU. Confirm below that you still sell as a private
          individual before your next EU sale.
        </Typography>
      )}
    </div>
  );
}
