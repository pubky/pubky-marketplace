'use client';

import type { SellerDeclaration } from '@/libs/commerce/eu-region';
import { useMarketplaceSellerSummary } from '@/hooks/useMarketplaceSellerSummary/useMarketplaceSellerSummary';
import { PrivateSellerNotice, RoleStatement } from './SellerSaleTerms';

function NamedPrivateSellerNotice({ sellerPubky }: { sellerPubky: string }) {
  const seller = useMarketplaceSellerSummary(sellerPubky, { includeReputation: false });
  return <PrivateSellerNotice sellerName={seller.displayName} />;
}

/**
 * The consumer-law lines for a checkout (legal launch plan C5): the private-seller notice for each
 * seller in the cart who declared they sell privately, named when the cart has more than one seller
 * so the buyer can tell whose purchase it covers, and the role statement once.
 */
export function CheckoutSaleTerms({
  sellerPubkys,
  declarations,
}: {
  sellerPubkys: readonly string[];
  declarations: Readonly<Record<string, SellerDeclaration>>;
}) {
  const privateSellers = sellerPubkys.filter((pubky) => declarations[pubky] === 'private');
  const named = sellerPubkys.length > 1;
  return (
    <div className="grid gap-1" data-testid="seller-sale-terms">
      {privateSellers.map((pubky) =>
        named ? <NamedPrivateSellerNotice key={pubky} sellerPubky={pubky} /> : <PrivateSellerNotice key={pubky} />,
      )}
      <RoleStatement />
    </div>
  );
}
