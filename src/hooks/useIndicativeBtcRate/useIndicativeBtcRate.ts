'use client';

import { useEffect, useState } from 'react';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { BtcRate } from '@/services/exchangerate/exchangerate.types';

/**
 * Bitcoin's price in every listing currency, backing the indicative "≈" price
 * hints. One Blocktank snapshot, cached at the service layer for five minutes.
 *
 * @param enabled Skip the fetch entirely (e.g. the hint toggle is off or the
 * price's asset has no rate source).
 * @returns The rate, or `null` while loading, disabled, or when the rates
 * are unavailable — callers must render NO hint on `null`, never a fallback.
 */
export function useIndicativeBtcRate(enabled: boolean): BtcRate | null {
  const [rates, setRates] = useState<BtcRate | null>(null);

  useEffect(() => {
    // Avoid fetching on server to prevent hydration errors
    if (typeof window === 'undefined') return;
    if (!enabled) return;

    let active = true;
    CommerceController.getIndicativeBtcRate()
      .then((fetched) => {
        if (active) setRates(fetched);
      })
      .catch(() => {
        if (active) setRates(null);
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  return enabled ? rates : null;
}
