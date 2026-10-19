'use client';

import { useEffect, useState } from 'react';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { MarketplaceSellerAnnualLimit } from '@/core/services/marketplace/marketplace-projections';
import { getEuFenceEnabled } from '@/libs/runtime-config/runtime-config';

export type SellerAnnualLimitState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'ready'; limit: MarketplaceSellerAnnualLimit };

const OFF: SellerAnnualLimitState = { status: 'off' };
const LOADING: SellerAnnualLimitState = { status: 'loading' };

/**
 * The seller's annual-limit state from the service (legal launch plan C4). Off while the Shop's
 * EU fence flag is off, while the service's is, and when the read fails: the service enforces the
 * limit on its own, so a failed read never blocks the page.
 */
export function useSellerAnnualLimit(sellerPubky: string | null | undefined): SellerAnnualLimitState {
  const enabled = getEuFenceEnabled() && Boolean(sellerPubky);
  const [resolved, setResolved] = useState<{ sellerPubky: string; state: SellerAnnualLimitState } | null>(null);

  useEffect(() => {
    if (!enabled || !sellerPubky) return;
    let active = true;
    CommerceController.getSellerAnnualLimit(sellerPubky)
      .then((limit): SellerAnnualLimitState => (limit.enabled ? { status: 'ready', limit } : OFF))
      .catch((): SellerAnnualLimitState => OFF)
      .then((state) => {
        if (active) setResolved({ sellerPubky, state });
      });
    return () => {
      active = false;
    };
  }, [enabled, sellerPubky]);

  if (!enabled) return OFF;
  return resolved !== null && resolved.sellerPubky === sellerPubky ? resolved.state : LOADING;
}
