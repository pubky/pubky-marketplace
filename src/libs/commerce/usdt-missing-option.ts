export interface UsdtMissingOptionItem {
  title: string;
  sellerPubky: string;
  /** The currency the line is priced in, or null when it has no fixed price. */
  currency: string | null;
}

export interface UsdtMissingOptionExplanation {
  /** Distinct titles of the lines priced in bitcoin. */
  bitcoinPricedTitles: string[];
  /** Sellers in the cart who do not take USDT, in cart order. */
  sellersWithoutUsdt: string[];
}

/**
 * Why USDT is missing from a checkout's payment picker, when the buyer has
 * reason to expect it (UX audit P5). A buyer has that reason only when the
 * Shop's USDT gate is open and at least one seller in the cart takes USDT;
 * otherwise nothing is missing that anyone offered.
 *
 * The two reasons are the two the picker enforces: USDT is quoted at parity
 * against a USD total, so a line priced in bitcoin rules it out, and a
 * multi-seller cart only offers a method every seller offers. Null when
 * USDT is offered, was just refused by the service (that has its own copy),
 * the seller configs are not loaded, or neither reason applies.
 */
export function usdtMissingOptionExplanation({
  gateOpen,
  offered,
  refused,
  sellerAcceptsUsdt,
  items,
}: {
  gateOpen: boolean;
  offered: boolean;
  refused: boolean;
  /** Whether each seller in the cart takes USDT; null while the configs load or when a read failed. */
  sellerAcceptsUsdt: ReadonlyMap<string, boolean> | null;
  items: readonly UsdtMissingOptionItem[];
}): UsdtMissingOptionExplanation | null {
  if (!gateOpen || offered || refused || sellerAcceptsUsdt === null) return null;
  const sellers = [...sellerAcceptsUsdt.keys()];
  if (!sellers.some((seller) => sellerAcceptsUsdt.get(seller) === true)) return null;

  const bitcoinPricedTitles = [...new Set(items.filter((item) => item.currency === 'BTC').map(({ title }) => title))];
  const sellersWithoutUsdt = sellers.filter((seller) => sellerAcceptsUsdt.get(seller) !== true);
  if (bitcoinPricedTitles.length === 0 && sellersWithoutUsdt.length === 0) return null;
  return { bitcoinPricedTitles, sellersWithoutUsdt };
}
