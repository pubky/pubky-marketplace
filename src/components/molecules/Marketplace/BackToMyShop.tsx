'use client';

import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { MARKETPLACE_ROUTES, readMarketplaceListingComposerReturnTo } from '@/app/routes';
import { Link } from '@/atoms/Link/Link';
import { useListingComposerReturnTo } from '@/hooks/useListingComposerReturnTo/useListingComposerReturnTo';
import { LISTING_COMPOSER_RETURN_LABEL } from '@/libs/commerce/listing-publish-guards';

/**
 * The top-left way back. It returns to the listing the seller came from
 * (`?returnTo=`, or `returnTo` for a page that remembers it elsewhere), and to
 * My shop otherwise.
 */
export function BackToMyShop({ returnTo }: { returnTo?: string | null }) {
  const pathname = usePathname();
  const fromUrl = useListingComposerReturnTo();
  const origin = (returnTo ? readMarketplaceListingComposerReturnTo(returnTo) : null) ?? fromUrl;
  const listingPath = origin && origin !== pathname ? origin : null;

  return (
    <Link
      href={listingPath ?? MARKETPLACE_ROUTES.DASHBOARD}
      overrideDefaults
      className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {listingPath ? LISTING_COMPOSER_RETURN_LABEL : 'My shop'}
    </Link>
  );
}
