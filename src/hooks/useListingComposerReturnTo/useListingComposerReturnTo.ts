'use client';

import { useSearchParams } from 'next/navigation';
import { readMarketplaceListingComposerReturnTo } from '@/app/routes';

/**
 * The listing composer a settings page was opened from (`?returnTo=`), or
 * null. Only Create listing and a listing's edit page are accepted, so the
 * value is always an internal path that is safe to link to.
 */
export function useListingComposerReturnTo(): string | null {
  // Null outside the App Router (e.g. a component rendered without its navigation context).
  const searchParams = useSearchParams() as ReturnType<typeof useSearchParams> | null;
  return readMarketplaceListingComposerReturnTo(searchParams?.get('returnTo') ?? null);
}
