import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import {
  quoteAllShippingRates,
  quoteShipping,
  type ShippingQuote,
  type ShippingQuoteErrorCode,
  type ShippingZone,
} from '@/libs/commerce/shipping-zones';
import { buildMarketplaceListingAggregateId } from '@/libs/commerce/transaction-commands';

/**
 * How a listing is priced for shipping, when it is priced by zones: by the
 * seller's profile, or by zones of its own. A listing with neither ships at
 * the flat rate of its `shippingOptions`, per line, as it always did.
 */
export type ZonePricing = { kind: 'profile'; profileId: string } | { kind: 'inline'; zones: ShippingZone[] };

export function listingZonePricing(
  record: Pick<CommerceListingRecord, 'shippingProfileId' | 'shippingZones'>,
): ZonePricing | null {
  if (record.shippingProfileId !== undefined) return { kind: 'profile', profileId: record.shippingProfileId };
  if (record.shippingZones !== undefined) return { kind: 'inline', zones: record.shippingZones };
  return null;
}

export type ZonedLine = {
  id: string;
  sellerPubky: string;
  listingId: string;
  quantity: number;
  pricing: ZonePricing | null;
};

/**
 * One shipping group of a seller's order: the lines that share a profile, or
 * the one listing whose inline zones price it. The group is quoted as a whole
 * under one rate the buyer picks, so `per_item` rates count its units across
 * lines and `flat` rates charge once.
 */
export type ShippingGroup = {
  key: string;
  sellerPubky: string;
  profileId?: string;
  listingAggregateId?: string;
  units: number;
  lineIds: string[];
  zones?: ShippingZone[];
};

export function shippingGroupKey(sellerPubky: string, pricing: ZonePricing, listingAggregateId: string): string {
  return pricing.kind === 'profile' ? `profile:${sellerPubky}:${pricing.profileId}` : `inline:${listingAggregateId}`;
}

/** The zone-priced groups among the shipped lines, in first-seen order; flat lines belong to none. */
export function shippingGroups(lines: readonly ZonedLine[]): ShippingGroup[] {
  const groups = new Map<string, ShippingGroup>();
  for (const line of lines) {
    if (line.pricing === null) continue;
    const listingAggregateId = buildMarketplaceListingAggregateId(line.sellerPubky, line.listingId);
    const key = shippingGroupKey(line.sellerPubky, line.pricing, listingAggregateId);
    const existing = groups.get(key);
    if (existing) {
      existing.units += line.quantity;
      existing.lineIds.push(line.id);
      continue;
    }
    groups.set(key, {
      key,
      sellerPubky: line.sellerPubky,
      ...(line.pricing.kind === 'profile'
        ? { profileId: line.pricing.profileId }
        : { listingAggregateId, zones: line.pricing.zones }),
      units: line.quantity,
      lineIds: [line.id],
    });
  }
  return [...groups.values()];
}

/** The zones and exclusions that price a group, with the digest of the profile bytes they were read from. */
export type GroupRateCard = {
  zones: readonly ShippingZone[];
  excludedCountries: readonly string[];
  profileSha256?: string;
};

export type GroupOptions =
  | { status: 'ready'; quotes: ShippingQuote[] }
  | { status: 'refused'; code: ShippingQuoteErrorCode };

export function groupOptions(group: ShippingGroup, card: GroupRateCard, destination: string): GroupOptions {
  const quotes = quoteAllShippingRates(card.zones, card.excludedCountries, destination, group.units);
  return quotes.ok ? { status: 'ready', quotes: quotes.value } : { status: 'refused', code: quotes.code };
}

/** The buyer's pick when it still exists, otherwise the cheapest rate, first in the zone's order on a tie. */
export function selectedRateId(quotes: readonly ShippingQuote[], picked: string | undefined): string | undefined {
  if (picked !== undefined && quotes.some(({ rateId }) => rateId === picked)) return picked;
  let cheapest: ShippingQuote | undefined;
  for (const quote of quotes) {
    if (cheapest === undefined || quote.amountMinor < cheapest.amountMinor) cheapest = quote;
  }
  return cheapest?.rateId;
}

/** One group's rate as the checkout command carries it. */
export type ShippingChoicePayload = {
  sellerPubky: string;
  rateId: string;
  profileId?: string;
  listingAggregateId?: string;
  profileSha256?: string;
};

export function shippingChoicePayload(
  group: ShippingGroup,
  rateId: string,
  card: Pick<GroupRateCard, 'profileSha256'>,
): ShippingChoicePayload {
  if (group.profileId !== undefined) {
    if (card.profileSha256 === undefined) throw new TypeError('A profile choice needs the digest of the profile read.');
    return {
      sellerPubky: group.sellerPubky,
      profileId: group.profileId,
      rateId,
      profileSha256: card.profileSha256,
    };
  }
  return { sellerPubky: group.sellerPubky, listingAggregateId: group.listingAggregateId, rateId };
}

/** The amount one group charges under a rate, or a refusal code. */
export function groupAmount(
  group: ShippingGroup,
  card: GroupRateCard,
  destination: string,
  rateId: string,
): ShippingQuote | ShippingQuoteErrorCode {
  const quote = quoteShipping(card.zones, card.excludedCountries, destination, rateId, group.units);
  return quote.ok ? quote.value : quote.code;
}
