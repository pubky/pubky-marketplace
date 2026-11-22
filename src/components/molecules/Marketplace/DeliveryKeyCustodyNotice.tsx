'use client';

import { KeyRound } from 'lucide-react';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { DELIVERY_KEY_COPY } from '@/libs/commerce/delivery-key-copy';

/**
 * Seller studio notice that the delivery key's private half stays in this browser, so losing it
 * leaves earlier orders' addresses unopenable. Links to Delivery privacy in Shipping settings.
 */
export function DeliveryKeyCustodyNotice() {
  return (
    <Card className="rounded-md bg-card p-0" data-testid="delivery-key-custody-notice">
      <CardContent className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-1 size-5 shrink-0 text-brand" aria-hidden="true" />
          <div>
            <Typography as="h2" className="font-semibold">
              {DELIVERY_KEY_COPY.custodyTitle}
            </Typography>
            <Typography as="p" className="text-sm text-muted-foreground">
              {DELIVERY_KEY_COPY.custodyBody}
            </Typography>
          </div>
        </div>
        <Button asChild variant="secondary" className="shrink-0 rounded-full">
          <Link href={MARKETPLACE_ROUTES.SETTINGS_SHIPPING} overrideDefaults>
            Delivery privacy
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
