'use client';

import { KeyRound } from 'lucide-react';
import { getMarketplaceShippingSettingsRoute } from '@/app/routes';
import { Badge } from '@/atoms/Badge/Badge';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Heading } from '@/atoms/Heading/Heading';
import { Link } from '@/atoms/Link/Link';
import { Skeleton } from '@/atoms/Skeleton/Skeleton';
import { Typography } from '@/atoms/Typography/Typography';
import { useMyDeliveryKey } from '@/hooks/useMyDeliveryKey/useMyDeliveryKey';

/**
 * The delivery key as a step of selling setup, beside how the seller gets
 * paid. The key itself is created in Shipping settings (the device that holds
 * the private half is the one that opens addresses); this card only says
 * whether buyers can check out shipped items yet and sends the seller there.
 */
export function MarketplaceDeliveryKeyStep({ returnTo }: { returnTo?: string | null }) {
  const deliveryKey = useMyDeliveryKey();
  if (!deliveryKey.enabled) return null;

  const publication = deliveryKey.status?.publication ?? null;
  const published = publication === 'matches' || publication === 'different';
  const ready = !deliveryKey.isLoading && !deliveryKey.loadFailed && deliveryKey.status !== null;

  return (
    <Card className="rounded-md p-0 shadow-lg" data-surface="marketplace-delivery-key-step">
      <CardContent className="grid gap-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-x-3">
            <KeyRound className="size-6 shrink-0 text-brand" />
            <Heading level={2} size="md">
              Delivery key
            </Heading>
            <Typography as="p" className="col-start-2 text-sm text-muted-foreground">
              Needed to sell items that ship. Buyers encrypt their delivery address to this key, and only your device
              can open it.
            </Typography>
          </div>
          {ready && (
            <Badge
              variant={published ? 'secondary' : 'outline'}
              role="status"
              data-testid="delivery-key-step-status"
              className="shrink-0"
            >
              {published ? 'Published' : 'Not created'}
            </Badge>
          )}
        </div>

        {deliveryKey.isLoading ? (
          <Skeleton className="h-10 w-48" aria-label="Checking your delivery key" />
        ) : deliveryKey.loadFailed ? (
          <Typography as="p" role="alert" className="text-sm text-amber-300">
            Could not read your delivery key status. Check your connection and reload.
          </Typography>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild className="rounded-full" variant={published ? 'secondary' : 'default'}>
              <Link href={getMarketplaceShippingSettingsRoute(returnTo)} overrideDefaults>
                <KeyRound className="size-4" />
                {published ? 'Manage in Shipping settings' : 'Create delivery key'}
              </Link>
            </Button>
            {!published && (
              <Typography as="p" className="text-sm text-muted-foreground">
                Until it exists, buyers cannot check out shipped items from you, and listings that ship cannot be
                published.
              </Typography>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
