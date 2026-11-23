/**
 * A store's selling tools belong to the store seller. Any other account signed in to a store sees
 * and runs only its buyer side: its offers and orders as a seller are dropped here, and its
 * background seller work does not run. `storeSeller` is `null` outside store mode, where everyone
 * sells as before.
 */
export function canSellHere(viewerPubky: string, storeSeller: string | null): boolean {
  return storeSeller === null || viewerPubky === storeSeller;
}

/** Service rows that name their seller (orders, offers), without the viewer's sales where it cannot sell. */
export function withoutSalesOutsideStoreSeller<T extends { sellerPubky: string }>(
  rows: T[],
  viewerPubky: string,
  storeSeller: string | null,
): T[] {
  if (canSellHere(viewerPubky, storeSeller)) return rows;
  return rows.filter((row) => row.sellerPubky !== viewerPubky);
}
