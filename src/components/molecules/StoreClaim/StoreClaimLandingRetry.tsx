'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { getStoreState } from '@/config/store-mode';
import { scheduleStoreClaimLandingRetry } from '@/libs/store-claim/store-claim-navigation';

export function StoreClaimLandingRetry() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) scheduleStoreClaimLandingRetry(pathname, getStoreState());
  }, [pathname]);
  return null;
}
