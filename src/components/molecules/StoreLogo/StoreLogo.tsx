'use client';

import { Store } from 'lucide-react';
import { getShopHomeRoute } from '@/app/routes';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { getStoreSeller } from '@/config/store-mode';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useLocalFirstQuery } from '@/hooks/useLocalFirstQuery/useLocalFirstQuery';
import { useMarketplaceMediaUrl } from '@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl';
import { cn } from '@/libs/utils/utils';

interface StoreLogoProps {
  noLink?: boolean;
  className?: string;
}

/**
 * A store's header mark: its shop's avatar and name, read from the store seller's shop record, in
 * place of the Pubky Market wordmark. Before the record is read, or for a seller without one, it
 * shows the shop icon and "Shop".
 */
export function StoreLogo({ noLink = false, className }: StoreLogoProps) {
  const storeSeller = getStoreSeller();
  const { data: shop } = useLocalFirstQuery({
    queryFn: () => CommerceController.getShop(storeSeller),
    fetchFn: () => CommerceController.refreshShop(storeSeller),
    deps: [storeSeller],
    enabled: storeSeller !== null,
  });
  const avatarUrl = useMarketplaceMediaUrl(shop?.record.avatarUrl);
  const name = shop?.record.name.trim() || 'Shop';

  const mark = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand text-bright-fill-foreground">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- homeserver media and object URLs bypass Next image optimization
          <img src={avatarUrl} alt="" className="size-full object-cover object-center" />
        ) : (
          <Store className="size-5" aria-hidden="true" />
        )}
      </span>
      <Typography as="span" overrideDefaults className="max-w-48 truncate text-lg font-semibold text-foreground">
        {name}
      </Typography>
    </>
  );
  const classes = cn('flex min-h-[36px] items-center gap-2', className);

  return noLink ? (
    <span data-testid="store-logo" className={classes}>
      {mark}
    </span>
  ) : (
    <Link
      href={getShopHomeRoute()}
      prefetch={false}
      overrideDefaults
      data-cy="header-logo"
      data-testid="store-logo"
      className={classes}
    >
      {mark}
    </Link>
  );
}
