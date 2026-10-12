import { Typography } from '@/atoms/Typography/Typography';
import type { MarketplaceSellerDeliveryTermsEntry } from '@/hooks/useMarketplaceSellerDeliveryTerms/useMarketplaceSellerDeliveryTerms';
import { sellerDeliveryTermsCopy, sellerDeliveryTermsEqual } from '@/libs/commerce/seller-delivery-terms';

export interface MarketplaceDeliveryTermsProps {
  entries: readonly MarketplaceSellerDeliveryTermsEntry[];
  className?: string;
}

/**
 * States the periods each seller sets for assumed delivery and automatic
 * completion. One sentence when every seller shown agrees; otherwise one line
 * per seller, named by shop (or a short pubky when the seller has no shop).
 */
export function MarketplaceDeliveryTerms({
  entries,
  className = 'text-xs text-muted-foreground',
}: MarketplaceDeliveryTermsProps) {
  const [first] = entries;
  if (!first) return null;

  if (entries.every((entry) => sellerDeliveryTermsEqual(entry.terms, first.terms))) {
    return (
      <Typography as="p" className={className} data-testid="marketplace-delivery-terms">
        {sellerDeliveryTermsCopy(first.terms)}
      </Typography>
    );
  }

  return (
    <div className="grid gap-1" data-testid="marketplace-delivery-terms">
      {entries.map((entry) => (
        <Typography key={entry.sellerPubky} as="p" className={className}>
          {entry.shopName ?? `${entry.sellerPubky.slice(0, 10)}…`}: {sellerDeliveryTermsCopy(entry.terms)}
        </Typography>
      ))}
    </div>
  );
}
