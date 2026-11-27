'use client';

import { MARKETPLACE_ROUTES } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Heading } from '@/atoms/Heading/Heading';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { MarketplaceSignOutCard } from '@/organisms/Marketplace/MarketplaceSignOutCard';

export function MarketplaceAccountSettings() {
  return (
    <>
      <Card className="rounded-md p-0">
        <CardContent className="flex flex-col items-start gap-4 p-6">
          <Heading level={2} size="md">
            Your Market account
          </Heading>
          <Button asChild variant="secondary">
            <Link href={MARKETPLACE_ROUTES.SETTINGS_ADDRESSES} overrideDefaults>
              Manage delivery addresses
            </Link>
          </Button>
          <Typography as="p" className="text-sm text-muted-foreground">
            With permission to follow, the Shop publicly follows a seller when you message them about a listing or
            order, add their item to your cart or watchlist, make an offer, place a bid or buy from them. You can
            unfollow them in Pubky App.
          </Typography>
        </CardContent>
      </Card>
      <MarketplaceSignOutCard />
    </>
  );
}
