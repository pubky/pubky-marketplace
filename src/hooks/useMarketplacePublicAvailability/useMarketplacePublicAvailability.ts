'use client';

import { useEffect, useState } from 'react';
import { getCommerceAdapterMode, getCommercePollIntervalMs, isDurableCommerceMode } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { Logger } from '@/libs/logger/logger';
import type { MarketplacePublicListingAvailability } from '@/services/marketplace/marketplace';

export type PublicListingStockState = MarketplacePublicListingAvailability['state'];

/**
 * The listing's stock state from the service's public availability read, for
 * a viewer whose marketplace session has lapsed and so cannot read the
 * listing projection. It is read only while `enabled` and exists to show
 * another buyer's hold before the viewer re-approves purchases. Null while
 * disabled, unread, or when the read fails or finds no listing: the caller
 * then shows nothing rather than guessing.
 */
export function useMarketplacePublicAvailability(
  sellerPubky: string,
  listingId: string,
  enabled: boolean,
): PublicListingStockState | null {
  const active = enabled && isDurableCommerceMode(getCommerceAdapterMode());
  const [read, setRead] = useState<{ key: string; state: PublicListingStockState | null } | null>(null);
  const key = `${sellerPubky}:${listingId}`;

  useEffect(() => {
    if (!active) return;
    let current = true;
    const load = async () => {
      try {
        const availability = await CommerceController.getPublicListingAvailability(sellerPubky, listingId);
        if (current) setRead({ key, state: availability?.state ?? null });
      } catch (error) {
        Logger.debug('Public listing availability read failed', { error });
        if (current) setRead({ key, state: null });
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), getCommercePollIntervalMs());
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [active, key, sellerPubky, listingId]);

  return active && read?.key === key ? read.state : null;
}
