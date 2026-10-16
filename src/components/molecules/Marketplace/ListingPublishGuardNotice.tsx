'use client';

import {
  getMarketplacePaymentSettingsRoute,
  getMarketplaceShippingSettingsRoute,
  MARKETPLACE_ROUTES,
} from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import {
  LISTING_PUBLISH_BLOCK_COPY,
  type ListingPublishBlockReason,
  rememberListingComposerReturnTo,
} from '@/libs/commerce/listing-publish-guards';
import { MarketplaceSessionConnectDialog } from '@/organisms/Marketplace/MarketplaceSessionConnectDialog';
import { PaykitOutageNotice } from './PaykitOutageNotice';

export function ListingPublishGuardNotice({
  reason,
  surface,
  id,
  density = 'banner',
  returnTo,
  onSessionConnected,
  onLeaveForSetup,
}: {
  reason: ListingPublishBlockReason;
  surface: string;
  id?: string;
  density?: 'banner' | 'action';
  returnTo?: string;
  onSessionConnected?: () => void | Promise<void>;
  /** Runs as the seller follows a setup link away from the composer, before the page unmounts. */
  onLeaveForSetup?: () => void;
}) {
  if (reason === 'paykit-unreachable') {
    return (
      <PaykitOutageNotice
        audience="seller"
        surface={surface}
        id={id}
        className={`flex items-start gap-3 rounded-md bg-brand/5 ${density === 'action' ? 'p-3' : 'p-4'}`}
      />
    );
  }
  const copy = LISTING_PUBLISH_BLOCK_COPY[reason];
  const needsSession = reason === 'session' || reason === 'unverified';

  return (
    <div
      role="alert"
      id={id}
      data-surface={surface}
      className={
        density === 'action'
          ? 'rounded-md border border-amber-500/40 bg-amber-500/10 p-3'
          : 'rounded-md border border-amber-500/40 bg-amber-500/10 p-4'
      }
      tabIndex={-1}
    >
      <Typography as="p" className="font-semibold">
        {copy.title}
      </Typography>
      <Typography as="p" className="mt-1 text-sm text-muted-foreground">
        {copy.body}
      </Typography>
      {reason === 'no-method' ? (
        <Button asChild variant="link" className="mt-2 h-auto p-0">
          <Link
            href={getMarketplacePaymentSettingsRoute(returnTo ?? MARKETPLACE_ROUTES.SELL)}
            overrideDefaults
            onClick={() => {
              rememberListingComposerReturnTo(returnTo ?? MARKETPLACE_ROUTES.SELL);
              onLeaveForSetup?.();
            }}
          >
            Payment settings
          </Link>
        </Button>
      ) : reason === 'no-delivery-key' ? (
        <Button asChild variant="link" className="mt-2 h-auto p-0">
          <Link href={getMarketplaceShippingSettingsRoute(returnTo)} overrideDefaults onClick={onLeaveForSetup}>
            Create delivery key
          </Link>
        </Button>
      ) : needsSession ? (
        <div className="mt-3">
          <MarketplaceSessionConnectDialog
            triggerLabel="Enable selling"
            intent="sell"
            onConnected={onSessionConnected}
          />
        </div>
      ) : null}
    </div>
  );
}
