'use client';

import { getStoreSeller } from '@/config/store-mode';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useLocalFirstQuery } from '@/hooks/useLocalFirstQuery/useLocalFirstQuery';

/**
 * The store seller's shop, read local first and refreshed from their homeserver. `null` or
 * `undefined` outside a store, before the record is read, or for a seller without one.
 */
export function useStoreShop() {
  const storeSeller = getStoreSeller();
  const { data } = useLocalFirstQuery({
    queryFn: () => CommerceController.getShop(storeSeller),
    fetchFn: () => CommerceController.refreshShop(storeSeller),
    deps: [storeSeller],
    enabled: storeSeller !== null,
  });
  return data;
}
