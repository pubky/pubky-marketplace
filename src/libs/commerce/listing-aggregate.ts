/** `listing:<seller>_<id>` / `listing:<seller>:<id>` aggregate ids used by orders and checkout lines. */
export function parseListingAggregateId(value: string): { sellerPubky: string; listingId: string } | null {
  if (!value.startsWith('listing:')) return null;
  const rest = value.slice('listing:'.length);
  const sellerPubky = rest.slice(0, 52);
  const separator = rest[52];
  const listingId = rest.slice(53);
  if (sellerPubky.length !== 52 || (separator !== '_' && separator !== ':') || !listingId) return null;
  return { sellerPubky, listingId };
}

export function listingIdFromOrder(order: {
  sellerPubky: string;
  lines: readonly { listingAggregateId: string }[];
}): string | null {
  const line = order.lines[0];
  if (!line) return null;
  return parseListingAggregateId(line.listingAggregateId)?.listingId ?? null;
}
