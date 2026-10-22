'use client';

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BadgeCheck, PenLine, Trash2 } from 'lucide-react';
import { getMarketplaceListingRoute } from '@/app/routes';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/atoms/AlertDialog/AlertDialog';
import { Badge } from '@/atoms/Badge/Badge';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { REVIEW_PENDING_COPY, REVIEW_REMOVAL_COPY } from '@/config/commerce-copy';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useRemoveOwnMarketplaceReview } from '@/hooks/useRemoveOwnMarketplaceReview/useRemoveOwnMarketplaceReview';
import { formatReviewDate } from '@/libs/commerce/order-reviews';
import { cn } from '@/libs/utils/utils';
import type { CommerceReviewModelSchema } from '@/models/commerce/commerce.schema';
import { MarketplaceStarRating } from '@/molecules/MarketplaceStarRating/MarketplaceStarRating';
import { SettingsSectionContent } from '@/molecules/Settings/SettingsSectionContent/SettingsSectionContent';
import type { MarketplaceOrder } from '@/services/marketplace/marketplace';
import { useAuthStore } from '@/stores/auth/auth.store';

/**
 * The "my reviews" panel on the orders page: the local-first rows of every
 * review this user has published (or staged), newest first, one card per
 * order: an order reviewed item by item lists each item's record in its card
 * and is removed as a whole. Each record states its own truth — the stars and text from the record, whether the embedded
 * purchase attestation verified at publication time, and whether the
 * homeserver publication actually landed (`pending` rows retry when this
 * surface loads).
 *
 * When the orders are known the rows are re-read from the reviewer's
 * homeserver once, so an edit made on another device shows here. Each row
 * order can be removed: a confirmation, then its records are deleted from the
 * homeserver.
 */
export function MarketplaceMyReviews({ orders = [], className }: { orders?: MarketplaceOrder[]; className?: string }) {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const [pendingRemoval, setPendingRemoval] = useState<{ orderId: string; withheld: boolean } | null>(null);
  const [removedOrderIds, setRemovedOrderIds] = useState<ReadonlySet<string>>(new Set());
  const { removingOrderId, remove } = useRemoveOwnMarketplaceReview();

  // Orders carrying the user's own review at the service: the ones whose
  // homeserver record is re-read. Keyed by id so the poll's new order
  // objects do not re-read.
  const reviewedOrderKey = orders
    .filter((order) => order.reviews?.some(({ reviewerPubky }) => reviewerPubky === currentUserPubky))
    .map((order) => order.id)
    .sort()
    .join(',');

  // Live over the local rows: a record written by another surface (the order
  // card restoring a review the homeserver lost, a publication landing) or by
  // the refresh below shows here without a reload. `undefined` until the first
  // read lands.
  const local = useLiveQuery(async () => {
    if (currentUserPubky === null) return null;
    try {
      const [rows, withheld] = await Promise.all([
        CommerceController.getOwnMarketplaceReviews(),
        CommerceController.getAwaitingReleaseOwnMarketplaceReviews(),
      ]);
      return { rows, withheld };
    } catch {
      return { rows: [], withheld: [] };
    }
  }, [currentUserPubky]);

  useEffect(() => {
    if (currentUserPubky === null || reviewedOrderKey === '') return;
    void CommerceController.refreshOwnMarketplaceReviews(orders).catch(() => {
      // The local rows stay as they are; the next open re-reads.
    });
    // `orders` feeds the refresh, but only a change in which orders carry a
    // review of the user's may re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by reviewedOrderKey
  }, [currentUserPubky, reviewedOrderKey]);

  const confirmRemoval = async () => {
    const target = pendingRemoval;
    setPendingRemoval(null);
    if (target === null) return;
    if (await remove(target.orderId, { withheld: target.withheld })) {
      setRemovedOrderIds((current) => new Set(current).add(target.orderId));
    }
  };

  const reviews = (local?.rows ?? []).filter((row) => !removedOrderIds.has(row.order_id));
  const awaiting = (local?.withheld ?? []).filter((held) => !removedOrderIds.has(held.orderId));
  if (currentUserPubky === null || local == null || (reviews.length === 0 && awaiting.length === 0)) return null;
  const orderGroups = groupByOrder(reviews);

  return (
    <Card
      className={cn(cn('py-5', className), 'rounded-md p-0')}
      data-testid="marketplace-my-reviews"
      data-surface="marketplace-my-reviews"
    >
      <CardContent className="grid gap-6 p-6">
        <Typography as="h2" className="flex items-center gap-2 text-sm font-semibold">
          <PenLine className="size-4" />
          My reviews
        </Typography>
        <SettingsSectionContent>
          <ul className="flex flex-col gap-3">
            {awaiting.map((held) => (
              <li
                key={held.orderId}
                className="flex flex-col gap-1.5 rounded-md p-3"
                data-cy="marketplace-my-review-item"
                data-review-state="awaiting-release"
              >
                {held.items.map((item) => (
                  <div
                    key={item.listingId}
                    className="flex flex-col gap-1.5 not-first:mt-1.5 not-first:border-t not-first:pt-3"
                    data-cy="marketplace-my-review-record"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <MarketplaceStarRating rating={item.rating} size="sm" />
                      <Link
                        href={getMarketplaceListingRoute(item.listingOwnerPubky, item.listingId)}
                        overrideDefaults
                        className="text-xs font-medium text-foreground hover:underline"
                      >
                        View listing
                      </Link>
                      <Typography as="span" overrideDefaults className="text-xs text-muted-foreground">
                        {formatReviewDate(item.updatedAt)}
                      </Typography>
                      <Badge variant="outline" className="text-amber-400">
                        {REVIEW_PENDING_COPY.badge}
                      </Badge>
                    </div>
                    <Typography
                      as="p"
                      overrideDefaults
                      className="line-clamp-3 text-sm whitespace-pre-wrap text-foreground"
                    >
                      {item.text}
                    </Typography>
                  </div>
                ))}
                <Typography
                  as="p"
                  overrideDefaults
                  className="text-xs text-muted-foreground"
                  data-cy="marketplace-my-review-pending-note"
                >
                  {REVIEW_PENDING_COPY.publishesWhen(
                    held.reviewerRole,
                    held.releaseAt === null ? null : formatReviewDate(held.releaseAt),
                  )}
                </Typography>
                <div>
                  <Button
                    variant="destructive-soft"
                    size="sm"
                    disabled={removingOrderId !== null}
                    onClick={() => setPendingRemoval({ orderId: held.orderId, withheld: true })}
                    data-cy="marketplace-my-review-remove"
                  >
                    <Trash2 />
                    {REVIEW_REMOVAL_COPY.action}
                  </Button>
                </div>
              </li>
            ))}
            {orderGroups.map((group) => (
              <li
                key={group[0].order_id}
                className="flex flex-col gap-1.5 rounded-md p-3"
                data-cy="marketplace-my-review-item"
              >
                {group.map((review) => (
                  <div
                    key={review.id}
                    className="flex flex-col gap-1.5 not-first:mt-1.5 not-first:border-t not-first:pt-3"
                    data-cy="marketplace-my-review-record"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <MarketplaceStarRating rating={review.record.ratings.overall} size="sm" />
                      <Link
                        href={getMarketplaceListingRoute(review.record.listingOwnerPubky, review.record.listingId)}
                        overrideDefaults
                        className="text-xs font-medium text-foreground hover:underline"
                      >
                        View listing
                      </Link>
                      <Typography as="span" overrideDefaults className="text-xs text-muted-foreground">
                        {formatReviewDate(review.record.updatedAt)}
                      </Typography>
                      {review.attestation_verified ? (
                        <Badge variant="secondary" className="gap-1 text-emerald-400">
                          <BadgeCheck className="size-3" />
                          Attested
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Unattested
                        </Badge>
                      )}
                      {review.sync_status !== 'synced' && (
                        <Badge
                          variant="outline"
                          className="text-amber-400"
                          title="Publication is pending. Reopening this page will retry."
                        >
                          Publication pending
                        </Badge>
                      )}
                    </div>
                    <Typography
                      as="p"
                      overrideDefaults
                      className="line-clamp-3 text-sm whitespace-pre-wrap text-foreground"
                    >
                      {review.record.text}
                    </Typography>
                  </div>
                ))}
                <div>
                  <Button
                    variant="destructive-soft"
                    size="sm"
                    disabled={removingOrderId !== null}
                    onClick={() => setPendingRemoval({ orderId: group[0].order_id, withheld: false })}
                    data-cy="marketplace-my-review-remove"
                  >
                    <Trash2 />
                    {REVIEW_REMOVAL_COPY.action}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </SettingsSectionContent>
        <AlertDialog open={pendingRemoval !== null} onOpenChange={(open) => !open && setPendingRemoval(null)}>
          <AlertDialogContent
            data-testid="marketplace-my-review-remove-dialog"
            data-surface="marketplace-my-review-remove-dialog"
          >
            <AlertDialogHeader>
              <AlertDialogTitle>{REVIEW_REMOVAL_COPY.dialogTitle}</AlertDialogTitle>
              <AlertDialogDescription>
                {pendingRemoval?.withheld === true
                  ? REVIEW_REMOVAL_COPY.dialogDescriptionWithheld
                  : REVIEW_REMOVAL_COPY.dialogDescription}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{REVIEW_REMOVAL_COPY.cancel}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void confirmRemoval()}>
                {REVIEW_REMOVAL_COPY.confirm}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

/** The rows of one order together, orders and rows in the order they came (newest first). */
function groupByOrder(rows: CommerceReviewModelSchema[]): CommerceReviewModelSchema[][] {
  const groups = new Map<string, CommerceReviewModelSchema[]>();
  for (const row of rows) groups.set(row.order_id, [...(groups.get(row.order_id) ?? []), row]);
  return [...groups.values()];
}
