'use client';

import { useEffect, useState } from 'react';
import { getCommerceAdapterMode, isDurableCommerceMode } from '@/config/commerce';
import { type CommerceCatalogUiFilters, CommerceController } from '@/controllers/commerce/commerce';
import type { PaymentMethodFilter } from '@/libs/commerce/payment-method-filter';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

/**
 * - `off`: no payment-method filter is active (or the deployment has no rails).
 * - `loading`: the first read for this method is in flight.
 * - `ready`: `sellers` holds the set (fresh, or the one remembered this session).
 * - `unavailable`: the set could not be read and none is remembered; the grid
 *   says so instead of guessing.
 */
export type PaymentMethodSellersStatus = 'off' | 'loading' | 'ready' | 'unavailable';

/**
 * The sellers who accept `method` (stored config, never Paykit health), and
 * discovery of their listings. Re-reads when the method or a server-side
 * catalog filter changes; while a read is in flight the set remembered for
 * the method this session stays in use.
 */
export function useMarketplacePaymentMethodSellers(
  method: PaymentMethodFilter | null,
  filters: CommerceCatalogUiFilters,
): { status: PaymentMethodSellersStatus; sellers: ReadonlySet<string> | null } {
  const enabled = method !== null && isDurableCommerceMode(getCommerceAdapterMode());
  const remembered = useCommerceStore((state) => (method ? state.paymentMethodSellers[method] : undefined));
  const [failed, setFailed] = useState<{ method: PaymentMethodFilter } | null>(null);
  const { saleFormat, conditions, sort, countryCode } = filters;

  useEffect(() => {
    if (!enabled || !method) return;
    let active = true;
    setFailed(null);
    CommerceController.fetchPaymentMethodCatalog(method, { saleFormat, conditions, sort, countryCode }).catch(() => {
      if (active) setFailed({ method });
    });
    return () => {
      active = false;
    };
  }, [enabled, method, saleFormat, conditions, sort, countryCode]);

  if (!enabled || !method) return { status: 'off', sellers: null };
  if (remembered) return { status: 'ready', sellers: new Set(remembered) };
  if (failed?.method === method) return { status: 'unavailable', sellers: null };
  return { status: 'loading', sellers: null };
}
