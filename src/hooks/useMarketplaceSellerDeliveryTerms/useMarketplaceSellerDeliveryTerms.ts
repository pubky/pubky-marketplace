'use client';

import { useEffect, useState } from 'react';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { CommerceShopRecord } from '@/libs/commerce/marketplace-records';
import { resolveSellerDeliveryTerms, type SellerDeliveryTerms } from '@/libs/commerce/seller-delivery-terms';
import { hasHttpStatus } from '@/libs/error/error.utils';

export interface MarketplaceSellerDeliveryTermsEntry {
  sellerPubky: string;
  /** The seller's shop name, or null when they have no shop record. */
  shopName: string | null;
  terms: SellerDeliveryTerms;
}

/**
 * The post-purchase periods each seller sets on their shop record, as the
 * buyer will be held to them. Reads the live record (the transaction service
 * freezes it on the order when payment starts), falling back to the cached
 * copy when the network read fails. A seller with no shop record resolves to
 * the defaults; a seller whose record cannot be read at all is left out
 * rather than shown with terms that may be wrong.
 */
export function useMarketplaceSellerDeliveryTerms(sellerPubkys: readonly string[]) {
  const key = [...new Set(sellerPubkys)].sort().join(',');
  const [resolved, setResolved] = useState<{ key: string; entries: MarketplaceSellerDeliveryTermsEntry[] } | null>(
    null,
  );

  useEffect(() => {
    const pubkys = key === '' ? [] : key.split(',');
    if (pubkys.length === 0) return;
    let active = true;
    void Promise.all(pubkys.map((pubky) => resolveEntry(pubky).catch(() => null))).then((entries) => {
      if (!active) return;
      setResolved({ key, entries: entries.filter((entry) => entry !== null) });
    });
    return () => {
      active = false;
    };
  }, [key]);

  return {
    isLoading: key !== '' && resolved?.key !== key,
    entries: key !== '' && resolved?.key === key ? resolved.entries : [],
  };
}

async function resolveEntry(sellerPubky: string): Promise<MarketplaceSellerDeliveryTermsEntry | null> {
  let record: CommerceShopRecord | null;
  try {
    record = await CommerceController.refreshShop(sellerPubky);
  } catch (error) {
    if (hasHttpStatus(error, 404)) {
      return { sellerPubky, shopName: null, terms: resolveSellerDeliveryTerms(null) };
    }
    const cached = await CommerceController.getShop(sellerPubky).catch(() => null);
    if (!cached) return null;
    record = cached.record;
  }
  return { sellerPubky, shopName: record.name, terms: resolveSellerDeliveryTerms(record) };
}
