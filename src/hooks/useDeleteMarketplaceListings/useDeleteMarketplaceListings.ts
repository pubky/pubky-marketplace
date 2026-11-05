'use client';

import { useRef, useState } from 'react';
import { getCommerceAdapterMode, isDurableCommerceMode, isTransactionalCommerceMode } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import {
  AUCTION_HAS_BIDS_MESSAGE,
  bidsBlockingDelete,
  isAuctionHasBidsRefusal,
  isLiveAuction,
} from '@/libs/commerce/auction-removal';
import {
  countOpenOrdersForListings,
  deletableTargets,
  listingDeleteFailureMessage,
  listingDeleteKey,
  listingDeleteSuccessToast,
} from '@/libs/commerce/listing-delete';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { buildMarketplaceListingAggregateId } from '@/libs/commerce/transaction-commands';
import { Logger } from '@/libs/logger/logger';
import { toast } from '@/molecules/Toaster/use-toast';
import { useAuthStore } from '@/stores/auth/auth.store';

export interface ListingDeleteTarget {
  ownerPubky: string;
  listingId: string;
  title: string;
  record: Pick<CommerceListingRecord, 'state' | 'sale'>;
}

export interface ListingDeletePlan {
  targets: ListingDeleteTarget[];
  /** Targets a live auction's bids keep from being deleted yet, with the service's bid count. */
  blocked: Array<{ target: ListingDeleteTarget; bids: number }>;
  openOrders: number;
  /** False when the seller's orders could not be read, so the open-order count is unknown. */
  ordersChecked: boolean;
}

export interface UseDeleteMarketplaceListingsOptions {
  /** Called with the `owner:listingId` key of every listing that was deleted. */
  onDeleted?: (deletedKeys: string[]) => void;
}

export interface UseDeleteMarketplaceListingsResult {
  open: boolean;
  /** The plan, once the checks that precede the confirmation have finished. */
  plan: ListingDeletePlan | null;
  isDeleting: boolean;
  hasHomeserverSession: boolean;
  request: (targets: ListingDeleteTarget[]) => Promise<void>;
  confirm: () => Promise<void>;
  cancel: () => void;
}

/**
 * The one delete flow every seller surface shares: the listing page, the Studio table (single and bulk) and
 * the edit page all request through this hook and render `MarketplaceListingDeleteDialog` from its result.
 *
 * Before the confirmation it reads what deleting would strand: the service's bid count on live auctions (which
 * are refused, as `commitDeleteListing` refuses them) and the seller's open orders on each listing (warned,
 * not refused: the service lets paid orders settle, and only refuses a new payment on a removed listing).
 */
export function useDeleteMarketplaceListings({
  onDeleted,
}: UseDeleteMarketplaceListingsOptions = {}): UseDeleteMarketplaceListingsResult {
  const hasHomeserverSession = useAuthStore((state) => state.session !== null);
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<ListingDeletePlan | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const generation = useRef(0);
  // Set before the first await, so two confirmations in one tick cannot both pass a state-based check.
  const inFlight = useRef(false);

  const request = async (targets: ListingDeleteTarget[]) => {
    if (targets.length === 0 || inFlight.current) return;
    const attempt = ++generation.current;
    setPlan(null);
    setOpen(true);
    const next = await planDelete(targets);
    if (generation.current === attempt) setPlan(next);
  };

  const cancel = () => {
    if (inFlight.current) return;
    generation.current += 1;
    setOpen(false);
    setPlan(null);
  };

  const confirm = async () => {
    if (!plan || inFlight.current || !hasHomeserverSession) return;
    const deletable = deletableTargets(plan);
    if (deletable.length === 0) return;
    inFlight.current = true;
    setIsDeleting(true);
    const deleted: string[] = [];
    let bidRefusals = 0;
    for (const target of deletable) {
      try {
        await CommerceController.commitDeleteListing(target.ownerPubky, target.listingId);
        deleted.push(listingDeleteKey(target.ownerPubky, target.listingId));
      } catch (error) {
        if (isAuctionHasBidsRefusal(error)) bidRefusals += 1;
        Logger.error('Failed to delete a marketplace listing', {
          listing: listingDeleteKey(target.ownerPubky, target.listingId),
          error,
        });
      }
    }
    const failed = deletable.length - deleted.length;
    if (deleted.length > 0) toast(listingDeleteSuccessToast(deleted.length));
    if (failed > 0) {
      toast({
        variant: 'error',
        description:
          bidRefusals === failed && deletable.length === 1
            ? AUCTION_HAS_BIDS_MESSAGE
            : listingDeleteFailureMessage(failed, deletable.length),
      });
    }
    inFlight.current = false;
    setIsDeleting(false);
    setOpen(false);
    setPlan(null);
    if (deleted.length > 0) onDeleted?.(deleted);
  };

  return { open, plan, isDeleting, hasHomeserverSession, request, confirm, cancel };
}

function sameListing(a: ListingDeleteTarget, b: ListingDeleteTarget): boolean {
  return a.ownerPubky === b.ownerPubky && a.listingId === b.listingId;
}

async function planDelete(targets: ListingDeleteTarget[]): Promise<ListingDeletePlan> {
  const blocked: ListingDeletePlan['blocked'] = [];
  if (isDurableCommerceMode(getCommerceAdapterMode())) {
    for (const target of targets) {
      if (!isLiveAuction(target.record, Date.now())) continue;
      try {
        const projection = await CommerceController.getMarketplaceListingProjection(
          target.ownerPubky,
          target.listingId,
        );
        const bids = bidsBlockingDelete(projection?.auction, false);
        if (bids > 0) blocked.push({ target, bids });
      } catch (error) {
        // Unknown bids: the delete itself re-checks and refuses, so the dialog still opens.
        Logger.warn('Could not read an auction before offering to delete it', {
          listing: listingDeleteKey(target.ownerPubky, target.listingId),
          error,
        });
      }
    }
  }
  if (!isTransactionalCommerceMode(getCommerceAdapterMode())) {
    return { targets, blocked, openOrders: 0, ordersChecked: true };
  }
  try {
    const orders = await CommerceController.getMarketplaceOrders();
    const deletableIds = new Set(
      targets
        .filter((target) => !blocked.some(({ target: held }) => sameListing(held, target)))
        .map(({ ownerPubky, listingId }) => buildMarketplaceListingAggregateId(ownerPubky, listingId)),
    );
    const openOrders = countOpenOrdersForListings(orders, targets[0].ownerPubky, deletableIds);
    return { targets, blocked, openOrders, ordersChecked: true };
  } catch (error) {
    Logger.warn('Could not read open orders before offering to delete a listing', { error });
    return { targets, blocked, openOrders: 0, ordersChecked: false };
  }
}
