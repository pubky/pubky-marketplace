import type { ListingCurrencyCode } from '@/config/currencies';

/** The default every unrecognised or missing locale resolves to. */
export const DEFAULT_DISPLAY_CURRENCY: ListingCurrencyCode = 'USD';

/** Euro-area member states (ISO 3166-1 alpha-2). */
const EUROZONE_REGIONS: ReadonlySet<string> = new Set([
  'AT',
  'BE',
  'CY',
  'DE',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PT',
  'SI',
  'SK',
]);

/** A region's own currency where the registry has one other than the euro. */
const REGION_CURRENCIES: Readonly<Record<string, ListingCurrencyCode>> = {
  CH: 'CHF',
  LI: 'CHF',
  GB: 'GBP',
  JP: 'JPY',
  CA: 'CAD',
  AU: 'AUD',
  US: 'USD',
};

/**
 * Languages spoken (almost) only in one currency area, used when a locale
 * names no region ("ja", "de"). Languages that span currencies ("fr", "es",
 * "pt", "en") are deliberately absent: without a region they say nothing.
 */
const LANGUAGE_CURRENCIES: Readonly<Record<string, ListingCurrencyCode>> = {
  ja: 'JPY',
  de: 'EUR',
  nl: 'EUR',
  fi: 'EUR',
  el: 'EUR',
  et: 'EUR',
  lv: 'EUR',
  lt: 'EUR',
  sk: 'EUR',
  sl: 'EUR',
  mt: 'EUR',
};

function currencyForLocale(tag: string): ListingCurrencyCode | null {
  let language: string;
  let region: string | undefined;
  try {
    const locale = new Intl.Locale(tag);
    language = locale.language;
    region = locale.region;
  } catch {
    return null;
  }
  if (region) {
    const regional = REGION_CURRENCIES[region];
    if (regional) return regional;
    if (EUROZONE_REGIONS.has(region)) return 'EUR';
    // A region this app has no currency for (BR, IN, SE): say nothing, not "USD".
    return null;
  }
  return LANGUAGE_CURRENCIES[language] ?? null;
}

/**
 * The display currency to start a buyer on, from the browser's language list
 * (`navigator.languages`, most preferred first). The first locale that names a
 * region with a listing currency, or a language bound to one, decides: de-CH,
 * fr-CH and it-CH give CHF; eurozone regions EUR; en-GB GBP; ja and ja-JP JPY;
 * en-CA and fr-CA CAD; en-AU AUD; en-US USD. Anything else, and an empty or
 * malformed list, gives USD. A buyer's explicit choice is stored elsewhere and
 * always wins over this.
 */
export function displayCurrencyForLocales(languages: readonly string[] | null | undefined): ListingCurrencyCode {
  for (const tag of languages ?? []) {
    const currency = currencyForLocale(tag);
    if (currency) return currency;
  }
  return DEFAULT_DISPLAY_CURRENCY;
}
