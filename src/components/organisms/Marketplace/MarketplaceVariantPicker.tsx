'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import { Typography } from '@/atoms/Typography/Typography';
import { isVariantSoldOut } from '@/libs/commerce/listing-variants';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { formatStockQuantity, UNLIMITED_STOCK_LABEL } from '@/libs/commerce/unlimited-stock';

export const VARIANT_SOLD_OUT_LABEL = 'Sold out';

export interface MarketplaceVariantPickerProps {
  record: Pick<CommerceListingRecord, 'variants' | 'fulfillmentMethods'>;
  selectedVariantId: string | undefined;
  onSelect: (variantId: string) => void;
  /** Sizes the service reports sold out. Every one stays listed, disabled. */
  soldOutVariantIds: ReadonlySet<string>;
}

/** The size picker. A sold-out size stays visible, disabled and labelled. */
export function MarketplaceVariantPicker({
  record,
  selectedVariantId,
  onSelect,
  soldOutVariantIds,
}: MarketplaceVariantPickerProps) {
  return (
    <div data-surface="marketplace-variant-picker">
      <Typography as="p" className="mb-2 text-sm font-semibold">
        Variant
      </Typography>
      <Select value={selectedVariantId} onValueChange={onSelect}>
        <SelectTrigger theme="secondary" className="w-full" aria-label="Choose listing variant">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {record.variants.map((variant) => {
            const soldOut = isVariantSoldOut(variant, soldOutVariantIds);
            const stock = formatStockQuantity(record, variant.quantity);
            return (
              <SelectItem key={variant.id} value={variant.id} disabled={!variant.enabled || soldOut}>
                {Object.values(variant.options).join(' · ') || variant.sku || 'Default'} ·{' '}
                {soldOut ? VARIANT_SOLD_OUT_LABEL : stock === UNLIMITED_STOCK_LABEL ? stock : `${stock} left`}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
