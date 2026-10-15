'use client';

import { formatCommerceMoney } from '@/libs/commerce/format';
import type { CommerceMoney } from '@/libs/commerce/transaction-contracts';
import { MarketplaceIndicativePrice } from '@/organisms/Marketplace/MarketplaceIndicativePrice';

/**
 * A listing price on a card: always in the listing's own currency, with the
 * buyer's optional converted hint beside it.
 */
export function MarketplaceCardPrice({ money }: { money: CommerceMoney }) {
  return (
    <span>
      {formatCommerceMoney(money)} <MarketplaceIndicativePrice money={money} className="font-normal" />
    </span>
  );
}
