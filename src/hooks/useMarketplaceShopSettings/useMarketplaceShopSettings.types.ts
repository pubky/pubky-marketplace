import { z } from 'zod';
import {
  COMMERCE_SHOP_BIO_MAX_CHARS,
  COMMERCE_SHOP_NAME_MAX_CHARS,
  COMMERCE_SHOP_POLICY_MAX_CHARS,
  COMMERCE_SHOP_TERM_DAYS_MAX,
  COMMERCE_SHOP_TERM_DAYS_MIN,
} from '@/config/commerce';
import { parseShipsToField, shipsToFieldError } from '@/libs/commerce/ships-to';

const TERM_DAYS_MESSAGE = `Use a whole number from ${COMMERCE_SHOP_TERM_DAYS_MIN} to ${COMMERCE_SHOP_TERM_DAYS_MAX}, or leave it empty.`;

/** A whole number of days in range, or empty for "not set" (the default applies). */
const termDaysField = z
  .string()
  .trim()
  .refine((value) => {
    if (value === '') return true;
    if (!/^\d+$/.test(value)) return false;
    const days = Number(value);
    return days >= COMMERCE_SHOP_TERM_DAYS_MIN && days <= COMMERCE_SHOP_TERM_DAYS_MAX;
  }, TERM_DAYS_MESSAGE);

/** The record's optional integer-day period for a form field: undefined when the field is empty. */
export function termDaysFromField(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : Number(trimmed);
}

/** The record's optional destination list for the form field: undefined when the field is empty (ships anywhere). */
export function shipsToCountriesFromField(value: string): string[] | undefined {
  const codes = parseShipsToField(value);
  return codes.length > 0 ? codes : undefined;
}

export const marketplaceShopSettingsSchema = z.object({
  name: z.string().trim().min(1, 'Shop name is required.').max(COMMERCE_SHOP_NAME_MAX_CHARS),
  bio: z.string().trim().max(COMMERCE_SHOP_BIO_MAX_CHARS),
  countryCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'Use a two-letter country code.'),
  region: z.string().trim().max(100),
  shippingPolicy: z.string().trim().min(1, 'Shipping policy is required.').max(COMMERCE_SHOP_POLICY_MAX_CHARS),
  shipsToCountries: z.string().superRefine((value, context) => {
    const message = shipsToFieldError(value);
    if (message) context.addIssue({ code: 'custom', message });
  }),
  returnPolicy: z.string().trim().min(1, 'Return policy is required.').max(COMMERCE_SHOP_POLICY_MAX_CHARS),
  vacationMode: z.boolean(),
  deliveryAssumeDays: termDaysField,
  autoCompleteDays: termDaysField,
});

export type MarketplaceShopSettingsData = z.infer<typeof marketplaceShopSettingsSchema>;

export const marketplaceShopSettingsDefaults: MarketplaceShopSettingsData = {
  name: '',
  bio: '',
  countryCode: 'US',
  region: '',
  shippingPolicy: 'Ships within three business days.',
  shipsToCountries: '',
  returnPolicy: 'Returns accepted within 30 days unless marked final sale.',
  vacationMode: false,
  deliveryAssumeDays: '',
  autoCompleteDays: '',
};
