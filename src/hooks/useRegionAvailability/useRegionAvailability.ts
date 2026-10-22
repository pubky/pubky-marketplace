'use client';

import { useBuyerCountry } from '@/hooks/useBuyerCountry/useBuyerCountry';
import { useSellerAnnualLimit } from '@/hooks/useSellerAnnualLimit/useSellerAnnualLimit';
import {
  DIGITAL_REGION_MESSAGE,
  digitalHoldRefusal,
  fenceRefusal,
  SELLER_LIMIT_MESSAGE,
  sellerDeclaration,
  sellerUnavailableToPrivateOnlyBuyers,
} from '@/libs/commerce/eu-region';
import { getDigitalRegionBlockEnabled, getEuFenceEnabled } from '@/libs/runtime-config/runtime-config';

export interface RegionAvailability {
  /** Either region flag is on. */
  enabled: boolean;
  /** The remembered buyer country, or null. */
  buyerCountry: string | null;
  setBuyerCountry: (countryCode: string | null) => void;
  /** The buyer's country is needed and not yet known: show the "Country you live in" prompt. */
  needsCountry: boolean;
  /** Why this buyer cannot buy here, or null. */
  refusal: string | null;
  /** The refusal turns on the remembered country, so the buyer may need to correct it. */
  canChangeCountry: boolean;
  /** Whether this buyer may buy here depends on their country, so the listing keeps it in view. */
  usesCountry: boolean;
  /** The standing digital note on digital-only listings while the digital hold is on. */
  digitalNote: string | null;
}

/**
 * What the EU fence (C3, C4) and the digital hold (C3b) say about one seller's listing for the
 * buyer on this device. Everything is null or false while both flags are off.
 */
export function useRegionAvailability(input: {
  sellerPubky: string;
  shop: { sellerStatus?: string } | null | undefined;
  digital: boolean;
  isOwner?: boolean;
}): RegionAvailability {
  const buyer = useBuyerCountry();
  const fence = getEuFenceEnabled();
  const digitalHold = getDigitalRegionBlockEnabled() && input.digital;
  const annualLimit = useSellerAnnualLimit(fence && !input.isOwner ? input.sellerPubky : null);
  const limitReached = annualLimit.status === 'ready' && annualLimit.limit.limitReached === true;

  const declaration = input.shop ? sellerDeclaration(input.shop) : 'unknown';
  const refusal =
    (fence
      ? fenceRefusal({
          buyerCountry: buyer.country,
          declaration,
          limitReached,
        })
      : null) ?? (digitalHold ? digitalHoldRefusal(buyer.country) : null);

  const shownRefusal = input.isOwner ? null : refusal;

  return {
    enabled: buyer.enabled,
    buyerCountry: buyer.country,
    setBuyerCountry: buyer.setCountry,
    needsCountry: (fence || digitalHold) && buyer.country === null,
    refusal: shownRefusal,
    canChangeCountry: buyer.country !== null && shownRefusal !== null && shownRefusal !== SELLER_LIMIT_MESSAGE,
    usesCountry: !input.isOwner && (digitalHold || (fence && sellerUnavailableToPrivateOnlyBuyers(declaration))),
    digitalNote: digitalHold ? DIGITAL_REGION_MESSAGE : null,
  };
}
