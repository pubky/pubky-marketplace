import {
  BUYING_FROM_BLOCKED_SHOP_MESSAGE,
  COMMERCE_BLOCKED_INFO,
  COMMERCE_BLOCKED_MESSAGE,
  COMMERCE_UNKNOWN_REGION_INFO,
  COMMERCE_UNKNOWN_REGION_MESSAGE,
  PAID_UNLOCKS_BLOCKED_MESSAGE,
  type RegionBlockCause,
  regionBlockCause,
  type RegionPolicy,
  SELLING_BLOCKED_MESSAGE,
  SHOP_COUNTRY_CHECKING_MESSAGE,
  SHOP_COUNTRY_LOCKED_MESSAGE,
  SHOP_COUNTRY_LOCKED_UNKNOWN_MESSAGE,
} from './region-modes';

/** Where the visitor's IP country stands: asked, answered (country or unknown), or not asked at all. */
export type ClientRegionState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; country: string | null };

export type CommerceBlockSource = RegionBlockCause | 'seller';

export interface CommerceAvailability {
  /** A region is blocked or an unknown visitor is, so the Market's commerce surfaces apply the policy. */
  active: boolean;
  /** The visitor's region is still being read: commerce stays off but there is nothing to say yet. */
  checking: boolean;
  /** Commerce is blocked for this visitor. */
  blocked: boolean;
  /** Buying and selling are held: blocked, or still checking. */
  held: boolean;
  source: CommerceBlockSource | null;
  /** The one line that replaces Buy, Offer, Bid, Add to cart and Pay. */
  message: string | null;
  /** The line that replaces the seller studio, Sell, store connections and Get paid. */
  sellingMessage: string | null;
  /** What sits behind the info icon next to either line. */
  info: string | null;
}

export const INERT_COMMERCE_AVAILABILITY: CommerceAvailability = {
  active: false,
  checking: false,
  blocked: false,
  held: false,
  source: null,
  message: null,
  sellingMessage: null,
  info: null,
};

/**
 * What the blocked-region policy says about commerce for one visitor.
 *
 * `declaredCountry` is what the visitor said (the buyer's remembered country) or the shop's own
 * country for a seller. `sellerCountry` is the country of the shop being bought from. Both only ever
 * add a block; the IP country decides whether a visitor from an open country is let through.
 * Nothing is active, and nothing is evaluated, unless the policy blocks a region.
 */
export function evaluateCommerceAvailability(
  policy: RegionPolicy,
  input: {
    declaredCountry: string | null | undefined;
    sellerCountry?: string | null;
    client: ClientRegionState;
  },
): CommerceAvailability {
  if (!policy.usesClientRegion) return INERT_COMMERCE_AVAILABILITY;
  const { client } = input;
  if (client.status === 'off') return INERT_COMMERCE_AVAILABILITY;

  const sellerBlocked = policy.modeOf(input.sellerCountry) === 'blocked';
  let cause: CommerceBlockSource | 'checking' | null;
  if (policy.modeOf(input.declaredCountry) === 'blocked') cause = 'declared';
  else if (client.status === 'loading') cause = sellerBlocked ? 'seller' : 'checking';
  else {
    const ipCountry = client.status === 'ready' ? client.country : null;
    cause = regionBlockCause(policy, { declaredCountry: null, ipCountry }) ?? (sellerBlocked ? 'seller' : null);
  }
  if (cause === 'checking') return { ...INERT_COMMERCE_AVAILABILITY, active: true, checking: true, held: true };
  if (cause === null) return { ...INERT_COMMERCE_AVAILABILITY, active: true };

  const unknown = cause === 'unknown';
  return {
    active: true,
    checking: false,
    blocked: true,
    held: true,
    source: cause,
    message: unknown
      ? COMMERCE_UNKNOWN_REGION_MESSAGE
      : cause === 'seller'
        ? BUYING_FROM_BLOCKED_SHOP_MESSAGE
        : COMMERCE_BLOCKED_MESSAGE,
    sellingMessage: unknown ? COMMERCE_UNKNOWN_REGION_MESSAGE : SELLING_BLOCKED_MESSAGE,
    info: unknown ? COMMERCE_UNKNOWN_REGION_INFO : COMMERCE_BLOCKED_INFO,
  };
}

/**
 * Whether the shop country can be changed from where the visitor is. The rule is the visitor's own
 * region, never the country they would change to: only someone who is outside the block can move a
 * shop out of it. A region that is blocked, or unknown where unknown visitors are blocked, keeps the
 * country as it is; while the region is still being read nothing is changed yet. Nothing is locked
 * while no region is blocked.
 */
export type ShopCountryChange =
  | { status: 'open' }
  | { status: 'checking'; message: string }
  | { status: 'locked'; cause: 'ip' | 'unknown'; message: string };

export function evaluateShopCountryChange(policy: RegionPolicy, client: ClientRegionState): ShopCountryChange {
  if (!policy.usesClientRegion || client.status === 'off') return { status: 'open' };
  if (client.status === 'loading') return { status: 'checking', message: SHOP_COUNTRY_CHECKING_MESSAGE };
  const cause = regionBlockCause(policy, {
    declaredCountry: null,
    ipCountry: client.status === 'ready' ? client.country : null,
  });
  if (cause === null) return { status: 'open' };
  if (cause === 'unknown') return { status: 'locked', cause, message: SHOP_COUNTRY_LOCKED_UNKNOWN_MESSAGE };
  return { status: 'locked', cause: 'ip', message: SHOP_COUNTRY_LOCKED_MESSAGE };
}

/** The line for a digital-only listing: a blocked region holds paid unlocks, an unknown one holds everything. */
export function digitalBlockedMessage(availability: CommerceAvailability): string | null {
  if (!availability.blocked) return null;
  return availability.source === 'unknown' ? availability.message : PAID_UNLOCKS_BLOCKED_MESSAGE;
}

/** The country a shop record is in, or null when it names none (a record read without one is not blocked here). */
export function shopCountryCode(shop: { location?: { countryCode?: string } } | null | undefined): string | null {
  return shop?.location?.countryCode ?? null;
}

/**
 * The country a new delivery address starts with. Where no region is blocked it is the browser's, as
 * before. Where one is, the browser's language says nothing about where the buyer is (`en-GB` is read
 * as the United Kingdom by someone in Switzerland), and a wrong guess ends in a refusal at Pay, so the
 * address starts with the country the visitor's IP is in when that is not blocked, and otherwise with
 * none: the buyer picks it. While the IP country is still being read there is none yet.
 */
export function addressCountryDefault(policy: RegionPolicy, client: ClientRegionState, browserCountry: string): string {
  if (!policy.usesClientRegion) return browserCountry;
  if (client.status !== 'ready' || client.country === null) return '';
  return policy.modeOf(client.country) === 'blocked' ? '' : client.country;
}
