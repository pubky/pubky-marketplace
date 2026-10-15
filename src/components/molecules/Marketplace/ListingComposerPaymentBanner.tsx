'use client';

import { Banknote } from 'lucide-react';
import { getMarketplacePaymentSettingsRoute, MARKETPLACE_ROUTES } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { LISTING_COMPOSER_PAYMENT_COPY, rememberListingComposerReturnTo } from '@/libs/commerce/listing-publish-guards';

/** Shown above the listing composer while the seller has no payment method; drafts stay available. */
export function ListingComposerPaymentBanner() {
  const settingsHref = getMarketplacePaymentSettingsRoute(MARKETPLACE_ROUTES.SELL);

  return (
    <div
      role="status"
      data-surface="listing-payment-setup"
      className="flex flex-col gap-3 rounded-md bg-brand/5 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <Banknote className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden="true" />
        <div>
          <Typography as="p" className="font-semibold">
            {LISTING_COMPOSER_PAYMENT_COPY.title}
          </Typography>
          <Typography as="p" className="text-sm text-muted-foreground">
            {LISTING_COMPOSER_PAYMENT_COPY.body}
          </Typography>
        </div>
      </div>
      <Button asChild size="sm" className="w-fit shrink-0 rounded-full">
        <Link
          href={settingsHref}
          overrideDefaults
          onClick={() => rememberListingComposerReturnTo(MARKETPLACE_ROUTES.SELL)}
        >
          Payment settings
        </Link>
      </Button>
    </div>
  );
}
