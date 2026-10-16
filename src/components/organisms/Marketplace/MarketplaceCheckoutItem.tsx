'use client';

import { getMarketplaceListingRoute } from '@/app/routes';
import { useMarketplaceOrderItemMedia } from '@/hooks/useMarketplaceOrderItemMedia/useMarketplaceOrderItemMedia';
import { formatCommerceMoney } from '@/libs/commerce/format';
import { parseListingAggregateId } from '@/libs/commerce/listing-aggregate';
import { MarketplaceProductSummary } from '@/molecules/Marketplace/MarketplaceProductSummary';
import { MarketplaceIndicativePrice } from '@/organisms/Marketplace/MarketplaceIndicativePrice';
import type { MarketplaceOrder } from '@/services/marketplace/marketplace';

export function MarketplaceCheckoutItem({
  line,
  showEstimate = false,
}: {
  line: MarketplaceOrder['lines'][number];
  showEstimate?: boolean;
}) {
  const coverUrl = useMarketplaceOrderItemMedia(line.listingAggregateId);
  const listing = parseListingAggregateId(line.listingAggregateId);
  const variantDetails = line.variantOptions?.map(({ name, value }) => `${name}: ${value}`);

  return (
    <MarketplaceProductSummary
      inset
      title={line.title}
      href={listing ? getMarketplaceListingRoute(listing.sellerPubky, listing.listingId) : undefined}
      imageUrl={coverUrl}
      titleDetails={variantDetails}
      quantity={line.quantity}
      price={
        <>
          {formatCommerceMoney(line.subtotal)}
          {showEstimate && <MarketplaceIndicativePrice money={line.subtotal} className="font-normal" />}
        </>
      }
    />
  );
}
