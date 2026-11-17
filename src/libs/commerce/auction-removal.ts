import { isAuctionSaleEnded } from '@/libs/commerce/auction-phase';
import { isAppError } from '@/libs/error/error';

/** Said wherever a seller tries to pause or unlist an auction that has not ended. */
export const AUCTION_UNLIST_BLOCKED_NOTE =
  'Auctions cannot be unlisted: published auction terms stay live until the auction ends.';

export const AUCTION_UNLIST_SKIPPED_TITLE = 'Auctions stay live';

/** The `context.refusal` of the error that stops a delete while an auction that has not ended has bids. */
export const AUCTION_HAS_BIDS_REFUSAL = 'auction_has_bids';
export const AUCTION_HAS_BIDS_MESSAGE = "This auction has bids, so it can't be deleted until it ends.";

export function isAuctionHasBidsRefusal(error: unknown): boolean {
  return isAppError(error) && error.context?.refusal === AUCTION_HAS_BIDS_REFUSAL;
}

/** Said instead of Delete while an auction that has not ended has bids. */
export function auctionDeleteBlockedNote(bidCount: number): string {
  return `This auction has ${bidCount} ${bidCount === 1 ? 'bid' : 'bids'}, so it can't be deleted until it ends.`;
}

type AuctionSale = { format: string; startsAt?: string; endsAt?: string };

/** An auction whose terms bidders may have acted on: still on sale, and not yet over. */
export function isLiveAuction(record: { state: string; sale: AuctionSale }, nowMs: number): boolean {
  return record.sale.format === 'auction' && record.state === 'active' && !isAuctionSaleEnded(record.sale, nowMs);
}

/**
 * How many bids stop an auction from being deleted: those on an auction that has not ended, whether by
 * its end time (`ended`) or by the service's own closing status. Zero when nobody has bid or the auction
 * is over, so its winner, its unsold close and its bid history are settled.
 */
export function bidsBlockingDelete(
  auction: { status?: string; bidCount: number } | null | undefined,
  ended: boolean,
): number {
  if (!auction || ended || isTerminalAuctionStatus(auction.status)) return 0;
  return auction.bidCount;
}

function isTerminalAuctionStatus(status: string | undefined): boolean {
  return status === 'sold' || status === 'unsold' || status === 'cancelled' || status === 'ended';
}
