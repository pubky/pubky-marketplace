'use client';

import { Fragment, type ReactNode } from 'react';
import { Typography } from '@/atoms/Typography/Typography';
import { useMarketplaceSellerSummary } from '@/hooks/useMarketplaceSellerSummary/useMarketplaceSellerSummary';
import type { UsdtMissingOptionExplanation } from '@/libs/commerce/usdt-missing-option';

function SellerName({ sellerPubky }: { sellerPubky: string }) {
  const { displayName } = useMarketplaceSellerSummary(sellerPubky, { includeReputation: false });
  return <>{displayName}</>;
}

/** "A", "A and B", "A, B and C". */
function joinList(parts: ReactNode[]): ReactNode {
  return parts.map((part, index) => (
    <Fragment key={index}>
      {index === 0 ? '' : index === parts.length - 1 ? ' and ' : ', '}
      {part}
    </Fragment>
  ));
}

/**
 * Why the Paykit entry does not say USDT when the buyer could expect it (UX
 * audit P5): a seller in the cart does not take USDT. It only explains; the
 * picker itself is unchanged.
 */
export function MarketplaceUsdtMissingNote({ explanation }: { explanation: UsdtMissingOptionExplanation }) {
  const { sellersWithoutUsdt } = explanation;
  return (
    <Typography as="p" className="text-xs text-muted-foreground" data-testid="marketplace-checkout-usdt-missing-note">
      USDT isn&apos;t available for this cart:{' '}
      {joinList(sellersWithoutUsdt.map((sellerPubky) => <SellerName key={sellerPubky} sellerPubky={sellerPubky} />))}{' '}
      {sellersWithoutUsdt.length === 1 ? "doesn't" : "don't"} accept USDT.
    </Typography>
  );
}
