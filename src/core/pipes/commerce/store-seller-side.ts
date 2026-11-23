/**
 * A store's selling tools belong to the store seller. Any other account signed in to a store sees
 * only its buyer side of the service's orders and offers, so the rows it is the seller of are
 * dropped here, before any page can act on them. `storeSeller` is `null` outside store mode, where
 * every row is kept, as it is for the store seller.
 */
export function withoutSalesOutsideStoreSeller<T extends { sellerPubky: string }>(
  rows: T[],
  viewerPubky: string,
  storeSeller: string | null,
): T[] {
  if (storeSeller === null || viewerPubky === storeSeller) return rows;
  return rows.filter((row) => row.sellerPubky !== viewerPubky);
}
