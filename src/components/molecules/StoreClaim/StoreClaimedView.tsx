'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AUTH_ROUTES, getMarketplaceShopRoute, MARKETPLACE_ROUTES } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Typography } from '@/atoms/Typography/Typography';
import { groupPubky } from '@/libs/store-claim/format-pubky';
import { clearStoreClaimCode } from '@/libs/store-claim/store-claim-code';
import { storeRouteGuardReturnTo } from '@/providers/RouteGuardProvider/RouteGuardProvider.returnPath';

export function StoreClaimedView({ seller }: { seller: string }) {
  useEffect(() => clearStoreClaimCode(), []);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
      <Typography as="h1" size="lg" className="text-3xl font-bold">
        This shop was claimed by <code className="break-all">{groupPubky(seller)}</code>
      </Typography>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href={getMarketplaceShopRoute(seller)}>Open the shop</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href={AUTH_ROUTES.SIGN_IN} onClick={() => storeRouteGuardReturnTo(MARKETPLACE_ROUTES.DASHBOARD)}>
            Sign in to Seller Studio
          </Link>
        </Button>
      </div>
    </main>
  );
}
