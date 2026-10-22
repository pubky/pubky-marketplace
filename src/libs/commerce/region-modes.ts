import { EU_27 } from './eu-region';

/**
 * Per-region commerce modes. One setting names the mode of each region, and every Shop surface
 * asks this module instead of reading flags:
 *
 * - `open`: no commerce restriction.
 * - `nuanced`: the EU fence (C3, C4) and the digital hold (C3b), exactly as before.
 * - `blocked`: no buying, no selling and no paid unlocks for people in the region.
 *
 * Grammar: a comma-separated list of `SELECTOR=MODE`. A selector is an ISO 3166-1 alpha-2 code,
 * `EU` (the 27 member states) or `UNKNOWN` (a visitor whose country can't be determined). Later
 * entries override earlier ones, so `EU=nuanced,DE=blocked` works. `none` alone means everything
 * is open. Countries nobody names are open. `UNKNOWN` defaults to the strictest mode in force.
 *
 * This module is pure (no IO, no config reads) and imports nothing but the EU-27 list, so the
 * runtime-config schema can validate the setting with the same parser the Shop evaluates it with.
 */

export const REGION_MODE_VALUES = ['open', 'nuanced', 'blocked'] as const;
export type RegionMode = (typeof REGION_MODE_VALUES)[number];

export const REGION_MODES_NONE = 'none';
export const REGION_SELECTOR_EU = 'EU';
export const REGION_SELECTOR_UNKNOWN = 'UNKNOWN';

const STRICTNESS: Readonly<Record<RegionMode, number>> = { open: 0, nuanced: 1, blocked: 2 };

export interface RegionModeEntry {
  /** An uppercase alpha-2 code, `EU` or `UNKNOWN`. */
  selector: string;
  mode: RegionMode;
}

export type RegionModesParseResult =
  | {
      ok: true;
      entries: readonly RegionModeEntry[];
      /** The setting rewritten in canonical case and spacing; `none` for an empty list. */
      canonical: string;
    }
  | { ok: false; error: string };

function isRegionMode(value: string): value is RegionMode {
  return (REGION_MODE_VALUES as readonly string[]).includes(value);
}

function fail(error: string): RegionModesParseResult {
  return { ok: false, error };
}

/** Parses the `SELECTOR=MODE` list. Malformed input is rejected, never guessed at. */
export function parseRegionModes(raw: string): RegionModesParseResult {
  const text = raw.trim();
  if (text === '') return fail('expected a list like EU=blocked,US=blocked, or "none"');
  if (text.toLowerCase() === REGION_MODES_NONE) return { ok: true, entries: [], canonical: REGION_MODES_NONE };

  const entries: RegionModeEntry[] = [];
  for (const item of text.split(',')) {
    const parts = item.split('=');
    if (parts.length !== 2) return fail(`${JSON.stringify(item.trim())} is not SELECTOR=MODE`);
    const selector = parts[0].trim().toUpperCase();
    const mode = parts[1].trim().toLowerCase();
    if (selector === 'UK') return fail('UK is not an ISO code; use GB');
    if (selector !== REGION_SELECTOR_EU && selector !== REGION_SELECTOR_UNKNOWN && !/^[A-Z]{2}$/.test(selector)) {
      return fail(`${JSON.stringify(parts[0].trim())} is not a two-letter country code, EU or UNKNOWN`);
    }
    if (!isRegionMode(mode)) {
      return fail(`${JSON.stringify(parts[1].trim())} is not a mode: use ${REGION_MODE_VALUES.join(', ')}`);
    }
    entries.push({ selector, mode });
  }
  return { ok: true, entries, canonical: entries.map((entry) => `${entry.selector}=${entry.mode}`).join(',') };
}

export interface RegionPolicy {
  /** Every country that is not open, with its mode (`GB` stands in for the `UK` alias). */
  readonly regions: ReadonlyMap<string, RegionMode>;
  /** The mode of a visitor whose country can't be determined. */
  readonly unknownMode: RegionMode;
  /** Some region is nuanced: today's fence and digital hold apply to buyers there. */
  readonly hasNuanced: boolean;
  /** Some region is blocked. */
  readonly hasBlocked: boolean;
  /** Every country is open and so is an unknown visitor: nothing in the Shop changes. */
  readonly allOpen: boolean;
  /** C3 and C4 are on for nuanced regions. */
  readonly fenceActive: boolean;
  /** C3b is on for nuanced regions. */
  readonly digitalHoldActive: boolean;
  /** The visitor's IP country matters: a region is blocked, or an unknown visitor is. */
  readonly usesClientRegion: boolean;
  /** The country a person declared (or the shop's own); nobody and `UK` are handled here. */
  modeOf: (country: string | null | undefined) => RegionMode;
}

export interface RegionPolicyOptions {
  /** C3 and C4 in nuanced regions. Default on. */
  fence?: boolean;
  /** C3b in nuanced regions. Default on. */
  digitalHold?: boolean;
}

function normalizeCountry(country: string | null | undefined): string | null {
  if (country === null || country === undefined) return null;
  const code = country.trim().toUpperCase();
  if (code === '') return null;
  return code === 'UK' ? 'GB' : code;
}

export function createRegionPolicy(
  entries: readonly RegionModeEntry[],
  options: RegionPolicyOptions = {},
): RegionPolicy {
  const regions = new Map<string, RegionMode>();
  let explicitUnknown: RegionMode | null = null;
  for (const { selector, mode } of entries) {
    if (selector === REGION_SELECTOR_UNKNOWN) explicitUnknown = mode;
    else if (selector === REGION_SELECTOR_EU) for (const code of EU_27) regions.set(code, mode);
    else regions.set(selector, mode);
  }
  for (const [code, mode] of regions) if (mode === 'open') regions.delete(code);

  const modes = [...regions.values()];
  const hasNuanced = modes.includes('nuanced');
  const hasBlocked = modes.includes('blocked');
  const strictest = modes.reduce<RegionMode>(
    (current, mode) => (STRICTNESS[mode] > STRICTNESS[current] ? mode : current),
    'open',
  );
  const unknownMode = explicitUnknown ?? strictest;

  return {
    regions,
    unknownMode,
    hasNuanced,
    hasBlocked,
    allOpen: regions.size === 0 && unknownMode === 'open',
    fenceActive: hasNuanced && options.fence !== false,
    digitalHoldActive: hasNuanced && options.digitalHold !== false,
    usesClientRegion: hasBlocked || unknownMode === 'blocked',
    modeOf: (country) => {
      const code = normalizeCountry(country);
      return code === null ? 'open' : (regions.get(code) ?? 'open');
    },
  };
}

/**
 * The policy a deployment runs. With the setting unset it is derived from the two older flags,
 * exactly as before: the EU and GB are nuanced, with C3 and C4 following the fence flag and C3b
 * following the digital flag, and nothing is restricted when both are off. Once the setting is
 * set it wins and the flags are ignored.
 */
export function resolveRegionPolicy(input: {
  regionModes?: string | undefined;
  euFenceEnabled: boolean;
  digitalRegionBlockEnabled: boolean;
}): RegionPolicy {
  if (input.regionModes !== undefined) {
    const parsed = parseRegionModes(input.regionModes);
    return createRegionPolicy(parsed.ok ? parsed.entries : []);
  }
  if (!input.euFenceEnabled && !input.digitalRegionBlockEnabled) return createRegionPolicy([]);
  return createRegionPolicy(
    [
      { selector: REGION_SELECTOR_EU, mode: 'nuanced' },
      { selector: 'GB', mode: 'nuanced' },
    ],
    { fence: input.euFenceEnabled, digitalHold: input.digitalRegionBlockEnabled },
  );
}

/** The country, when its region is nuanced, so today's EU and UK rules can read it; otherwise null. */
export function nuancedCountry(policy: RegionPolicy, country: string | null | undefined): string | null {
  return country !== null && country !== undefined && policy.modeOf(country) === 'nuanced' ? country : null;
}

/**
 * Why a person is blocked from commerce: their declared country (or the shop's own) is blocked,
 * their IP country is blocked, or their IP country is unknown and an unknown visitor is blocked.
 * `ipCountry` null means unknown. The declared country is never verified, so it can only add a
 * block: declaring Switzerland from a blocked IP changes nothing.
 */
export type RegionBlockCause = 'declared' | 'ip' | 'unknown';

export function regionBlockCause(
  policy: RegionPolicy,
  input: { declaredCountry: string | null | undefined; ipCountry: string | null },
): RegionBlockCause | null {
  if (policy.modeOf(input.declaredCountry) === 'blocked') return 'declared';
  if (input.ipCountry === null) return policy.unknownMode === 'blocked' ? 'unknown' : null;
  return policy.modeOf(input.ipCountry) === 'blocked' ? 'ip' : null;
}

export const COMMERCE_BLOCKED_MESSAGE = "Buying and selling aren't available in your region yet.";
export const SELLING_BLOCKED_MESSAGE = "Selling isn't available in your region yet.";
export const COMMERCE_UNKNOWN_REGION_MESSAGE = "We can't tell where you are, so buying and selling are paused.";
export const PAID_UNLOCKS_BLOCKED_MESSAGE = "Paid unlocks aren't available in your region yet.";
export const SELLING_BLOCKED_COUNTRY_MESSAGE = "Selling isn't available from this country yet.";
/** The buyer's side of a shop in a blocked country: the line says buying, not selling. */
export const BUYING_FROM_BLOCKED_SHOP_MESSAGE = "Buying from this shop isn't available yet.";

export const COMMERCE_BLOCKED_INFO_LABEL = 'About this limit';
export const COMMERCE_BLOCKED_INFO = 'You can still browse the Market. Everything else in Pubky works as usual.';
export const COMMERCE_UNKNOWN_REGION_INFO =
  "Buying and selling depend on where you are, and we couldn't read your location. You can still browse the Market. Everything else in Pubky works as usual.";

export const BACK_TO_MARKET_LABEL = 'Back to the Market';

/** Said under the shop country field while the visitor's region can't be shown to be outside the block. */
export const SHOP_COUNTRY_LOCKED_MESSAGE =
  'You can change your shop country only from a region where selling is offered.';
export const SHOP_COUNTRY_LOCKED_UNKNOWN_MESSAGE =
  "We can't tell where you are, so your shop country can't be changed right now.";
export const SHOP_COUNTRY_CHECKING_MESSAGE = 'Checking where you are before your shop country can be changed.';

/** Said after the selling line when the seller's own shop country is the reason, with a link to the field. */
export const SELLING_MOVED_PREFIX = "If you've moved, ";
export const SELLING_MOVED_LINK_LABEL = 'update your shop country';
/** The same hint on the shop settings page, where the field is right below. */
export const SELLING_MOVED_ON_SHOP_SETTINGS = "If you've moved, update your shop country below.";
/** Said on the shop settings page when the visitor's own region is the reason: the details can still change. */
export const SELLING_PAUSED_NOTE =
  "You can still update your shop here. Selling stays paused until you're in a region where it's offered.";
