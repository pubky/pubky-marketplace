import { z } from 'zod';
import { COMMERCE_LISTING_MAX_QUANTITY } from '@/config/commerce';
import { createMarketplaceListingSchema } from '@/hooks/useCreateMarketplaceListing/useCreateMarketplaceListing.types';
import { DEFAULT_SHOP_COUNTRY_CODE } from '@/pipes/commerce/default-shop';
import { currencyExponent, type ImportSettings, majorToMinor } from '@/pipes/commerce/import-settings';

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
      .regex(/^[A-Za-z]{2}$/, 'Enter a two-letter country code.'),
    [IMPORT_SETTINGS_FIELDS.CONDITION]: listingShape.condition,
    [IMPORT_SETTINGS_FIELDS.SHIPPING_MODE]: z.enum(['free', 'flat']),
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
  [IMPORT_SETTINGS_FIELDS.COUNTRY_CODE]: DEFAULT_SHOP_COUNTRY_CODE,
  [IMPORT_SETTINGS_FIELDS.CONDITION]: 'new',
  [IMPORT_SETTINGS_FIELDS.SHIPPING_MODE]: 'free',
  [IMPORT_SETTINGS_FIELDS.SHIPPING_PRICE]: '',
  [IMPORT_SETTINGS_FIELDS.SHIPPING_MIN_DAYS]: '3',
  [IMPORT_SETTINGS_FIELDS.SHIPPING_MAX_DAYS]: '10',
  [IMPORT_SETTINGS_FIELDS.USE_CSV_QUANTITIES]: false,
  [IMPORT_SETTINGS_FIELDS.UNMANAGED_STOCK]: '1',
};

/** Validated form values as the settings the importer applies to every row. */
export function toImportSettings(data: ImportSettingsFormData): ImportSettings {
  const minDays = Number(data.shippingMinDays);
  const maxDays = Number(data.shippingMaxDays);
  const priceMinor = majorToMinor(data.shippingPrice, currencyExponent(data.currency)) ?? 0;
  return {
    currency: data.currency,
    countryCode: data.countryCode.toUpperCase(),
    condition: data.condition,
    shipping:
      data.shippingMode === 'flat'
        ? { mode: 'flat', priceMinor, minDays, maxDays }
        : { mode: 'free', minDays, maxDays },
    useCsvQuantities: data.useCsvQuantities,
    unmanagedStock: Number(data.unmanagedStock),
  };
}
