import { Skeleton } from '@/atoms/Skeleton/Skeleton';
import { Typography } from '@/atoms/Typography/Typography';
import { REVIEW_FILTER_COPY } from '@/config/commerce-copy';
import type { MarketplaceReviewFilterSummary } from '@/libs/commerce/review-filter';
import { cn } from '@/libs/utils/utils';
import { MarketplaceStarRating } from '@/molecules/MarketplaceStarRating/MarketplaceStarRating';

export interface MarketplaceReviewFilterRatingProps {
  summary: MarketplaceReviewFilterSummary;
  /** Words between the figure and its basis, e.g. "products rated". */
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * The item rating of a reviewer filter, as the index counted it over the
 * matches: "4.8 from 3 people you follow". With no counted match it reads
 * "No reviews from people you follow", never 0.0 and never the figure of
 * everyone; while the index has not answered it holds the place; and when no
 * figure can be claimed for the filter it says so.
 */
export function MarketplaceReviewFilterRating({
  summary,
  label,
  size = 'sm',
  className,
}: MarketplaceReviewFilterRatingProps) {
  const textClass = size === 'sm' ? 'text-xs' : 'text-sm';

  if (summary.state === 'loading') {
    return <Skeleton className={cn('h-4 w-44', className)} data-testid="marketplace-review-filter-rating-loading" />;
  }
  if (summary.state === 'unscored') {
    return (
      <Typography
        as="p"
        className={cn(textClass, 'text-muted-foreground', className)}
        data-testid="marketplace-review-filter-rating"
      >
        {REVIEW_FILTER_COPY.unscored}
      </Typography>
    );
  }
  const { matched, filter } = summary;
  if (matched.buyers === 0 || matched.avg === null) {
    return (
      <Typography
        as="p"
        className={cn(textClass, 'text-muted-foreground', className)}
        data-testid="marketplace-review-filter-rating"
      >
        {REVIEW_FILTER_COPY.none(filter.kind)}
      </Typography>
    );
  }
  return (
    <div
      className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', className)}
      data-testid="marketplace-review-filter-rating"
    >
      <MarketplaceStarRating rating={matched.avg} size={size} />
      <Typography as="span" className={cn(textClass, 'text-muted-foreground')}>
        {label === undefined ? '' : `${label} `}
        {REVIEW_FILTER_COPY.from(filter.kind, matched.buyers)}
      </Typography>
    </div>
  );
}
