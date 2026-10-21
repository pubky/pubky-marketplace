'use client';

import { useEffect, useState } from 'react';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useBuyerCountry } from '@/hooks/useBuyerCountry/useBuyerCountry';
import {
  digitalHoldRefusal,
  fenceRefusal,
  SELLER_LIMIT_MESSAGE,
  type SellerDeclaration,
  sellerDeclaration,
} from '@/libs/commerce/eu-region';
import { canonicalCountryCode } from '@/libs/commerce/postal-address';
import { getDigitalRegionBlockEnabled, getEuFenceEnabled } from '@/libs/runtime-config/runtime-config';

export interface CheckoutRegion {
  /** Either region flag is on. */
  enabled: boolean;
  /** The country this checkout counts as the buyer's: the address country, else the remembered one. */
  buyerCountry: string | null;
  /** Pickup and digital checkouts have no address, so they ask for the country directly. */
  needsCountryField: boolean;
  setBuyerCountry: (countryCode: string | null) => void;
  /** Why this checkout cannot go ahead, or null. */
  refusal: string | null;
  /** The sellers' declarations, by pubky, once read (always, for the consumer-law lines); empty until then. */
  declarations: Readonly<Record<string, SellerDeclaration>>;
  /** Pay stays disabled: a refusal, or a country still to be given. */
  blocked: boolean;
}

interface SellerFacts {
  declarations: Record<string, SellerDeclaration>;
  limitReached: Record<string, boolean>;
}

/**
 * What the EU fence (C3, C4) and the digital hold (C3b) say about one checkout. The sellers' own
 * declarations come from their shop records and their annual-limit state from the service; the
 * buyer's country is the delivery address's when there is one and the remembered one otherwise.
 * The address country is remembered only when the order is placed (`useMarketplaceCheckout`), never
 * from the form while it loads or is being filled in.
 */
export function useCheckoutRegion(input: {
  sellerPubkys: readonly string[];
  hasDigital: boolean;
  requiresDeliveryAddress: boolean;
  addressCountry: string;
  currentUserPubky: string | null;
}): CheckoutRegion {
  const buyer = useBuyerCountry();
  const fence = getEuFenceEnabled();
  const digitalHold = getDigitalRegionBlockEnabled() && input.hasDigital;
  const key = [...new Set(input.sellerPubkys)].sort().join(',');
  const [facts, setFacts] = useState<{ key: string; value: SellerFacts } | null>(null);

  useEffect(() => {
    if (key === '') return;
    let active = true;
    const sellers = key.split(',');
    void Promise.all(
      sellers.map(async (pubky) => {
        const shop = await CommerceController.refreshShopOrGetCached(pubky).then(
          (record) => ({ read: true as const, record }),
          () => ({ read: false as const }),
        );
        const limit =
          !fence || pubky === input.currentUserPubky
            ? null
            : await CommerceController.getSellerAnnualLimit(pubky).catch(() => null);
        const declaration: SellerDeclaration = shop.read ? sellerDeclaration(shop.record) : 'unknown';
        return [pubky, declaration, limit?.limitReached === true] as const;
      }),
    ).then((rows) => {
      if (!active) return;
      setFacts({
        key,
        value: {
          declarations: Object.fromEntries(rows.map(([pubky, declaration]) => [pubky, declaration])),
          limitReached: Object.fromEntries(rows.map(([pubky, , reached]) => [pubky, reached])),
        },
      });
    });
    return () => {
      active = false;
    };
  }, [fence, key, input.currentUserPubky]);

  const addressCountry = canonicalCountryCode(input.addressCountry);
  const addressCountryValid = /^[A-Z]{2}$/.test(addressCountry);
  const countryFromAddress = input.requiresDeliveryAddress && addressCountryValid ? addressCountry : null;
  const buyerCountry = input.requiresDeliveryAddress ? countryFromAddress : buyer.country;

  const needsCountryField = buyer.enabled && !input.requiresDeliveryAddress && (fence || digitalHold);
  const known = facts?.key === key ? facts.value : null;
  const declarations = known?.declarations ?? {};

  let refusal: string | null = null;
  if (fence && known) {
    for (const pubky of key.split(',')) {
      if (known.limitReached[pubky]) {
        refusal = SELLER_LIMIT_MESSAGE;
        break;
      }
      const sellerRefusal = fenceRefusal({
        buyerCountry,
        declaration: known.declarations[pubky] ?? 'unknown',
      });
      if (sellerRefusal) {
        refusal = sellerRefusal;
        break;
      }
    }
  }
  if (!refusal && digitalHold) refusal = digitalHoldRefusal(buyerCountry);

  return {
    enabled: buyer.enabled,
    buyerCountry,
    needsCountryField,
    setBuyerCountry: buyer.setCountry,
    refusal,
    declarations,
    blocked: refusal !== null || (needsCountryField && buyer.country === null) || (fence && key !== '' && !known),
  };
}
