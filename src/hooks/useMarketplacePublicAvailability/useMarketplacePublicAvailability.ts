'use client';

import { useEffect, useState } from 'react';
import { getCommerceAdapterMode, getCommercePollIntervalMs, isDurableCommerceMode } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { Logger } from '@/libs/logger/logger';
import type { MarketplacePublicListingAvailability } from '@/services/marketplace/marketplace';

export type PublicListingStockState = MarketplacePublicListingAvailability['state'];

export interface PublicListingStock {
  state: PublicListingStockState;
  /** Per-size sold-out flags; empty for a listing that sells one variant. */
  variants: NonNullable<MarketplacePublicListingAvailability['variants']>;
}

/**
 * The listing's stock state, and which sizes are sold out, from the service's public availability read, for
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
): PublicListingStock | null {
  const active = enabled && isDurableCommerceMode(getCommerceAdapterMode());
  const [read, setRead] = useState<{ key: string; stock: PublicListingStock | null } | null>(null);
  const key = `${sellerPubky}:${listingId}`;

  useEffect(() => {
    if (!active) return;
    let current = true;
    const load = async () => {
      try {
        const availability = await CommerceController.getPublicListingAvailability(sellerPubky, listingId);
        if (current)
          setRead({
            key,
            stock: availability ? { state: availability.state, variants: availability.variants ?? [] } : null,
          });
      } catch (error) {
        Logger.debug('Public listing availability read failed', { error });
        if (current) setRead({ key, stock: null });
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

  return active && read?.key === key ? read.stock : null;
}
