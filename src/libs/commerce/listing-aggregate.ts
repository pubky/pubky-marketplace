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

/** The id after `prefix` in an aggregate id such as `order:<id>` or `offer:<id>`, or `null` without that prefix. */
export function aggregateSuffix(aggregateId: string, prefix: string): string | null {
  return aggregateId.startsWith(prefix) ? aggregateId.slice(prefix.length) : null;
}

/** The seller of a `drop:<seller>_<dropId>` aggregate id; pubkys never contain `_`. */
export function sellerOfDropAggregateId(aggregateId: string): string | null {
  const rest = aggregateSuffix(aggregateId, 'drop:');
  if (rest === null) return null;
  const separator = rest.indexOf('_');
  return separator > 0 ? rest.slice(0, separator) : null;
}
