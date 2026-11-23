'use client';

import { useEffect, useState } from 'react';
import { SYNONYM_HOMESERVERS } from '@/config/legal';
import { CommerceController } from '@/controllers/commerce/commerce';

/**
 * Whether `sellerPubky`'s records sit on one of Synonym's homeservers, by the homeserver their Pkarr
 * record names, looked up while `enabled`. `null` until it is known. A failed lookup is `false`: without
 * an answer nobody can say Synonym hosts them.
 */
export function useSellerHostedBySynonym(sellerPubky: string, enabled: boolean): boolean | null {
  const [hosting, setHosting] = useState<{ seller: string; hostedBySynonym: boolean } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void CommerceController.getMarketplaceMediaOwnerHomeserver(sellerPubky)
      .then((homeserver) => {
        if (active)
          setHosting({
            seller: sellerPubky,
            hostedBySynonym: homeserver !== null && SYNONYM_HOMESERVERS.has(homeserver),
          });
      })
      .catch(() => {
        if (active) setHosting({ seller: sellerPubky, hostedBySynonym: false });
      });
    return () => {
      active = false;
    };
  }, [sellerPubky, enabled]);

  return hosting?.seller === sellerPubky ? hosting.hostedBySynonym : null;
}
