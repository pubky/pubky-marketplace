'use client';

import { useEffect, useState } from 'react';
import type { ConnectorShareChoice } from '@/application/commerce/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';

/**
 * The opt-in to share the delivery address with a shipped seller's connected
 * store. Off for every seller until the buyer ticks it, and per order: the
 * choice lives in this hook only. A seller without a connected store (or whose
 * status cannot be read) is offered nothing.
 */
export function useConnectorStoreShare(shippedSellerPubkys: readonly string[]) {
  const sellerKey = [...new Set(shippedSellerPubkys)].sort().join('|');
  const [stores, setStores] = useState<ReadonlyMap<string, ConnectorShareChoice>>(new Map());
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const sellers = sellerKey === '' ? [] : sellerKey.split('|');
    let active = true;
    void (async () => {
      const found = sellers.length > 0 ? await CommerceController.getConnectorStores(sellers) : new Map();
      if (!active) return;
      setStores(found);
      setChosen((current) => new Set([...current].filter((sellerPubky) => found.has(sellerPubky))));
    })();
    return () => {
      active = false;
    };
  }, [sellerKey]);

  const setShare = (sellerPubky: string, share: boolean) => {
    setChosen((current) => {
      const next = new Set(current);
      if (share && stores.has(sellerPubky)) next.add(sellerPubky);
      else next.delete(sellerPubky);
      return next;
    });
  };

  const selected = [...chosen].flatMap((sellerPubky) => {
    const store = stores.get(sellerPubky);
    return store ? [store] : [];
  });

  return { stores, chosen, selected, setShare };
}
