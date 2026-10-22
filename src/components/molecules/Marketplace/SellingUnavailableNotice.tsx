'use client';

import { MARKETPLACE_ROUTES } from '@/app/routes';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import type { CommerceAvailability } from '@/libs/commerce/commerce-availability';
import {
  COMMERCE_BLOCKED_INFO_LABEL,
  SELLING_MOVED_LINK_LABEL,
  SELLING_MOVED_ON_SHOP_SETTINGS,
  SELLING_MOVED_PREFIX,
  SELLING_PAUSED_NOTE,
} from '@/libs/commerce/region-modes';
import { cn } from '@/libs/utils/utils';
import { InfoHint } from '@/molecules/InfoHint/InfoHint';

/** The shop country field on the storefront settings, which stays open in a blocked region. */
export const SHOP_COUNTRY_FIELD_ROUTE = `${MARKETPLACE_ROUTES.MY_SHOP}#countryCode`;

/**
 * The way out under the selling line. A seller whose shop country is the reason is told to update it,
 * with a link to the field (or, on the storefront settings, where the field is, that it is below). A seller
 * whose own region is the reason can still edit their shop there. Nothing for an unknown region.
 */
export function SellingUnavailableHint({
  selling,
  onShopSettings = false,
  className,
}: {
  selling: CommerceAvailability;
  onShopSettings?: boolean;
  className?: string;
}) {
  let hint: React.ReactNode = null;
  if (selling.source === 'declared') {
    hint = onShopSettings ? (
      SELLING_MOVED_ON_SHOP_SETTINGS
    ) : (
      <>
        {SELLING_MOVED_PREFIX}
        <Link href={SHOP_COUNTRY_FIELD_ROUTE} overrideDefaults className="font-medium underline underline-offset-2">
          {SELLING_MOVED_LINK_LABEL}
        </Link>
        .
      </>
    );
  } else if (selling.source === 'ip' && onShopSettings) {
    hint = SELLING_PAUSED_NOTE;
  }
  if (hint === null) return null;
  return (
    <Typography
      as="p"
      className={cn('text-sm text-muted-foreground', className)}
      data-testid="selling-unavailable-hint"
    >
      {hint}
    </Typography>
  );
}

/**
 * Selling is blocked for this seller, shown above a page that stays open read-only (the studio, the
 * storefront settings): the one line with its info icon, and the way out.
 */
export function SellingUnavailableNotice({
  selling,
  testId,
  onShopSettings = false,
}: {
  selling: CommerceAvailability;
  testId: string;
  onShopSettings?: boolean;
}) {
  if (!selling.blocked || !selling.sellingMessage || !selling.info) return null;
  return (
    <div role="status" className="grid gap-1 rounded-md border bg-card/40 px-4 py-3" data-testid={testId}>
      <div className="flex items-center gap-2">
        <Typography as="p" className="text-sm font-medium">
          {selling.sellingMessage}
        </Typography>
        <InfoHint label={COMMERCE_BLOCKED_INFO_LABEL}>{selling.info}</InfoHint>
      </div>
      <SellingUnavailableHint selling={selling} onShopSettings={onShopSettings} />
    </div>
  );
}
