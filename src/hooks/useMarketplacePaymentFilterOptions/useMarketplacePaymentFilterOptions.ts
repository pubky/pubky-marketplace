'use client';

import { getCommerceAdapterMode, isDurableCommerceMode } from '@/config/commerce';
import { useUsdtPaymentsCapability } from '@/hooks/useUsdtPaymentsCapability/useUsdtPaymentsCapability';
import type { PaymentMethodFilter } from '@/libs/commerce/payment-method-filter';

/**
 * The rails the marketplace can be filtered by on this deployment, in menu
 * order. None outside the durable service (no rails); USDT only while the
 * Shop flag and the service's USDT capability are both on.
 */
export function useMarketplacePaymentFilterOptions(): PaymentMethodFilter[] {
  const durable = isDurableCommerceMode(getCommerceAdapterMode());
  const usdt = useUsdtPaymentsCapability(durable).status === 'available';
  if (!durable) return [];
  return usdt ? ['bitcoin', 'usdt', 'paypal'] : ['bitcoin', 'paypal'];
}
