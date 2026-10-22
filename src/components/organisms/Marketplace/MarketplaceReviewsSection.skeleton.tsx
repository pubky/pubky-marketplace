import { Skeleton } from '@/atoms/Skeleton/Skeleton';
import { MARKETPLACE_REVIEWS_PAGE_SIZE } from '@/config/commerce';

/** The review list while a changed sort loads its first page; one placeholder per review of a full page. */
export function MarketplaceReviewsListSkeleton({ count = MARKETPLACE_REVIEWS_PAGE_SIZE }: { count?: number }) {
  return (
    <ul className="flex flex-col gap-4" aria-hidden="true" data-testid="marketplace-reviews-list-skeleton">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="flex flex-col gap-2 rounded-md p-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </li>
      ))}
    </ul>
  );
}
