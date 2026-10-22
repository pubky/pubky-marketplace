import { describe, expect, it } from 'vitest';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import {
  AUCTION_HAS_BIDS_MESSAGE,
  AUCTION_HAS_BIDS_REFUSAL,
  auctionDeleteBlockedNote,
  bidsBlockingDelete,
  isAuctionHasBidsRefusal,
  isLiveAuction,
} from './auction-removal';

const NOW = Date.parse('2026-10-22T12:00:00.000Z');
const auctionSale = (endsAt: string) => ({
  format: 'auction',
  startsAt: '2026-10-20T12:00:00.000Z',
  endsAt,
});

describe('isLiveAuction', () => {
  it('is true for an active auction that has not ended', () => {
    expect(isLiveAuction({ state: 'active', sale: auctionSale('2026-10-23T12:00:00.000Z') }, NOW)).toBe(true);
  });

  it('is false once the auction ended, was paused, or is not an auction', () => {
    expect(isLiveAuction({ state: 'active', sale: auctionSale('2026-10-22T12:00:00.000Z') }, NOW)).toBe(false);
    expect(isLiveAuction({ state: 'paused', sale: auctionSale('2026-10-23T12:00:00.000Z') }, NOW)).toBe(false);
    expect(isLiveAuction({ state: 'active', sale: { format: 'fixed_price' } }, NOW)).toBe(false);
  });
});

describe('bidsBlockingDelete', () => {
  it('counts the bids on an auction that has not ended', () => {
    expect(bidsBlockingDelete({ status: 'active', bidCount: 3 }, false)).toBe(3);
    expect(bidsBlockingDelete({ bidCount: 1 }, false)).toBe(1);
  });

  it('is zero when nobody has bid', () => {
    expect(bidsBlockingDelete({ status: 'active', bidCount: 0 }, false)).toBe(0);
  });

  it('is zero once the auction ended by its time or by the service closing it', () => {
    expect(bidsBlockingDelete({ status: 'active', bidCount: 3 }, true)).toBe(0);
    for (const status of ['sold', 'unsold', 'cancelled', 'ended']) {
      expect(bidsBlockingDelete({ status, bidCount: 3 }, false)).toBe(0);
    }
  });

  it('is zero without a projection', () => {
    expect(bidsBlockingDelete(null, false)).toBe(0);
    expect(bidsBlockingDelete(undefined, false)).toBe(0);
  });
});

describe('the refusal', () => {
  it('names the bids', () => {
    expect(auctionDeleteBlockedNote(1)).toBe("This auction has 1 bid, so it can't be deleted until it ends.");
    expect(auctionDeleteBlockedNote(4)).toBe("This auction has 4 bids, so it can't be deleted until it ends.");
  });

  it('is recognised only on the error that carries it', () => {
    const refusal = Err.client(ClientErrorCode.CONFLICT, AUCTION_HAS_BIDS_MESSAGE, {
      service: ErrorService.Marketplace,
      operation: 'commitDeleteListing',
      context: { refusal: AUCTION_HAS_BIDS_REFUSAL },
    });
    const other = Err.client(ClientErrorCode.CONFLICT, 'Something else.', {
      service: ErrorService.Marketplace,
      operation: 'commitDeleteListing',
    });
    expect(isAuctionHasBidsRefusal(refusal)).toBe(true);
    expect(isAuctionHasBidsRefusal(other)).toBe(false);
    expect(isAuctionHasBidsRefusal(new Error('x'))).toBe(false);
  });
});
