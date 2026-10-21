'use client';

import { useEffect, useState } from 'react';
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
import { REVIEW_REMOVAL_COPY } from '@/config/commerce-copy';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useRemoveOwnMarketplaceReview } from '@/hooks/useRemoveOwnMarketplaceReview/useRemoveOwnMarketplaceReview';
import { cn } from '@/libs/utils/utils';
import type { CommerceReviewModelSchema } from '@/models/commerce/commerce.schema';
import { MarketplaceStarRating } from '@/molecules/MarketplaceStarRating/MarketplaceStarRating';
import { SettingsSectionContent } from '@/molecules/Settings/SettingsSectionContent/SettingsSectionContent';
import type { MarketplaceOrder } from '@/services/marketplace/marketplace';
import { useAuthStore } from '@/stores/auth/auth.store';

/**
 * The "my reviews" panel on the orders page: the local-first rows of every
 * review this user has published (or staged), newest first. Each row states
 * its own truth — the stars and text from the record, whether the embedded
 * purchase attestation verified at publication time, and whether the
 * homeserver publication actually landed (`pending` rows retry when this
 * surface loads).
 *
 * When the orders are known the rows are re-read from the reviewer's
 * homeserver once, so an edit made on another device shows here. Each row
 * can be removed: a confirmation, then the record is deleted from the
 * homeserver.
 */
export function MarketplaceMyReviews({ orders = [], className }: { orders?: MarketplaceOrder[]; className?: string }) {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const [reviews, setReviews] = useState<CommerceReviewModelSchema[] | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<CommerceReviewModelSchema | null>(null);
  const { removingOrderId, remove } = useRemoveOwnMarketplaceReview();

  // Orders carrying the user's own review at the service: the ones whose
  // homeserver record is re-read. Keyed by id so the poll's new order
  // objects do not re-read.
  const reviewedOrderKey = orders
    .filter((order) => order.reviews?.some(({ reviewerPubky }) => reviewerPubky === currentUserPubky))
    .map((order) => order.id)
    .sort()
    .join(',');

  useEffect(() => {
    if (currentUserPubky === null) return;
    let active = true;
    const readLocal = () =>
      CommerceController.getOwnMarketplaceReviews()
        .then((rows) => {
          if (active) setReviews(rows);
        })
        .catch(() => {
          if (active) setReviews((current) => current ?? []);
        });
    void readLocal().then(async () => {
      if (reviewedOrderKey === '') return;
      try {
        const changed = await CommerceController.refreshOwnMarketplaceReviews(orders);
        if (active && changed > 0) await readLocal();
      } catch {
        // The local rows stay as they are; the next open re-reads.
      }
    });
    return () => {
      active = false;
    };
    // `orders` feeds the refresh, but only a change in which orders carry a
    // review of the user's may re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by reviewedOrderKey
  }, [currentUserPubky, reviewedOrderKey]);

  const confirmRemoval = async () => {
    const target = pendingRemoval;
    setPendingRemoval(null);
    if (target === null) return;
    if (await remove(target.order_id)) {
      setReviews((current) => current?.filter((row) => row.id !== target.id) ?? current);
    }
  };

  if (currentUserPubky === null || reviews === null || reviews.length === 0) return null;

  return (
    <Card className={cn(cn('py-5', className), 'rounded-md p-0')} data-testid="marketplace-my-reviews">
      <CardContent className="grid gap-6 p-6">
        <Typography as="h2" className="flex items-center gap-2 text-sm font-semibold">
          <PenLine className="size-4" />
          My reviews
        </Typography>
        <SettingsSectionContent>
          <ul className="flex flex-col gap-3">
            {reviews.map((review) => (
              <li key={review.id} className="flex flex-col gap-1.5 rounded-md p-3" data-cy="marketplace-my-review-item">
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
                    {formatDate(review.record.updatedAt)}
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
                <div>
                  <Button
                    variant="destructive-soft"
                    size="sm"
                    disabled={removingOrderId !== null}
                    onClick={() => setPendingRemoval(review)}
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
          <AlertDialogContent data-testid="marketplace-my-review-remove-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>{REVIEW_REMOVAL_COPY.dialogTitle}</AlertDialogTitle>
              <AlertDialogDescription>{REVIEW_REMOVAL_COPY.dialogDescription}</AlertDialogDescription>
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

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(iso),
  );
}
