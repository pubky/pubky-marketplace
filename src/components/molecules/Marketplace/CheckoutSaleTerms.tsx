'use client';

import { Typography } from '@/atoms/Typography/Typography';
import { useMarketplaceSellerSummary } from '@/hooks/useMarketplaceSellerSummary/useMarketplaceSellerSummary';
import type { SellerDeclaration } from '@/libs/commerce/eu-region';
import type { CommerceListingPreorder } from '@/libs/commerce/marketplace-records';
import { PREORDER_COPY } from '@/libs/commerce/preorder';
import { PrivateSellerNotice, RoleStatement } from './SellerSaleTerms';

function NamedPrivateSellerNotice({ sellerPubky }: { sellerPubky: string }) {
  const seller = useMarketplaceSellerSummary(sellerPubky, { includeReputation: false });
  return <PrivateSellerNotice sellerName={seller.displayName} />;
}

/**
 * The consumer-law lines for a checkout (legal launch plan C5), kept in view next to Pay: the private-seller notice for each
 * seller in the cart who declared they sell privately, named when the cart has more than one seller
 * so the buyer can tell whose purchase it covers, and the role statement once. A preorder in the cart
 * adds when it ships and when the buyer can cancel for a refund, named when the cart holds more than one item.
 */
export function CheckoutSaleTerms({
  sellerPubkys,
  declarations,
  preorders = [],
}: {
  sellerPubkys: readonly string[];
  declarations: Readonly<Record<string, SellerDeclaration>>;
  preorders?: readonly { title: string; preorder: CommerceListingPreorder }[];
}) {
  const privateSellers = sellerPubkys.filter((pubky) => declarations[pubky] === 'private');
  const named = sellerPubkys.length > 1;
  return (
    <div className="grid gap-1" data-testid="seller-sale-terms">
      {privateSellers.map((pubky) =>
        named ? <NamedPrivateSellerNotice key={pubky} sellerPubky={pubky} /> : <PrivateSellerNotice key={pubky} />,
      )}
      {preorders.map(({ title, preorder }) => (
        <Typography
          key={title}
          as="p"
          size="xs"
          className="text-muted-foreground"
          data-testid="checkout-preorder-terms"
        >
          {preorders.length > 1 ? `${title}: ` : ''}
          {PREORDER_COPY.checkoutTerms(preorder)}
        </Typography>
      ))}
      <RoleStatement />
    </div>
  );
}
