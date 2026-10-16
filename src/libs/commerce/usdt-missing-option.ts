export interface UsdtMissingOptionExplanation {
  /** Sellers in the cart who do not take USDT, in cart order. */
  sellersWithoutUsdt: string[];
}

/**
 * Why the Paykit entry does not offer USDT when the buyer has reason to expect
 * it (UX audit P5). A buyer has that reason only when the Shop's USDT gate is
 * open and at least one seller in the cart takes USDT; the entry offers an
 * asset only when every seller in the cart does, so the explanation names the
 * sellers who don't. Null when USDT is offered, the seller configs are not
 * loaded, or every seller takes it.
 */
export function usdtMissingOptionExplanation({
  gateOpen,
  offered,
  sellerAcceptsUsdt,
}: {
  gateOpen: boolean;
  offered: boolean;
  /** Whether each seller in the cart takes USDT; null while the configs load or when a read failed. */
  sellerAcceptsUsdt: ReadonlyMap<string, boolean> | null;
}): UsdtMissingOptionExplanation | null {
  if (!gateOpen || offered || sellerAcceptsUsdt === null) return null;
  const sellers = [...sellerAcceptsUsdt.keys()];
  if (!sellers.some((seller) => sellerAcceptsUsdt.get(seller) === true)) return null;

  const sellersWithoutUsdt = sellers.filter((seller) => sellerAcceptsUsdt.get(seller) !== true);
  if (sellersWithoutUsdt.length === 0) return null;
  return { sellersWithoutUsdt };
}
