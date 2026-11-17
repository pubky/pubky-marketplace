'use client';

import { getMarketplaceListingRoute } from '@/app/routes';
import { Link } from '@/atoms/Link/Link';
import { useMarketplaceOrderItemMedia } from '@/hooks/useMarketplaceOrderItemMedia/useMarketplaceOrderItemMedia';
import { formatCommerceMoney } from '@/libs/commerce/format';
import { parseListingAggregateId } from '@/libs/commerce/listing-aggregate';
import { MarketplaceProductSummary } from '@/molecules/Marketplace/MarketplaceProductSummary';
import { MarketplaceIndicativePrice } from '@/organisms/Marketplace/MarketplaceIndicativePrice';
import type { MarketplaceOrder } from '@/services/marketplace/marketplace';

export function MarketplaceCheckoutItem({
  line,
  showEstimate = false,
  orderHref,
}: {
  line: MarketplaceOrder['lines'][number];
  showEstimate?: boolean;
  /** Once the order exists, the item opens it; a small link keeps the listing reachable (#363). */
  orderHref?: string;
}) {
  const coverUrl = useMarketplaceOrderItemMedia(line.listingAggregateId);
  const listing = parseListingAggregateId(line.listingAggregateId);
  const variantDetails = line.variantOptions?.map(({ name, value }) => `${name}: ${value}`);
  const listingHref = listing ? getMarketplaceListingRoute(listing.sellerPubky, listing.listingId) : undefined;

  return (
    <MarketplaceProductSummary
      inset
      title={line.title}
      href={orderHref ?? listingHref}
      linkLabel={orderHref ? 'View order' : undefined}
      details={
        orderHref && listingHref ? (
          <Link href={listingHref} overrideDefaults className="underline-offset-4 hover:text-brand hover:underline">
            View listing
          </Link>
        ) : undefined
      }
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
