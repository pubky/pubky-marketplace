'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import { getMarketplaceShopRoute, MARKETPLACE_ROUTES } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Typography } from '@/atoms/Typography/Typography';
import { getShopBaseUrl } from '@/config/base-path';
import { getStoreState } from '@/config/store-mode';
import { CopyField } from '@/molecules/Marketplace/CopyField';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useStoreSetupStore } from '@/stores/storeSetup/storeSetup.store';

export function MarketplaceFinishSetupPanel({ catalogEmpty }: { catalogEmpty: boolean }) {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const dismissed = useStoreSetupStore((state) => state.finishPanelDismissed);
  const dismiss = useStoreSetupStore((state) => state.dismissFinishPanel);
  const state = getStoreState();
  if (
    state.kind !== 'claimed' ||
    state.source !== 'claim' ||
    currentUserPubky !== state.seller ||
    !catalogEmpty ||
    dismissed
  ) {
    return null;
  }

  const shopUrl = `${getShopBaseUrl()}${getMarketplaceShopRoute(state.seller)}`;

  return (
    <Card className="rounded-md bg-brand/5 p-0" data-testid="finish-setup-panel">
      <CardContent className="relative flex flex-col gap-5 p-6">
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-3 right-3"
          aria-label="Dismiss finish setup"
          onClick={dismiss}
        >
          <X className="size-4" />
        </Button>
        <div className="pr-8">
          <Typography as="h2" className="text-xl font-semibold">
            Finish setting up your shop
          </Typography>
        </div>
        <ol className="flex list-decimal flex-col gap-4 pl-5">
          <li>
            <Link href={MARKETPLACE_ROUTES.SELL} className="font-medium text-brand hover:underline">
              Create your first listing
            </Link>
          </li>
          <li>
            <Typography as="p">
              Get paid: connect Bitkit through this store&apos;s Paykit setup, or add PayPal in{' '}
              <Link href={MARKETPLACE_ROUTES.SETTINGS} className="font-medium text-brand hover:underline">
                payment settings
              </Link>
              .
            </Typography>
          </li>
          <li>
            <Typography as="p" className="mb-2 font-medium">
              Copy your shop link
            </Typography>
            <CopyField label="Shop link" value={shopUrl} copiedMessage="Shop link copied." />
          </li>
        </ol>
        <Typography as="p" className="text-sm text-muted-foreground">
          You can now remove <code>STORE_CLAIM_TOKEN</code> and <code>STORE_SETUP_LINK</code> from your deployment.
        </Typography>
      </CardContent>
    </Card>
  );
}
