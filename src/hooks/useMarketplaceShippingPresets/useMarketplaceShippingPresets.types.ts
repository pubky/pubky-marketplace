import { isListingCurrencyCode, LISTING_CURRENCY_REGISTRY, type ListingCurrencyCode } from '@/config/currencies';
import type { CreateMarketplaceListingData } from '@/hooks/useCreateMarketplaceListing/useCreateMarketplaceListing.types';
import { assetForListingCurrency } from '@/libs/commerce/pricing';
import type { CommerceShippingPresetModelSchema } from '@/models/commerce/commerce.schema';
import type { CommerceShippingPresetInput } from '@/pipes/commerce/commerce.normalizer';
import { convertMoney } from '@/pipes/money/money.convert';
import { amountInputText, parseAmountInput } from '@/pipes/money/money.parse';
import type { FxRateSnapshot, Money } from '@/pipes/money/money.types';

/** The sell studio fields a shipping preset fills. */
export type MarketplaceShippingPresetFields = Pick<
  CreateMarketplaceListingData,
  'shippingLabel' | 'shippingPrice' | 'shippingMinDays' | 'shippingMaxDays'
>;

/** Presets saved before they carried a currency were always US dollars in cents. */
const LEGACY_PRESET_EXPONENT = 2;

/** A preset's flat price as money in the preset's own currency. */
export function shippingPresetMoney(
  preset: Pick<CommerceShippingPresetModelSchema, 'price_minor' | 'currency'>,
): Money {
  return {
    amountMinor: preset.price_minor,
    currency: preset.currency,
    exponent: isListingCurrencyCode(preset.currency)
      ? LISTING_CURRENCY_REGISTRY[preset.currency].exponent
      : LEGACY_PRESET_EXPONENT,
  };
}

export interface AppliedShippingPreset {
  fields: MarketplaceShippingPresetFields;
  /** The preset's own price when it was converted into the listing currency; `null` when none was needed. */
  convertedFrom: Money | null;
}

/**
 * Applies a stored preset to the sell studio's shipping form fields, in the
 * listing's currency. A preset in another currency is converted with the
 * given snapshot (half up to the listing currency's minor unit) because the
 * published record, and the service that checks it, require the flat shipping
 * price in the listing's own currency. Returns `null` when that conversion is
 * not possible (no rate for either currency, or an amount that rounds to
 * zero): the caller must say so rather than fill a guess.
 */
export function presetToShippingFields(
  preset: CommerceShippingPresetModelSchema,
  listingCurrency: ListingCurrencyCode,
  snapshot: FxRateSnapshot | null,
): AppliedShippingPreset | null {
  const own = shippingPresetMoney(preset);
  const target = assetForListingCurrency(listingCurrency);
  const sameCurrency = own.currency === target.currency && own.exponent === target.exponent;
  let price: Money | null = own;
  if (!sameCurrency) {
    price = snapshot ? convertMoney(own, listingCurrency, snapshot) : null;
    if (price === null || price.amountMinor <= 0) return null;
  }
  return {
    fields: {
      shippingLabel: preset.label,
      shippingPrice: amountInputText(price),
      shippingMinDays: String(preset.estimated_min_days),
      shippingMaxDays: String(preset.estimated_max_days),
    },
    convertedFrom: sameCurrency ? null : own,
  };
}

/**
 * Converts the sell studio's current shipping fields into a storable preset
 * in the given currency, or null when the fields would not validate (mirrors
 * the sell form's own physical-fulfillment rules, so only publishable
 * configurations are saved).
 */
export function shippingFieldsToPresetInput(
  fields: MarketplaceShippingPresetFields,
  currency: ListingCurrencyCode,
): CommerceShippingPresetInput | null {
  const label = fields.shippingLabel.trim();
  if (!label || label.length > 100) return null;
  const price = parseAmountInput(fields.shippingPrice, assetForListingCurrency(currency));
  if (price === null || price.amountMinor <= 0) return null;
  if (!/^\d+$/.test(fields.shippingMinDays.trim()) || !/^\d+$/.test(fields.shippingMaxDays.trim())) return null;
  const estimatedMinDays = Number(fields.shippingMinDays);
  const estimatedMaxDays = Number(fields.shippingMaxDays);
  if (estimatedMinDays > 365 || estimatedMaxDays > 365 || estimatedMaxDays < estimatedMinDays) return null;
  return { label, priceMinor: price.amountMinor, currency, estimatedMinDays, estimatedMaxDays };
}
