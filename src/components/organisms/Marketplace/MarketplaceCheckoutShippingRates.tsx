'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import { Typography } from '@/atoms/Typography/Typography';
import type { ShippingGroupView } from '@/hooks/useMarketplaceShippingGroups/useMarketplaceShippingGroups';
import { formatCommerceMoney } from '@/libs/commerce/format';
import { groupQuoteRefusalCopy } from '@/libs/commerce/shipping-quote-copy';
import type { ShippingQuote } from '@/libs/commerce/shipping-zones';

type Props = {
  groups: readonly ShippingGroupView[];
  onChange: (groupKey: string, rateId: string) => void;
  /** True while a checkout is being sent: the picks stay as the buyer saw them. */
  disabled?: boolean;
};

function estimate(quote: ShippingQuote): string {
  return quote.estimatedMinDays === quote.estimatedMaxDays
    ? `${quote.estimatedMinDays} days`
    : `${quote.estimatedMinDays}-${quote.estimatedMaxDays} days`;
}

function message(state: Exclude<ShippingGroupView['state'], { status: 'ready' }>): string {
  switch (state.status) {
    case 'loading':
      return 'Loading shipping prices.';
    case 'unreadable':
      return 'This seller’s shipping prices could not be read.';
    case 'asset-mismatch':
      return 'This seller’s shipping rates are priced in a different currency than the item.';
    case 'needs-destination':
      return 'Enter your delivery country to see shipping prices.';
    case 'refused':
      return groupQuoteRefusalCopy(state.code);
  }
}

/** One rate choice per shipping group whose price depends on the delivery country. */
export function MarketplaceCheckoutShippingRates({ groups, onChange, disabled = false }: Props) {
  if (groups.length === 0) return null;
  return (
    <div className="grid gap-4" data-testid="checkout-shipping-rates">
      {groups.map((group) => {
        const { state } = group;
        const selectId = `checkout-shipping-rate-${group.key}`;
        return (
          <div key={group.key} className="grid gap-1.5">
            <label htmlFor={selectId} className="text-sm font-medium">
              Shipping for {group.label}
            </label>
            {state.status === 'ready' ? (
              <Select
                value={state.selectedRateId}
                disabled={disabled}
                onValueChange={(rateId) => onChange(group.key, rateId)}
              >
                <SelectTrigger theme="secondary" id={selectId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {state.quotes.map((quote) => (
                    <SelectItem key={quote.rateId} value={quote.rateId}>
                      {quote.label} · {formatCommerceMoney({ amountMinor: quote.amountMinor, ...group.asset })} ·{' '}
                      {estimate(quote)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Typography as="p" id={selectId} className="text-sm text-muted-foreground" role="status">
                {/* Keyed so a new message replaces the span: a page translator detaches the text nodes React
                    owns, and swapping only the text would leave the old translated message on screen. */}
                <span key={message(state)}>{message(state)}</span>
              </Typography>
            )}
          </div>
        );
      })}
    </div>
  );
}
