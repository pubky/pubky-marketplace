'use client';

import { useBuyerCountry } from '@/hooks/useBuyerCountry/useBuyerCountry';
import { useCommerceAvailability } from '@/hooks/useCommerceAvailability/useCommerceAvailability';
import { useSellerAnnualLimit } from '@/hooks/useSellerAnnualLimit/useSellerAnnualLimit';
import {
  type CommerceAvailability,
  digitalBlockedMessage,
  shopCountryCode,
} from '@/libs/commerce/commerce-availability';
import {
  DIGITAL_REGION_MESSAGE,
  digitalHoldRefusal,
  fenceRefusal,
  SELLER_LIMIT_MESSAGE,
  sellerDeclaration,
  sellerUnavailableToPrivateOnlyBuyers,
} from '@/libs/commerce/eu-region';
import { nuancedCountry } from '@/libs/commerce/region-modes';
import { getRegionPolicy } from '@/libs/runtime-config/runtime-config';

export interface RegionAvailability {
  /** Some region is nuanced or blocked. */
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

export interface ListingRegionAvailability extends RegionAvailability {
  /** Commerce is blocked for this visitor (or the seller's country): buying is replaced by `blockedMessage`. */
  commerce: CommerceAvailability;
  /** The one line, and the text behind its info icon, that replace Buy, Offer and Bid while commerce is blocked. */
  blockedNotice: { message: string; info: string } | null;
}

/**
 * What the region policy says about one seller's listing for the buyer on this device: the EU fence
 * (C3, C4) and the digital hold (C3b) in nuanced regions, and the blocked state in blocked ones.
 * Everything is null or false while every region is open.
 */
export function useRegionAvailability(input: {
  sellerPubky: string;
  shop: { sellerStatus?: string; location?: { countryCode?: string } } | null | undefined;
  digital: boolean;
  isOwner?: boolean;
}): ListingRegionAvailability {
  const buyer = useBuyerCountry();
  const policy = getRegionPolicy();
  const fence = policy.fenceActive;
  const digitalHold = policy.digitalHoldActive && input.digital;
  const commerce = useCommerceAvailability({
    sellerCountry: input.isOwner ? null : shopCountryCode(input.shop),
  });
  const buyerCountry = nuancedCountry(policy, buyer.country);
  const annualLimit = useSellerAnnualLimit(fence && !input.isOwner ? input.sellerPubky : null);
  const limitReached = annualLimit.status === 'ready' && annualLimit.limit.limitReached === true;

  const declaration = input.shop ? sellerDeclaration(input.shop) : 'unknown';
  const refusal =
    (fence
      ? fenceRefusal({
          buyerCountry,
          declaration,
          limitReached,
        })
      : null) ?? (digitalHold ? digitalHoldRefusal(buyerCountry) : null);

  const shownRefusal = input.isOwner || commerce.blocked ? null : refusal;

  return {
    enabled: buyer.enabled,
    buyerCountry: buyer.country,
    setBuyerCountry: buyer.setCountry,
    needsCountry: !commerce.blocked && (fence || digitalHold) && buyer.country === null,
    refusal: shownRefusal,
    canChangeCountry: buyer.country !== null && shownRefusal !== null && shownRefusal !== SELLER_LIMIT_MESSAGE,
    usesCountry: !input.isOwner && (digitalHold || (fence && sellerUnavailableToPrivateOnlyBuyers(declaration))),
    digitalNote: digitalHold ? DIGITAL_REGION_MESSAGE : null,
    commerce,
    blockedNotice: blockedNotice(commerce, input.digital),
  };
}

function blockedNotice(commerce: CommerceAvailability, digital: boolean): ListingRegionAvailability['blockedNotice'] {
  const message = digital ? digitalBlockedMessage(commerce) : commerce.message;
  return message !== null && commerce.info !== null ? { message, info: commerce.info } : null;
}
