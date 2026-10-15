import { DEFAULT_SHOP_COUNTRY_CODE } from './default-shop';

/**
 * Import settings, applied to every row of a shop-system CSV. The listing
 * currency list is not defined here: the dry-run form reads it from the
 * listing schema so the import follows whatever currencies the Shop offers.
 */

export const IMPORT_CONDITIONS = ['new', 'like_new', 'excellent', 'good', 'fair', 'for_parts'] as const;
export type ImportCondition = (typeof IMPORT_CONDITIONS)[number];
export const IMPORT_CONDITIONS_SET: ReadonlySet<string> = new Set(IMPORT_CONDITIONS);

export type ImportShipping =
  | { readonly mode: 'free'; readonly minDays: number; readonly maxDays: number }
  | { readonly mode: 'flat'; readonly priceMinor: number; readonly minDays: number; readonly maxDays: number };

export type ImportSettings = {
  readonly currency: string;
  readonly countryCode: string;
  readonly condition: ImportCondition;
  readonly shipping: ImportShipping;
  /** Shopify: take the CSV "Inventory quantity" as each variant's total stock. */
  readonly useCsvQuantities: boolean;
  /** WooCommerce: stock for a product that is in stock but has no count. */
  readonly unmanagedStock: number;
};

export const DEFAULT_IMPORT_SETTINGS: ImportSettings = {
  currency: 'USD',
  countryCode: DEFAULT_SHOP_COUNTRY_CODE,
  condition: 'new',
  shipping: { mode: 'free', minDays: 3, maxDays: 10 },
  useCsvQuantities: false,
  unmanagedStock: 1,
};

const FIXED_EXPONENTS: Readonly<Record<string, number>> = { BTC: 8, SATS: 0 };

/** ISO 4217 minor-unit exponent (JPY 0, USD 2); BTC is priced in base units at exponent 8, as the Shop writes it. */
export function currencyExponent(currency: string): number {
  const fixed = FIXED_EXPONENTS[currency];
  if (fixed !== undefined) return fixed;
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/**
 * Exact decimal-to-minor-units conversion with no rounding: a price with more
 * fraction digits than the currency allows (other than trailing zeros) is not
 * representable and returns `null`, so money is never changed silently.
 */
export function majorToMinor(value: string, exponent: number): number | null {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!match) return null;
  const whole = match[1] as string;
  const fraction = match[2] ?? '';
  const extra = fraction.slice(exponent);
  if (/[^0]/.test(extra)) return null;
  const digits = `${whole}${fraction.slice(0, exponent).padEnd(exponent, '0')}`;
  const minor = Number(digits);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Re-express minor units at another exponent; `null` when that would drop non-zero digits. */
export function rescaleMinor(amountMinor: number, fromExponent: number, toExponent: number): number | null {
  if (fromExponent === toExponent) return amountMinor;
  if (toExponent > fromExponent) {
    const scaled = amountMinor * 10 ** (toExponent - fromExponent);
    return Number.isSafeInteger(scaled) ? scaled : null;
  }
  const divisor = 10 ** (fromExponent - toExponent);
  return amountMinor % divisor === 0 ? amountMinor / divisor : null;
}

/** The exponent the SDK Shopify mapper must run at so that every price it accepts can be rescaled afterwards. */
export function shopifyWorkExponent(currency: string): number {
  return Math.max(currencyExponent(currency), 2);
}

export function shippingOptionRow(settings: ImportSettings): Record<string, unknown> {
  const estimate = { estimatedMinDays: settings.shipping.minDays, estimatedMaxDays: settings.shipping.maxDays };
  if (settings.shipping.mode === 'free') {
    return { id: 'standard', pricing: 'free', label: 'Free shipping', ...estimate };
  }
  return {
    id: 'standard',
    pricing: 'flat',
    label: 'Standard shipping',
    price: {
      amountMinor: settings.shipping.priceMinor,
      currency: settings.currency,
      exponent: currencyExponent(settings.currency),
    },
    ...estimate,
  };
}
