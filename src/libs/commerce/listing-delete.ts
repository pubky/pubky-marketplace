/**
 * Order states that no longer need the seller: the goods are with the buyer, or the order ended without
 * a sale. Every other state is an open order that deleting the listing can leave stranded.
 */
const SETTLED_ORDER_STATES: ReadonlySet<string> = new Set([
  'delivered',
  'completed',
  'cancelled',
  'refunded_external',
  'refunded_partial',
  'closed',
]);

export function isOpenOrderState(state: string): boolean {
  return !SETTLED_ORDER_STATES.has(state);
}

interface OrderForDelete {
  id: string;
  sellerPubky: string;
  state: string;
  lines: ReadonlyArray<{ listingAggregateId: string }>;
}

/**
 * How many of the seller's open orders touch any of the given listings. An order counts once, however many of
 * the listings its lines name.
 */
export function countOpenOrdersForListings(
  orders: ReadonlyArray<OrderForDelete>,
  sellerPubky: string,
  listingAggregateIds: ReadonlySet<string>,
): number {
  return orders.filter(
    (order) =>
      order.sellerPubky === sellerPubky &&
      isOpenOrderState(order.state) &&
      order.lines.some((line) => listingAggregateIds.has(line.listingAggregateId)),
  ).length;
}

interface DeleteTargetRef {
  ownerPubky: string;
  listingId: string;
}

/** The targets a confirmation deletes: everything the plan does not hold back. */
export function deletableTargets<T extends DeleteTargetRef>(plan: {
  targets: ReadonlyArray<T>;
  blocked: ReadonlyArray<{ target: DeleteTargetRef }>;
}): T[] {
  return plan.targets.filter(
    (target) =>
      !plan.blocked.some(
        ({ target: held }) => held.ownerPubky === target.ownerPubky && held.listingId === target.listingId,
      ),
  );
}

export function listingDeleteKey(ownerPubky: string, listingId: string): string {
  return `${ownerPubky}:${listingId}`;
}

export const LISTING_DELETE_COPY = {
  singleTitle: 'Delete this listing?',
  singleConfirm: 'Delete listing',
  singleKeep: 'Keep listing',
  singleToast: { title: 'Listing deleted', description: 'It was removed from your homeserver.' },
  singleFailed: 'Could not delete this listing.',
  checking: 'Checking for open orders…',
  ordersUnchecked: "We couldn't check your open orders. Look in Orders before you delete.",
  needsSession: 'Delete is available once your session is restored.',
  pauseHint: 'To stop sales but keep the listing, unlist it instead. You can relist it any time.',
  consequences: [
    'Buyers can no longer open or buy it. It leaves your shop and Pubky Market search as the index catches up.',
    "Orders already placed stay in your Orders. Paid orders still settle and can be fulfilled; a buyer who hasn't paid yet can't start payment.",
    'A drop that includes it releases it.',
  ],
} as const;

export function listingDeleteTitle(count: number): string {
  return count === 1 ? LISTING_DELETE_COPY.singleTitle : `Delete ${count} listings?`;
}

export function listingDeleteConfirmLabel(count: number): string {
  return count === 1 ? LISTING_DELETE_COPY.singleConfirm : `Delete ${count} listings`;
}

export function listingDeleteSummary(count: number): string {
  return count === 1
    ? "This permanently removes the owner-signed record from your homeserver. This can't be undone."
    : `This permanently removes ${count} owner-signed records from your homeserver. This can't be undone.`;
}

export function listingDeleteOpenOrdersNote(openOrders: number, listings: number): string {
  const orders = `${openOrders} open ${openOrders === 1 ? 'order' : 'orders'}`;
  return listings === 1
    ? `This listing has ${orders}. Ship or cancel ${openOrders === 1 ? 'it' : 'them'} first if you can: buyers who haven't paid can't start payment once it is deleted.`
    : `These listings have ${orders} between them. Ship or cancel them first if you can: buyers who haven't paid can't start payment once a listing is deleted.`;
}

export function listingDeleteSuccessToast(count: number) {
  return count === 1
    ? LISTING_DELETE_COPY.singleToast
    : {
        title: `${count} listings deleted`,
        description: 'They were removed from your homeserver.',
      };
}

export function listingDeleteFailureMessage(failed: number, total: number): string {
  if (total === 1) return LISTING_DELETE_COPY.singleFailed;
  return failed === total
    ? `Could not delete these ${total} listings.`
    : `Could not delete ${failed} of ${total} listings. The others were deleted.`;
}
