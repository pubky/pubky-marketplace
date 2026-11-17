'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useSellerReputation } from '@/hooks/useMarketplaceReviews/useMarketplaceReviews';

export interface MarketplaceSellerSummary {
  displayName: string;
}

export function useMarketplaceSellerSummary(
  sellerPubky: string,
  options?: { includeReputation?: boolean },
): MarketplaceSellerSummary {
  const includeReputation = options?.includeReputation !== false;
  const shop = useLiveQuery(() => CommerceController.getShop(sellerPubky), [sellerPubky]);
  useSellerReputation(sellerPubky, { enabled: includeReputation });

  return {
    displayName: shop?.record.name ?? `${sellerPubky.slice(0, 10)}…`,
  };
}
