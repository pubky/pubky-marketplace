'use client';

import { useEffect, useState } from 'react';
import { getCommerceAdapterMode, isDurableCommerceMode } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { SellerPaymentBadge } from '@/libs/commerce/payment-badges';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

const NONE: SellerPaymentBadge[] = [];

/**
 * The payment rails a seller accepts, as badges (Bitcoin, USDT, PayPal).
 * One public payment-config read per mount and seller; until it lands, the
 * set remembered this session shows, so moving between a storefront and its
 * listings does not blink. Empty outside the durable service (no rails) and
 * while nothing is known.
 */
export function useSellerPaymentBadges(sellerPubky: string): SellerPaymentBadge[] {
  const durable = isDurableCommerceMode(getCommerceAdapterMode());
  const remembered = useCommerceStore((state) => state.sellerPaymentBadges[sellerPubky]);
  const [fetched, setFetched] = useState<{ sellerPubky: string; badges: SellerPaymentBadge[] } | null>(null);

  useEffect(() => {
    if (!durable) return;
    let active = true;
    void CommerceController.fetchSellerPaymentBadges(sellerPubky)
      .then((badges) => {
        if (active && badges) setFetched({ sellerPubky, badges });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [durable, sellerPubky]);

  if (!durable) return NONE;
  if (fetched?.sellerPubky === sellerPubky) return fetched.badges;
  return remembered ?? NONE;
}
