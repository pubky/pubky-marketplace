'use client';

import { useEffect, useState } from 'react';
import { getCommerceAdapterMode, getCommercePollIntervalMs, isDurableCommerceMode } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { MarketplaceCartItem } from '@/hooks/useMarketplaceCart/useMarketplaceCart';
import { type CartLineStock, cartLineStock,type CartListingAvailability } from '@/libs/commerce/cart-stock';
import { Logger } from '@/libs/logger/logger';

type CartStockItem = Pick<MarketplaceCartItem, 'id' | 'variantId'> & {
  listing: { record: Pick<MarketplaceCartItem['listing']['record'], 'ownerPubky' | 'listingId' | 'variants'> };
};

function listingKey(item: CartStockItem): string {
  return `${item.listing.record.ownerPubky}:${item.listing.record.listingId}`;
}

/**
 * Which cart lines are sold out, from the service's public availability read
 * for each listing in the cart (no session needed) and the seller's record.
 * The read repeats on the commerce poll interval, on focus and on `refresh`.
 * A failed read keeps the listing's last answer.
 */
export function useMarketplaceCartStock(items: readonly CartStockItem[]) {
  const active = isDurableCommerceMode(getCommerceAdapterMode());
  const keys = [...new Set(items.map(listingKey))].sort();
  const keySet = keys.join('|');
  const [reads, setReads] = useState<ReadonlyMap<string, CartListingAvailability | null>>(new Map());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active || keySet === '') return;
    let current = true;
    const listings = keySet.split('|');
    const load = async () => {
      const answers = await Promise.all(
        listings.map(async (key): Promise<[string, CartListingAvailability | null] | null> => {
          const separator = key.indexOf(':');
          try {
            const availability = await CommerceController.getPublicListingAvailability(
              key.slice(0, separator),
              key.slice(separator + 1),
            );
            return [key, availability ? { state: availability.state, variants: availability.variants ?? [] } : null];
          } catch (error) {
            Logger.debug('Cart listing availability read failed', { error });
            return null;
          }
        }),
      );
      if (!current) return;
      setReads((previous) => {
        const next = new Map<string, CartListingAvailability | null>();
        for (const key of listings) if (previous.has(key)) next.set(key, previous.get(key) ?? null);
        for (const answer of answers) if (answer) next.set(answer[0], answer[1]);
        return next;
      });
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
  }, [active, keySet, attempt]);

  const stockByItem = new Map<string, CartLineStock>();
  for (const item of items) {
    const stock = cartLineStock(
      item.listing.record.variants,
      item.variantId,
      active ? reads.get(listingKey(item)) : null,
    );
    if (stock) stockByItem.set(item.id, stock);
  }

  return {
    stockFor: (itemId: string): CartLineStock | null => stockByItem.get(itemId) ?? null,
    hasSoldOut: stockByItem.size > 0,
    refresh: () => setAttempt((value) => value + 1),
  };
}
