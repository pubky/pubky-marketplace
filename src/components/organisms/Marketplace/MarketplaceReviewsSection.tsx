'use client';

import { useEffect, useState } from 'react';
import { BadgeCheck, Ellipsis, Flag, MessageSquareReply, Star } from 'lucide-react';
import { getMarketplaceListingRoute, getMarketplaceShopRoute, getProfileRoute, PROFILE_ROUTES } from '@/app/routes';
import { Badge } from '@/atoms/Badge/Badge';
import { Button } from '@/atoms/Button/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/atoms/DropdownMenu/DropdownMenu';
import { Heading } from '@/atoms/Heading/Heading';
import { Link } from '@/atoms/Link/Link';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import { Textarea } from '@/atoms/Textarea/Textarea';
import { Typography } from '@/atoms/Typography/Typography';
import { REVIEW_MODERATION_COPY, REVIEW_OUTCOME_COPY, REVIEW_SORT_COPY } from '@/config/commerce-copy';
import { isSocialLinkOutEnabled } from '@/config/social';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useAttestorKeyWindowsVersion } from '@/hooks/useAttestorKeyWindows/useAttestorKeyWindows';
import { useMarketplaceFirstMediaUrl } from '@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl';
import { useMarketplaceReviews } from '@/hooks/useMarketplaceReviews/useMarketplaceReviews';
import { useRequireAuth } from '@/hooks/useRequireAuth/useRequireAuth';
import { useReviewOutcomes } from '@/hooks/useReviewOutcomes/useReviewOutcomes';
import type { ReviewOutcome } from '@/libs/commerce/attestor-records';
import { VERIFIED_PURCHASE_INFO, VERIFIED_PURCHASE_INFO_LABEL } from '@/libs/commerce/eu-region';
import { indexedReviewTrustedAttestor, isCountedIndexedReview } from '@/libs/commerce/review-counting';
import { reviewOutcomesOf } from '@/libs/commerce/review-outcomes';
import { isMarketplaceReviewSort, MARKETPLACE_REVIEW_SORTS } from '@/libs/commerce/review-sort';
import { cn } from '@/libs/utils/utils';
import type { CommerceIndexedReview, CommerceReviewResponseModelSchema } from '@/models/commerce/commerce.schema';
import { InfoHint } from '@/molecules/InfoHint/InfoHint';
import { MarketplaceProductSummary } from '@/molecules/Marketplace/MarketplaceProductSummary';
import { MarketplaceStarRating } from '@/molecules/MarketplaceStarRating/MarketplaceStarRating';
import { ProfileOnPubkyLink } from '@/molecules/ProfileOnPubkyLink/ProfileOnPubkyLink';
import { toast } from '@/molecules/Toaster/use-toast';
import { DialogReportPost } from '@/organisms/DialogReportPost/DialogReportPost';
import { useAuthStore } from '@/stores/auth/auth.store';
import { MarketplaceReviewsListSkeleton } from './MarketplaceReviewsSection.skeleton';

export interface MarketplaceReviewsSectionProps {
  sellerPubky: string;
  /** When set, the section lists the buyer reviews of one listing; otherwise the seller's. */
  listingId?: string;
  className?: string;
  infoCard?: boolean;
}

/**
 * The public review list for a listing or shop page, read from the Nexus
 * review index with the ratified labeling rules:
 *
 * - D5: every review states its verification honestly — a "Verified
 *   purchase" badge only when the embedded attestation cryptographically
 *   verified at the index AND the attestor is one this app trusts; an
 *   "Attested (unrecognized attestor)" label when the signature verified
 *   but the signer is not in this client's trust list; an explicit
 *   "Unverified" label otherwise.
 * - D7: the subject's single revisable response threads beneath the review,
 *   and the respond/edit affordance renders only for the signed-in subject.
 * - Counting (rules v2): counted reviews come first, verified by an
 *   attestor this app trusts at the attestation's time and not excluded by
 *   moderation. Every other review (unverified, unrecognized or
 *   out-of-window attestor, excluded as fraud) sits in a separate "n not
 *   counted" group below them.
 * - Moderation: a review whose text the index's moderator hid keeps its
 *   stars and shows the reason instead of the text, and still counts.
 *   Every review but the reader's own offers "Report review".
 *
 * - Sort: a control above the list orders it (Newest by default, then
 *   Highest-value purchases, Highest rated, Lowest rated). It reorders the
 *   list only; the figures in the page header are those of every counted
 *   review and never change with the order. It is hidden when the index
 *   cannot sort, and with a single review there is nothing to order.
 *
 * When no review-aware index serves this deployment the section renders
 * nothing at all — absence, not an empty claim.
 */
export function MarketplaceReviewsSection({
  sellerPubky,
  listingId,
  className,
  infoCard = false,
}: MarketplaceReviewsSectionProps) {
  const { status, reviews, isFetching, isReordering, hasMore, loadMore, sort, setSort, sortSupported } =
    useMarketplaceReviews({ sellerPubky, listingId });
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  // The counted and not-counted groups derive from the trust list at render; a narrowing profile re-renders them.
  useAttestorKeyWindowsVersion();
  const outcomes = useReviewOutcomes(reviews);

  if (status === 'unavailable' || status === 'loading') return null;

  const counted = reviews.filter(isCountedIndexedReview);
  const notCounted = reviews.filter((review) => !isCountedIndexedReview(review));
  const renderReview = (review: CommerceIndexedReview) => (
    <MarketplaceReviewItem
      key={`${review.reviewerId}:${review.reviewId}`}
      review={review}
      showListing={listingId === undefined}
      currentUserPubky={currentUserPubky}
      outcomes={reviewOutcomesOf(review, outcomes)}
    />
  );

  return (
    <section
      className={cn(
        'flex w-full gap-3',
        infoCard
          ? 'marketplace-item-details min-w-0 items-start rounded-md bg-card p-5 text-card-foreground shadow-sm sm:col-span-2'
          : 'flex-col',
        className,
      )}
      data-testid="marketplace-reviews-section"
    >
      {infoCard && <Star className="size-5 shrink-0 text-brand" aria-hidden="true" />}
      <div className={cn('flex min-w-0 flex-1 flex-col', infoCard ? 'gap-1' : 'gap-3')}>
        <div className="flex items-center gap-1.5">
          <Heading
            level={2}
            size={infoCard ? 'sm' : 'lg'}
            className={infoCard ? 'text-sm leading-5 font-semibold' : 'font-medium text-muted-foreground'}
          >
            Reviews
          </Heading>
          {(reviews.length > 0 || isReordering) && (
            <InfoHint label={VERIFIED_PURCHASE_INFO_LABEL} data-testid="marketplace-reviews-verified-info">
              {VERIFIED_PURCHASE_INFO}
            </InfoHint>
          )}
          {sortSupported && (reviews.length > 1 || hasMore || isReordering) && (
            <Select
              value={sort}
              onValueChange={(value) => {
                if (isMarketplaceReviewSort(value)) setSort(value);
              }}
            >
              <SelectTrigger
                size="sm"
                theme="secondary"
                className="ml-auto text-xs"
                aria-label={REVIEW_SORT_COPY.label}
                data-testid="marketplace-reviews-sort"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {MARKETPLACE_REVIEW_SORTS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {REVIEW_SORT_COPY.options[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {isReordering ? (
          <MarketplaceReviewsListSkeleton />
        ) : reviews.length === 0 ? (
          <Typography
            as="p"
            overrideDefaults
            className={cn('text-muted-foreground', infoCard ? 'text-sm leading-5 font-medium' : 'text-xs')}
          >
            No reviews yet
          </Typography>
        ) : (
          <>
            {counted.length > 0 && <ul className="flex flex-col gap-4">{counted.map(renderReview)}</ul>}
            {notCounted.length > 0 && (
              <div className="flex flex-col gap-2" data-testid="marketplace-reviews-not-counted">
                <Typography as="h3" overrideDefaults className="text-xs font-medium text-muted-foreground">
                  {REVIEW_MODERATION_COPY.notCountedHeading(notCounted.length)}
                </Typography>
                <ul className="flex flex-col gap-4">{notCounted.map(renderReview)}</ul>
              </div>
            )}
          </>
        )}
        {hasMore && (
          <Button
            size="sm"
            variant="secondary"
            className="self-start rounded-full"
            disabled={isFetching}
            onClick={loadMore}
          >
            {isFetching ? 'Loading…' : 'Load more reviews'}
          </Button>
        )}
      </div>
    </section>
  );
}

function MarketplaceReviewItem({
  review,
  showListing,
  currentUserPubky,
  outcomes,
}: {
  review: CommerceIndexedReview;
  /** On a storefront each review leads with the listing it reviews; a listing page omits it. */
  showListing: boolean;
  currentUserPubky: string | null;
  /** What the review's attestor recorded for its order (refunded, returned); empty for none. */
  outcomes: ReviewOutcome[];
}) {
  const isSubject = currentUserPubky !== null && currentUserPubky === review.subjectId;
  const isReviewer = currentUserPubky !== null && currentUserPubky === review.reviewerId;
  const moderation = review.moderation ?? null;
  const [composerOpen, setComposerOpen] = useState(false);
  const [response, setResponse] = useState(review.response);

  return (
    <li className="flex flex-col gap-2 rounded-md p-3" data-cy="marketplace-review-item">
      {showListing && <MarketplaceReviewListing sellerPubky={review.listingOwnerId} listingId={review.listingId} />}
      <div className="flex flex-wrap items-center gap-2">
        <MarketplaceStarRating rating={review.ratingOverall} size="sm" />
        <Link
          href={
            isSocialLinkOutEnabled()
              ? getMarketplaceShopRoute(review.reviewerId)
              : getProfileRoute(PROFILE_ROUTES.PROFILE, review.reviewerId)
          }
          overrideDefaults
          className="text-xs font-medium text-foreground hover:underline"
        >
          {review.reviewerId.slice(0, 8)}…
        </Link>
        <ProfileOnPubkyLink pubky={review.reviewerId} />
        <Typography as="span" overrideDefaults className="text-xs text-muted-foreground">
          {formatReviewDate(review.createdAt)}
        </Typography>
        {review.editedLate && (
          <Typography
            as="span"
            overrideDefaults
            className="text-xs text-amber-400"
            title="This review was revised after the service's edit window."
          >
            Edited late
          </Typography>
        )}
        <MarketplaceReviewVerificationBadge review={review} />
        <MarketplaceReviewOutcomes review={review} outcomes={outcomes} />
        {!isReviewer && <MarketplaceReviewMenu review={review} />}
      </div>
      {moderation !== null ? (
        <Typography
          as="p"
          overrideDefaults
          className="text-sm text-muted-foreground italic"
          data-testid="marketplace-review-moderated"
        >
          {moderation.state === 'excluded'
            ? REVIEW_MODERATION_COPY.excluded
            : REVIEW_MODERATION_COPY.textHidden(moderation.reason)}
        </Typography>
      ) : (
        review.text.length > 0 && (
          <Typography as="p" overrideDefaults className="text-sm whitespace-pre-wrap text-foreground">
            {review.text}
          </Typography>
        )
      )}
      {response !== null && (
        <div className="flex flex-col gap-1 rounded-md border-l-2 border-brand/50 bg-muted/40 p-2 pl-3">
          <Typography
            as="p"
            overrideDefaults
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground"
          >
            <MessageSquareReply className="size-3.5" />
            Response from {response.responderId === review.subjectId ? 'the reviewed party' : 'the subject'} ·{' '}
            {formatReviewDate(response.updatedAt)}
          </Typography>
          <Typography as="p" overrideDefaults className="text-sm whitespace-pre-wrap text-foreground">
            {response.text}
          </Typography>
        </div>
      )}
      {isSubject && !composerOpen && (
        <Button size="sm" variant="ghost" className="self-start rounded-full" onClick={() => setComposerOpen(true)}>
          {response === null ? 'Respond' : 'Edit response'}
        </Button>
      )}
      {isSubject && composerOpen && (
        <MarketplaceReviewResponseComposer
          review={review}
          onClose={() => setComposerOpen(false)}
          onPublished={(published) => {
            setResponse(toIndexedReviewResponse(published));
            setComposerOpen(false);
          }}
        />
      )}
    </li>
  );
}

/**
 * The review's menu. "Report review" opens the shared report dialog with the
 * review as its target; signed-out readers are asked to sign in first. The
 * dialog mounts only while open, so a long list doesn't hold one profile
 * query per review.
 */
function MarketplaceReviewMenu({ review }: { review: CommerceIndexedReview }) {
  const [reportOpen, setReportOpen] = useState(false);
  const { requireAuth } = useRequireAuth();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto size-7 rounded-full text-muted-foreground"
            aria-label="Review actions"
            data-testid="marketplace-review-menu"
          >
            <Ellipsis className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="gap-2"
            data-testid="marketplace-review-report"
            onSelect={() => requireAuth(() => setReportOpen(true))}
          >
            <Flag className="size-4" aria-hidden="true" />
            Report review
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {reportOpen && (
        <DialogReportPost
          open
          onOpenChange={setReportOpen}
          review={{
            reviewUri: review.uri,
            reviewerPubky: review.reviewerId,
            sellerPubky: review.listingOwnerId,
            listingId: review.listingId,
          }}
        />
      )}
    </>
  );
}

/**
 * The attestor's refund and return notes beside a review (design section 6):
 * one small note per outcome kind with the date the attestor recorded, named
 * after the attestor that said so. Purely informational: the review's stars,
 * its place in the list and its moderation display do not depend on it.
 */
function MarketplaceReviewOutcomes({ review, outcomes }: { review: CommerceIndexedReview; outcomes: ReviewOutcome[] }) {
  const attestorLabel = indexedReviewTrustedAttestor(review)?.label;
  if (outcomes.length === 0 || attestorLabel === undefined) return null;
  return outcomes.map(({ kind, on }) => (
    <Badge
      key={kind}
      variant="outline"
      className="gap-1 text-muted-foreground"
      title={REVIEW_OUTCOME_COPY.detail(kind, attestorLabel, formatReviewDate(on))}
      data-testid={`marketplace-review-outcome-${kind}`}
    >
      {REVIEW_OUTCOME_COPY.label[kind]}
      <span className="font-normal">· {formatReviewDate(on)}</span>
    </Badge>
  ));
}

/**
 * The D5 labeling in one place. Verification proves the SIGNER; whether that
 * signer is a trusted attestor is this client's configuration
 * (`marketplaceTrustedAttestors`) — so an attested review from an
 * unrecognized signer is labeled exactly that, never upgraded to "verified".
 * The trust window is checked against the attestation's `iat`, or the
 * record's `createdAt` (fail closed) when the index serves no `iat` (see
 * `indexedReviewTrustedAttestor`).
 */
function MarketplaceReviewVerificationBadge({ review }: { review: CommerceIndexedReview }) {
  const trustedAttestor = indexedReviewTrustedAttestor(review);
  if (trustedAttestor !== null) {
    return (
      <Badge variant="secondary" className="gap-1 text-emerald-400">
        <BadgeCheck className="size-3" />
        {`Verified purchase · ${trustedAttestor.label}`}
      </Badge>
    );
  }
  if (review.verified) {
    return (
      <Badge
        variant="outline"
        className="text-muted-foreground"
        title={`The purchase attestation verified cryptographically, but its signer (${review.attestorId ?? 'unknown'}) is not an attestor this app recognizes.`}
      >
        Attested (unrecognized attestor)
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-muted-foreground"
      title="This review carries no verifiable purchase attestation."
    >
      Unverified
    </Badge>
  );
}

/**
 * The subject's single revisable response (ratified D7): a homeserver record
 * on the responder's own homeserver, revised in place — the composer loads
 * the local prior (if any) to prefill and to preserve `createdAt`/revision.
 */
function MarketplaceReviewResponseComposer({
  review,
  onClose,
  onPublished,
}: {
  review: CommerceIndexedReview;
  onClose: () => void;
  onPublished: (response: CommerceReviewResponseModelSchema) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  useEffect(() => {
    let active = true;
    CommerceController.getOwnMarketplaceReviewResponse(review.reviewId)
      .then((own) => {
        if (active) setText(own?.record.text ?? review.response?.text ?? '');
      })
      .catch(() => {
        if (active) setText(review.response?.text ?? '');
      });
    return () => {
      active = false;
    };
  }, [review.reviewId, review.response?.text]);

  if (text === null) return null;

  const publish = async () => {
    setIsPublishing(true);
    try {
      const published = await CommerceController.publishMarketplaceReviewResponse({
        review,
        text: text.trim(),
        priorRevision: review.response?.revision ?? null,
        priorCreatedAt: review.response?.createdAt ?? null,
      });
      toast({
        title: 'Response published',
        description: 'Your response is saved and will appear shortly.',
      });
      onPublished(published);
    } catch {
      toast({ variant: 'error', description: 'Could not publish the response.' });
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-cy="marketplace-review-response-composer">
      <Textarea
        variant="dashed"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Write a public response to this review…"
        rows={3}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          className="rounded-full"
          disabled={isPublishing || text.trim().length === 0}
          onClick={publish}
        >
          {isPublishing ? 'Publishing…' : review.response === null ? 'Publish response' : 'Update response'}
        </Button>
        <Button size="sm" variant="ghost" className="rounded-full" disabled={isPublishing} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function formatReviewDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(iso),
  );
}

function toIndexedReviewResponse(
  response: CommerceReviewResponseModelSchema,
): NonNullable<CommerceIndexedReview['response']> {
  return {
    responderId: response.owner_id,
    text: response.record.text,
    createdAt: response.record.createdAt,
    updatedAt: response.record.updatedAt,
    revision: response.record.revision,
  };
}

/**
 * The compact listing a storefront review is about: thumbnail and name, linked
 * to the listing. Read from the local copy, else the seller's homeserver, so a
 * paused, ended or sold-out listing still shows. Renders nothing until found,
 * and nothing for a deleted listing.
 */
function MarketplaceReviewListing({ sellerPubky, listingId }: { sellerPubky: string; listingId: string }) {
  const [listing, setListing] = useState<{ title: string; mediaUrls: string[] } | null>(null);
  const imageUrl = useMarketplaceFirstMediaUrl(listing?.mediaUrls ?? []);

  useEffect(() => {
    let active = true;
    void (async () => {
      // A deleted listing answers null without reporting; the catch covers network and server errors.
      const record = await CommerceController.getOrFetchListingIfFound(sellerPubky, listingId).catch(() => null);
      if (!active || !record) return;
      setListing({
        title: record.title,
        mediaUrls: record.media.filter(({ type }) => type === 'image').map(({ url }) => url),
      });
    })();
    return () => {
      active = false;
    };
  }, [sellerPubky, listingId]);

  if (listing === null) return null;
  return (
    <MarketplaceProductSummary
      title={listing.title}
      href={getMarketplaceListingRoute(sellerPubky, listingId)}
      imageUrl={imageUrl}
    />
  );
}
