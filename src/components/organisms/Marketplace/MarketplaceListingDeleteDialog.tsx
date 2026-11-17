'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/atoms/Dialog/Dialog';
import { Typography } from '@/atoms/Typography/Typography';
import type { UseDeleteMarketplaceListingsResult } from '@/hooks/useDeleteMarketplaceListings/useDeleteMarketplaceListings';
import { auctionDeleteBlockedNote } from '@/libs/commerce/auction-removal';
import {
  deletableTargets,
  LISTING_DELETE_COPY,
  listingDeleteConfirmLabel,
  listingDeleteOpenOrdersNote,
  listingDeleteSummary,
  listingDeleteTitle,
} from '@/libs/commerce/listing-delete';

const MAX_LISTED_TITLES = 5;

export interface MarketplaceListingDeleteDialogProps {
  controller: UseDeleteMarketplaceListingsResult;
}

/** The confirmation every seller surface opens before a listing is deleted. Driven by `useDeleteMarketplaceListings`. */
export function MarketplaceListingDeleteDialog({ controller }: MarketplaceListingDeleteDialogProps) {
  const { open, plan, isDeleting, hasHomeserverSession, confirm, cancel } = controller;
  const deletable = plan ? deletableTargets(plan) : [];
  const shownCount = deletable.length > 0 ? deletable.length : (plan?.targets.length ?? 1);
  const everyTargetIsAuction = deletable.every(({ record }) => record.sale.format === 'auction');
  const canConfirm = plan !== null && deletable.length > 0 && hasHomeserverSession && !isDeleting;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && cancel()}>
      <DialogContent className="border-border bg-popover" data-surface="listing-delete-dialog">
        <DialogHeader>
          <DialogTitle>{listingDeleteTitle(shownCount)}</DialogTitle>
          <DialogDescription>{listingDeleteSummary(shownCount)}</DialogDescription>
        </DialogHeader>

        {plan === null ? (
          <Typography as="p" className="text-sm text-muted-foreground" data-testid="listing-delete-checking">
            {LISTING_DELETE_COPY.checking}
          </Typography>
        ) : (
          <div className="flex flex-col gap-4">
            {shownCount > 1 && (
              <ul className="list-disc pl-5 text-sm" data-testid="listing-delete-titles">
                {deletable.slice(0, MAX_LISTED_TITLES).map(({ ownerPubky, listingId, title }) => (
                  <li key={`${ownerPubky}:${listingId}`} className="truncate">
                    {title}
                  </li>
                ))}
                {deletable.length > MAX_LISTED_TITLES && <li>and {deletable.length - MAX_LISTED_TITLES} more</li>}
              </ul>
            )}

            {plan.blocked.length > 0 && (
              <div
                className="rounded-md border border-border bg-muted/40 p-3 text-sm"
                data-testid="listing-delete-blocked"
              >
                {plan.blocked.map(({ target, bids }) => (
                  <Typography as="p" key={`${target.ownerPubky}:${target.listingId}`} className="text-sm">
                    {plan.targets.length > 1 ? `${target.title}: ` : ''}
                    {auctionDeleteBlockedNote(bids)}
                    {plan.targets.length > 1 ? ' It will be skipped.' : ''}
                  </Typography>
                ))}
              </div>
            )}

            {deletable.length > 0 && (
              <>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {LISTING_DELETE_COPY.consequences.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {!everyTargetIsAuction && (
                  <Typography as="p" className="text-sm text-muted-foreground" data-testid="listing-delete-unlist-hint">
                    {LISTING_DELETE_COPY.pauseHint}
                  </Typography>
                )}
              </>
            )}

            {deletable.length > 0 && plan.ordersChecked && plan.openOrders > 0 && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-warning-foreground"
                data-testid="listing-delete-open-orders"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{listingDeleteOpenOrdersNote(plan.openOrders, deletable.length)}</span>
              </div>
            )}
            {deletable.length > 0 && !plan.ordersChecked && (
              <Typography
                as="p"
                className="text-sm text-muted-foreground"
                data-testid="listing-delete-orders-unchecked"
              >
                {LISTING_DELETE_COPY.ordersUnchecked}
              </Typography>
            )}
            {!hasHomeserverSession && (
              <Typography as="p" className="text-xs text-muted-foreground" data-testid="listing-delete-needs-session">
                {LISTING_DELETE_COPY.needsSession}
              </Typography>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" className="rounded-full" disabled={isDeleting} onClick={cancel}>
            {shownCount === 1 ? LISTING_DELETE_COPY.singleKeep : 'Keep listings'}
          </Button>
          <Button variant="destructive" className="rounded-full" disabled={!canConfirm} onClick={() => void confirm()}>
            {isDeleting ? 'Deleting…' : listingDeleteConfirmLabel(shownCount)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
