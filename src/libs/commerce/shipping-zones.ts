import { z } from 'zod';
import { commerceEntityIdSchema } from '@/libs/commerce/transaction-contracts';

/**
 * Zone-priced shipping: the zones, rates and quote function of the shared
 * `pubky-market-specs` shipping profile (`shipping_profile` record, and a
 * listing's inline `shippingZones`). The transaction service prices an order
 * with the same arithmetic, so a quote shown here is the amount charged.
 * `shipping-zones.test.ts` runs this module against the vectors the specs
 * crate generates (`shipping-quotes-v1.json`), so the two cannot drift.
 */

export const SHIPPING_MAX_ZONES = 50;
export const SHIPPING_MAX_RATES_PER_ZONE = 10;
export const SHIPPING_MAX_COUNTRIES = 250;
export const SHIPPING_MAX_ORIGINS = 50;
export const SHIPPING_MAX_NAME_CHARS = 100;
export const SHIPPING_MAX_DELIVERY_DAYS = 365;
/** The most units one shipping group may quote. */
export const SHIPPING_MAX_GROUP_UNITS = 1_000_000;

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

export const shippingCountryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'Expected an ISO 3166-1 alpha-2 code');

const rateBase = {
  rateId: commerceEntityIdSchema,
  label: z.string().trim().min(1).max(SHIPPING_MAX_NAME_CHARS),
  estimatedMinDays: z.number().int().min(0).max(SHIPPING_MAX_DELIVERY_DAYS),
  estimatedMaxDays: z.number().int().min(0).max(SHIPPING_MAX_DELIVERY_DAYS),
};

const minorAmountSchema = z.number().int().min(0).max(MAX_SAFE_INTEGER);

const freeRateSchema = z.object({ ...rateBase, pricing: z.literal('free') }).passthrough();

const flatRateSchema = z
  .object({ ...rateBase, pricing: z.literal('flat'), amountMinor: minorAmountSchema })
  .passthrough();

const perItemRateSchema = z
  .object({
    ...rateBase,
    pricing: z.literal('per_item'),
    firstMinor: minorAmountSchema,
    additionalMinor: minorAmountSchema,
  })
  .passthrough();

/**
 * One way to ship to a zone's countries. The pricing is closed-world: a rate
 * whose pricing this reader does not know fails to parse rather than being
 * priced as something else.
 */
export const shippingRateSchema = z
  .discriminatedUnion('pricing', [freeRateSchema, flatRateSchema, perItemRateSchema])
  .superRefine((rate, context) => {
    if (rate.estimatedMaxDays < rate.estimatedMinDays) {
      context.addIssue({
        code: 'custom',
        message: 'Maximum delivery estimate must not precede the minimum',
        path: ['estimatedMaxDays'],
      });
    }
  });

export type ShippingRate = z.infer<typeof shippingRateSchema>;

export const shippingZoneSchema = z
  .object({
    zoneId: commerceEntityIdSchema,
    name: z.string().trim().min(1).max(SHIPPING_MAX_NAME_CHARS),
    countries: z.array(shippingCountryCodeSchema).max(SHIPPING_MAX_COUNTRIES).default([]),
    restOfWorld: z.boolean().optional(),
    rates: z.array(shippingRateSchema).min(1).max(SHIPPING_MAX_RATES_PER_ZONE),
  })
  .passthrough()
  .superRefine((zone, context) => {
    if (zone.countries.length === 0 && zone.restOfWorld !== true) {
      context.addIssue({
        code: 'custom',
        message: 'A shipping zone needs countries or restOfWorld',
        path: ['countries'],
      });
    }
    addDuplicateIssue(zone.countries, context, ['countries'], 'A country may be listed only once');
    addDuplicateIssue(
      zone.rates.map(({ rateId }) => rateId),
      context,
      ['rates'],
      'Shipping rate ids must be unique',
    );
  });

export type ShippingZone = z.infer<typeof shippingZoneSchema>;

function addDuplicateIssue(values: readonly string[], context: z.RefinementCtx, path: string[], message: string) {
  if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', message, path });
}

/** 1-50 zones, unique zone ids, a country in at most one zone, at most one rest-of-world zone. */
export const shippingZonesSchema = z
  .array(shippingZoneSchema)
  .min(1)
  .max(SHIPPING_MAX_ZONES)
  .superRefine((zones, context) => {
    addDuplicateIssue(
      zones.map(({ zoneId }) => zoneId),
      context,
      [],
      'Shipping zone ids must be unique',
    );
    addDuplicateIssue(
      zones.flatMap(({ countries }) => countries),
      context,
      [],
      'A country may belong to only one shipping zone',
    );
    if (zones.filter(({ restOfWorld }) => restOfWorld === true).length > 1) {
      context.addIssue({ code: 'custom', message: 'At most one shipping zone may be restOfWorld' });
    }
  });

export const shippingCountryListSchema = (max: number) =>
  z
    .array(shippingCountryCodeSchema)
    .max(max)
    .superRefine((codes, context) => addDuplicateIssue(codes, context, [], 'Countries must be unique'));

/** What one rate charges a shipping group. */
export type ShippingQuote = {
  zoneId: string;
  rateId: string;
  label: string;
  amountMinor: number;
  estimatedMinDays: number;
  estimatedMaxDays: number;
};

/** Why a quote could not be made; the codes are the transaction service's. */
export type ShippingQuoteErrorCode =
  | 'INVALID_DESTINATION'
  | 'INVALID_QUANTITY'
  | 'SHIPPING_UNAVAILABLE_TO_COUNTRY'
  | 'UNKNOWN_SHIPPING_RATE'
  | 'SHIPPING_OVERFLOW';

export type ShippingQuoteResult<T> = { ok: true; value: T } | { ok: false; code: ShippingQuoteErrorCode };

const fail = (code: ShippingQuoteErrorCode): { ok: false; code: ShippingQuoteErrorCode } => ({ ok: false, code });

/**
 * The zone that serves `destination`: an excluded country is never served; an
 * explicit country wins over `restOfWorld`; a country no zone covers is not
 * served.
 */
export function shippingZoneForDestination(
  zones: readonly ShippingZone[],
  excludedCountries: readonly string[],
  destination: string,
): ShippingQuoteResult<ShippingZone> {
  if (!/^[A-Z]{2}$/.test(destination)) return fail('INVALID_DESTINATION');
  if (excludedCountries.includes(destination)) return fail('SHIPPING_UNAVAILABLE_TO_COUNTRY');
  const zone =
    zones.find((candidate) => candidate.countries.includes(destination)) ??
    zones.find((candidate) => candidate.restOfWorld === true);
  return zone ? { ok: true, value: zone } : fail('SHIPPING_UNAVAILABLE_TO_COUNTRY');
}

function quoteRate(zone: ShippingZone, rate: ShippingRate, units: number): ShippingQuoteResult<ShippingQuote> {
  if (!Number.isInteger(units) || units < 1 || units > SHIPPING_MAX_GROUP_UNITS) return fail('INVALID_QUANTITY');
  let amountMinor: number;
  switch (rate.pricing) {
    case 'free':
      amountMinor = 0;
      break;
    case 'flat':
      amountMinor = rate.amountMinor;
      break;
    case 'per_item':
      amountMinor = (units - 1) * rate.additionalMinor + rate.firstMinor;
      break;
  }
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return fail('SHIPPING_OVERFLOW');
  return {
    ok: true,
    value: {
      zoneId: zone.zoneId,
      rateId: rate.rateId,
      label: rate.label,
      amountMinor,
      estimatedMinDays: rate.estimatedMinDays,
      estimatedMaxDays: rate.estimatedMaxDays,
    },
  };
}

/**
 * Quotes one shipping group of `units` units to `destination` under the rate
 * `rateId` of the zone that serves it. A group is the lines of one seller
 * order that share one profile (or one listing's inline zones).
 */
export function quoteShipping(
  zones: readonly ShippingZone[],
  excludedCountries: readonly string[],
  destination: string,
  rateId: string,
  units: number,
): ShippingQuoteResult<ShippingQuote> {
  const zone = shippingZoneForDestination(zones, excludedCountries, destination);
  if (!zone.ok) return zone;
  const rate = zone.value.rates.find((candidate) => candidate.rateId === rateId);
  return rate ? quoteRate(zone.value, rate, units) : fail('UNKNOWN_SHIPPING_RATE');
}

/** Quotes every rate of the zone that serves `destination`, in the zone's order, for the buyer's rate choice. */
export function quoteAllShippingRates(
  zones: readonly ShippingZone[],
  excludedCountries: readonly string[],
  destination: string,
  units: number,
): ShippingQuoteResult<ShippingQuote[]> {
  const zone = shippingZoneForDestination(zones, excludedCountries, destination);
  if (!zone.ok) return zone;
  const quotes: ShippingQuote[] = [];
  for (const rate of zone.value.rates) {
    const quote = quoteRate(zone.value, rate, units);
    if (!quote.ok) return quote;
    quotes.push(quote.value);
  }
  return { ok: true, value: quotes };
}

/** What one unit costs under a rate, in minor units. */
export function firstItemMinor(rate: ShippingRate): number {
  switch (rate.pricing) {
    case 'free':
      return 0;
    case 'flat':
      return rate.amountMinor;
    case 'per_item':
      return rate.firstMinor;
  }
}

/** The countries a set of zones ships to, excluding the countries a profile never serves; null when a zone covers the rest of the world. */
export function shippedCountries(
  zones: readonly ShippingZone[],
  excludedCountries: readonly string[],
): string[] | null {
  if (zones.some(({ restOfWorld }) => restOfWorld === true)) return null;
  return [...new Set(zones.flatMap(({ countries }) => countries))].filter((code) => !excludedCountries.includes(code));
}

/**
 * The single `shippingOptions` entry written beside zones so readers that
 * predate them still parse and price the listing: a `free` or `flat` option
 * at the highest of the zones' cheapest first-unit prices, with the widest
 * delivery estimate. Readers that understand zones price from the zones and
 * ignore it.
 */
export function legacyShippingOption(
  zones: readonly ShippingZone[],
  asset: { currency: string; exponent: number },
  optionId: string,
  label: string,
) {
  let price = 0;
  let minDays = Number.POSITIVE_INFINITY;
  let maxDays = 0;
  for (const zone of zones) {
    price = Math.max(price, Math.min(...zone.rates.map(firstItemMinor)));
    for (const rate of zone.rates) {
      minDays = Math.min(minDays, rate.estimatedMinDays);
      maxDays = Math.max(maxDays, rate.estimatedMaxDays);
    }
  }
  const common = {
    id: optionId,
    label: label.trim(),
    estimatedMinDays: Number.isFinite(minDays) ? minDays : 0,
    estimatedMaxDays: maxDays,
  };
  return price === 0
    ? ({ ...common, pricing: 'free' } as const)
    : ({
        ...common,
        pricing: 'flat',
        price: { amountMinor: price, currency: asset.currency, exponent: asset.exponent },
      } as const);
}
