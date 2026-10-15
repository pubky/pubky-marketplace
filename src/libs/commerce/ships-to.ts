import { COMMERCE_SHOP_SHIPS_TO_MAX_COUNTRIES } from '@/config/commerce';
import { canonicalCountryCode, NON_COUNTRY_REGION } from '@/libs/commerce/postal-address';

/**
 * A shop's destination restriction: null when `shipsToCountries` is absent or
 * empty (ships anywhere), the two-letter codes when it lists any, and
 * undefined when it is present but lists none (["CHE"]). Undefined is a
 * restriction that cannot be resolved, refused like an unreadable shop.
 */
export function shopShipsToRestriction(
  shop: { shipsToCountries?: readonly string[] } | null | undefined,
): readonly string[] | null | undefined {
  const entries = shop?.shipsToCountries;
  if (!entries || entries.length === 0) return null;
  const codes = entries.filter((entry) => /^[A-Z]{2}$/.test(entry));
  return codes.length > 0 ? codes : undefined;
}

/** The countries to show buyers as "Ships to": null when the shop ships anywhere or its list is unusable. */
export function shopShipsToCountries(
  shop: { shipsToCountries?: readonly string[] } | null | undefined,
): readonly string[] | null {
  return shopShipsToRestriction(shop) ?? null;
}

/**
 * Where one checkout's delivery address may be, across its shipped sellers.
 * `countries` null means anywhere; `restrictingSellers` counts the sellers
 * that set a list. `unavailable` means a seller's shop could not be read, so
 * the destination cannot be confirmed.
 */
export type ShipsToDestinations =
  | { status: 'ready'; countries: string[] | null; restrictingSellers: number }
  | { status: 'loading' }
  | { status: 'unavailable' };

export const SHIPS_TO_ANYWHERE: ShipsToDestinations = { status: 'ready', countries: null, restrictingSellers: 0 };
export const SHIPS_TO_LOADING: ShipsToDestinations = { status: 'loading' };

export const SHIPS_TO_UNAVAILABLE_MESSAGE =
  'We couldn’t confirm where this seller ships. Reload the page to try again, or choose pickup if offered.';

/** Combines each shipped seller's list (undefined: unreadable) into the checkout's destinations. */
export function shipsToDestinations(lists: ReadonlyArray<readonly string[] | null | undefined>): ShipsToDestinations {
  if (lists.some((list) => list === undefined)) return { status: 'unavailable' };
  const known = lists as ReadonlyArray<readonly string[] | null>;
  return {
    status: 'ready',
    countries: intersectShipsToCountries(known),
    restrictingSellers: known.filter((list) => list !== null).length,
  };
}

/** The refusal for a destination country, or null when the address may be used. */
export function destinationCountryError(countryCode: string, destinations: ShipsToDestinations): string | null {
  if (destinations.status === 'unavailable') return SHIPS_TO_UNAVAILABLE_MESSAGE;
  if (destinations.status === 'loading') return null;
  if (isDestinationAllowed(countryCode, destinations.countries)) return null;
  return destinationRefusalMessage(destinations.countries ?? [], destinations.restrictingSellers);
}

/**
 * The countries one delivery address may be in when it serves every listed
 * seller: the intersection of their lists. Null when no seller restricts
 * destinations; empty when the restricting sellers share no country.
 */
export function intersectShipsToCountries(lists: ReadonlyArray<readonly string[] | null>): string[] | null {
  let allowed: string[] | null = null;
  for (const list of lists) {
    if (list === null) continue;
    allowed = allowed === null ? [...list] : allowed.filter((code) => list.includes(code));
  }
  return allowed;
}

/** Both sides are canonicalized, so a UK address matches a GB list and a GB address a UK list. */
export function isDestinationAllowed(countryCode: string, allowed: readonly string[] | null): boolean {
  if (allowed === null) return true;
  const country = canonicalCountryCode(countryCode);
  return allowed.some((code) => canonicalCountryCode(code) === country);
}

/** The English name of a country code, or the code itself when the runtime knows no name for it. */
export function countryDisplayName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** "Switzerland", "Switzerland and Liechtenstein", "Austria, Germany, and Switzerland". */
export function formatShipsToCountries(codes: readonly string[]): string {
  return new Intl.ListFormat('en', { type: 'conjunction' }).format(codes.map(countryDisplayName));
}

/**
 * Why a delivery address cannot be used. `allowed` empty means the sellers
 * in this checkout share no destination country.
 */
export function destinationRefusalMessage(allowed: readonly string[], sellerCount: number): string {
  if (allowed.length === 0) {
    return 'The sellers in this checkout don’t ship to a common country. Check out their items separately, or choose pickup if offered.';
  }
  const who = sellerCount > 1 ? 'The sellers in this checkout ship' : 'This seller ships';
  return `${who} only to ${formatShipsToCountries(allowed)}. Choose pickup if offered.`;
}

/**
 * A canonical two-letter code naming a real country or territory: not a
 * user-assigned or macro-region code, and not an alias such as UK (GB).
 */
export function isAssignedCountryCode(code: string): boolean {
  if (!/^[A-Z]{2}$/.test(code) || NON_COUNTRY_REGION.test(code)) return false;
  if (canonicalCountryCode(code) !== code) return false;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }).of(code) !== undefined;
  } catch {
    return true;
  }
}

/**
 * Splits the settings field ("CH, LI" or "ch li") into canonical uppercase
 * codes (UK is saved as GB), each kept once in entry order.
 */
export function parseShipsToField(value: string): string[] {
  const codes = value
    .split(/[\s,;]+/)
    .map(canonicalCountryCode)
    .filter((code) => code !== '');
  return [...new Set(codes)];
}

/** The settings field's validation message, or null when the entry is usable (empty means anywhere). */
export function shipsToFieldError(value: string): string | null {
  const codes = parseShipsToField(value);
  const invalid = codes.filter((code) => !isAssignedCountryCode(code));
  if (invalid.length > 0) {
    return `Not a two-letter country code: ${invalid.join(', ')}.`;
  }
  if (codes.length > COMMERCE_SHOP_SHIPS_TO_MAX_COUNTRIES) {
    return `List at most ${COMMERCE_SHOP_SHIPS_TO_MAX_COUNTRIES} countries.`;
  }
  return null;
}
