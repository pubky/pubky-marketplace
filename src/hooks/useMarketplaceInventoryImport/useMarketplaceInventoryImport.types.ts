import { z } from 'zod';
import { COMMERCE_LISTING_MAX_QUANTITY } from '@/config/commerce';
import { createMarketplaceListingSchema } from '@/hooks/useCreateMarketplaceListing/useCreateMarketplaceListing.types';
import {
  currencyExponent,
  type ImportSettings,
  type ImportShipping,
  majorToMinor,
} from '@/pipes/commerce/import-settings';

export const IMPORT_SETTINGS_FIELDS = {
  CURRENCY: 'currency',
  COUNTRY_CODE: 'countryCode',
  CONDITION: 'condition',
  SHIPPING_MODE: 'shippingMode',
  SHIPPING_PRICE: 'shippingPrice',
  SHIPPING_MIN_DAYS: 'shippingMinDays',
  SHIPPING_MAX_DAYS: 'shippingMaxDays',
  USE_CSV_QUANTITIES: 'useCsvQuantities',
  UNMANAGED_STOCK: 'unmanagedStock',
} as const;

/**
 * The currency and condition choices are the listing form's own enums, so the
 * import offers whatever the Shop can list, with no second list to keep in step.
 */
const listingShape = createMarketplaceListingSchema.shape;

export const IMPORT_CURRENCY_OPTIONS: readonly string[] = listingShape.currency.options;
export const IMPORT_CONDITION_OPTIONS: readonly string[] = listingShape.condition.options;

const dayCount = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, `${label} must be a whole number of days.`)
    .refine((value) => Number(value) <= 365, `${label} must be 365 days or fewer.`);

export const importSettingsFormSchema = z
  .object({
    [IMPORT_SETTINGS_FIELDS.CURRENCY]: listingShape.currency,
    [IMPORT_SETTINGS_FIELDS.COUNTRY_CODE]: z
      .string()
      .trim()
      .min(1, 'Choose where your listings ship from.')
      .regex(/^[A-Za-z]{2}$/, 'Enter a two-letter country code.'),
    [IMPORT_SETTINGS_FIELDS.CONDITION]: listingShape.condition,
    [IMPORT_SETTINGS_FIELDS.SHIPPING_MODE]: z
      .enum(['', 'free', 'flat'])
      .refine((mode): boolean => mode !== '', 'Choose a shipping option.'),
    [IMPORT_SETTINGS_FIELDS.SHIPPING_PRICE]: z.string().trim(),
    [IMPORT_SETTINGS_FIELDS.SHIPPING_MIN_DAYS]: dayCount('Minimum delivery'),
    [IMPORT_SETTINGS_FIELDS.SHIPPING_MAX_DAYS]: dayCount('Maximum delivery'),
    [IMPORT_SETTINGS_FIELDS.USE_CSV_QUANTITIES]: z.boolean(),
    [IMPORT_SETTINGS_FIELDS.UNMANAGED_STOCK]: z
      .string()
      .trim()
      .regex(/^[1-9]\d*$/, 'Enter a whole number of copies.')
      .refine((value) => Number(value) < COMMERCE_LISTING_MAX_QUANTITY, 'That is more copies than a listing can hold.'),
  })
  .superRefine((data, context) => {
    if (Number(data.shippingMaxDays) < Number(data.shippingMinDays)) {
      context.addIssue({
        code: 'custom',
        path: [IMPORT_SETTINGS_FIELDS.SHIPPING_MAX_DAYS],
        message: 'Maximum delivery must not be before the minimum.',
      });
    }
    if (data.shippingMode !== 'flat') return;
    const decimals = currencyExponent(data.currency);
    const minor = majorToMinor(data.shippingPrice, decimals);
    if (minor === null || minor <= 0) {
      context.addIssue({
        code: 'custom',
        path: [IMPORT_SETTINGS_FIELDS.SHIPPING_PRICE],
        message:
          decimals > 0
            ? `Enter a ${data.currency} amount above zero with at most ${decimals} decimal places.`
            : `Enter a whole ${data.currency} amount above zero.`,
      });
    }
  });

export type ImportSettingsFormData = z.infer<typeof importSettingsFormSchema>;

export const importSettingsFormDefaults: ImportSettingsFormData = {
  [IMPORT_SETTINGS_FIELDS.CURRENCY]: 'USD',
  [IMPORT_SETTINGS_FIELDS.COUNTRY_CODE]: '',
  [IMPORT_SETTINGS_FIELDS.CONDITION]: 'new',
  [IMPORT_SETTINGS_FIELDS.SHIPPING_MODE]: '',
  [IMPORT_SETTINGS_FIELDS.SHIPPING_PRICE]: '',
  [IMPORT_SETTINGS_FIELDS.SHIPPING_MIN_DAYS]: '3',
  [IMPORT_SETTINGS_FIELDS.SHIPPING_MAX_DAYS]: '10',
  [IMPORT_SETTINGS_FIELDS.USE_CSV_QUANTITIES]: false,
  [IMPORT_SETTINGS_FIELDS.UNMANAGED_STOCK]: '1',
};

/** Form values for a shipping option the seller already has. */
export function shippingFormValues(
  shipping: ImportShipping,
  currency: string,
): Pick<ImportSettingsFormData, 'shippingMode' | 'shippingPrice' | 'shippingMinDays' | 'shippingMaxDays'> {
  const price =
    shipping.mode === 'flat'
      ? (shipping.priceMinor / 10 ** currencyExponent(currency)).toFixed(currencyExponent(currency))
      : '';
  return {
    shippingMode: shipping.mode,
    shippingPrice: price,
    shippingMinDays: String(shipping.minDays),
    shippingMaxDays: String(shipping.maxDays),
  };
}

/**
 * The importer's settings for the form as it stands. Shipping and ships-from
 * are `null` until the seller (or their shop) has given a valid answer: there
 * is no silent default, so a plan made before they choose carries neither.
 */
export function toImportSettings(data: ImportSettingsFormData): ImportSettings {
  const dayNumber = (value: string, fallback: number) => (/^\d{1,3}$/.test(value.trim()) ? Number(value) : fallback);
  const minDays = dayNumber(data.shippingMinDays, 3);
  const maxDays = Math.max(minDays, dayNumber(data.shippingMaxDays, 10));
  const priceMinor = majorToMinor(data.shippingPrice, currencyExponent(data.currency));
  let shipping: ImportShipping | null = null;
  if (data.shippingMode === 'free') shipping = { mode: 'free', minDays, maxDays };
  else if (data.shippingMode === 'flat' && priceMinor !== null && priceMinor > 0) {
    shipping = { mode: 'flat', priceMinor, minDays, maxDays };
  }
  const country = data.countryCode.trim();
  const unmanagedStock = /^[1-9]\d*$/.test(data.unmanagedStock.trim()) ? Number(data.unmanagedStock) : 1;
  return {
    currency: data.currency,
    countryCode: /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null,
    condition: data.condition,
    shipping,
    useCsvQuantities: data.useCsvQuantities,
    unmanagedStock,
  };
}
