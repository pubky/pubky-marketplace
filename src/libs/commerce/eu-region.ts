/**
 * The facts the EU scope fence (legal launch plan C1-C4) and the digital hold
 * (C3b) turn on, kept in one place so the Shop, its tests and the service agree.
 *
 * The EU-27 are the member states as ISO 3166-1 alpha-2 codes (Greece is `GR`).
 * The United Kingdom is not a member but takes part in the digital hold (C3b).
 */
export const EU_27 = [
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
] as const;

const EU_SET: ReadonlySet<string> = new Set(EU_27);

export function isEuCountry(countryCode: string | null | undefined): boolean {
  return countryCode !== null && countryCode !== undefined && EU_SET.has(countryCode.toUpperCase());
}

/** Countries whose buyers cannot have digital items at launch (C3b). */
export function isDigitalHeldCountry(countryCode: string | null | undefined): boolean {
  if (countryCode === null || countryCode === undefined) return false;
  const code = countryCode.toUpperCase();
  return EU_SET.has(code) || code === 'GB' || code === 'UK';
}

/**
 * What a seller declared in their own shop record: `undeclared` when the field is absent, and
 * `unknown` when the shop record could not be read at all, so nothing is known about the seller.
 */
export type SellerDeclaration = 'private' | 'trader' | 'undeclared' | 'unknown';

export function sellerDeclaration(shop: { sellerStatus?: string } | null | undefined): SellerDeclaration {
  return shop?.sellerStatus === 'private' || shop?.sellerStatus === 'trader' ? shop.sellerStatus : 'undeclared';
}

/**
 * A business or undeclared seller does not sell to buyers in the EU while the fence is on. An
 * unknown seller is not blocked here: a failed read says nothing about them, and the service
 * decides from the record it reads itself.
 */
export function sellerUnavailableToEuBuyers(declaration: SellerDeclaration): boolean {
  return declaration === 'trader' || declaration === 'undeclared';
}

export const EU_UNAVAILABLE_MESSAGE = 'Not available to buyers in the EU';
export const DIGITAL_REGION_MESSAGE = 'Digital items aren’t available to buyers in the EU or UK yet';
export const SELLER_LIMIT_MESSAGE = 'This seller isn’t taking new orders right now.';
export const BUYER_COUNTRY_PROMPT = 'Country you live in';

/**
 * The refusal for one seller and one buyer country under the fence, or null.
 * `limitReached` is the seller's annual-limit state from the service.
 */
export function fenceRefusal(input: {
  buyerCountry: string | null;
  declaration: SellerDeclaration;
  limitReached?: boolean;
}): string | null {
  if (input.limitReached) return SELLER_LIMIT_MESSAGE;
  if (isEuCountry(input.buyerCountry) && sellerUnavailableToEuBuyers(input.declaration)) {
    return EU_UNAVAILABLE_MESSAGE;
  }
  return null;
}

/** The refusal for a digital line and a buyer country under the C3b hold, or null. */
export function digitalHoldRefusal(buyerCountry: string | null): string | null {
  return isDigitalHeldCountry(buyerCountry) ? DIGITAL_REGION_MESSAGE : null;
}

/** The consumer-law lines of legal launch plan C5 (CRD 6a, UCPD 7(4a) and 7(6)). */
export const PRIVATE_SELLER_NOTICE =
  'Sold by a private individual. EU consumer rights that apply to purchases from businesses, such as the 14-day right of withdrawal, don’t apply to this purchase.';
export const ROLE_STATEMENT =
  'Sales are between you and the seller. Synonym provides the software, is not a party to the sale and has no role in disputes.';
export const RANKING_LINE =
  'With all sale types shown, Recommended mixes fixed-price listings, auctions and drops in turn. Listings are ordered by when they were last updated, with new or excellent-condition items placed slightly higher; drops are ordered live first, then upcoming, then ended. You can also sort by newest, price or ending soonest. No placement is paid for, and ratings don’t affect order.';
export const VERIFIED_PURCHASE_LINE =
  'Verified purchase: the reviewer’s order with this seller was delivered or completed, as attested by the transaction service. Other reviews are labelled unverified.';

export const SELLER_STATUS_COPY = {
  private: {
    label: 'Private seller',
    choice: 'I sell as a private individual',
    detail: 'You sell your own belongings and don’t trade as a business.',
  },
  trader: {
    label: 'Business seller',
    choice: 'I sell as a business',
    detail: 'You sell in the course of a trade, business or profession.',
  },
} as const;
