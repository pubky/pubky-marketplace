import { z } from 'zod';
import { amountInputFromMoney, type CommerceAsset, tryAmountInputToMoney } from '@/libs/commerce/pricing';
import {
  SHIPPING_MAX_COUNTRIES,
  SHIPPING_MAX_DELIVERY_DAYS,
  SHIPPING_MAX_NAME_CHARS,
  SHIPPING_MAX_RATES_PER_ZONE,
  SHIPPING_MAX_ZONES,
  type ShippingRate,
  type ShippingZone,
  shippingZonesSchema,
} from '@/libs/commerce/shipping-zones';
import { isAssignedCountryCode, parseShipsToField } from '@/libs/commerce/ships-to';

/** What the zones editor holds while a seller types: strings for every field, ids fixed once a zone or rate exists. */
export type ShippingRateFormValue = {
  rateId: string;
  label: string;
  pricing: 'free' | 'flat' | 'per_item';
  /** The flat amount, or the first unit's amount of a per-item rate, in the asset's entry unit. */
  amount: string;
  /** Each further unit's amount of a per-item rate. */
  additionalAmount: string;
  minDays: string;
  maxDays: string;
};

export type ShippingZoneFormValue = {
  zoneId: string;
  name: string;
  /** Two-letter codes separated by commas or spaces. */
  countries: string;
  restOfWorld: boolean;
  rates: ShippingRateFormValue[];
};

export const shippingZoneFormValueSchema = z.object({
  zoneId: z.string(),
  name: z.string(),
  countries: z.string(),
  restOfWorld: z.boolean(),
  rates: z.array(
    z.object({
      rateId: z.string(),
      label: z.string(),
      pricing: z.enum(['free', 'flat', 'per_item']),
      amount: z.string(),
      additionalAmount: z.string(),
      minDays: z.string(),
      maxDays: z.string(),
    }),
  ),
});

export function newShippingId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 12);
}

export function emptyShippingRate(overrides: Partial<ShippingRateFormValue> = {}): ShippingRateFormValue {
  return {
    rateId: newShippingId(),
    label: 'Standard',
    pricing: 'flat',
    amount: '',
    additionalAmount: '',
    minDays: '5',
    maxDays: '10',
    ...overrides,
  };
}

export function emptyShippingZone(overrides: Partial<ShippingZoneFormValue> = {}): ShippingZoneFormValue {
  return {
    zoneId: newShippingId(),
    name: '',
    countries: '',
    restOfWorld: false,
    rates: [emptyShippingRate()],
    ...overrides,
  };
}

export type ShippingZonesFormResult = { ok: true; zones: ShippingZone[] } | { ok: false; errors: string[] };

const WHOLE_DAYS = /^\d+$/;

function rateFromForm(
  rate: ShippingRateFormValue,
  asset: CommerceAsset,
  where: string,
  errors: string[],
): ShippingRate | null {
  const label = rate.label.trim();
  if (label === '' || label.length > SHIPPING_MAX_NAME_CHARS) {
    errors.push(`${where}: give the rate a label of 1-${SHIPPING_MAX_NAME_CHARS} characters.`);
  }
  const minDays = WHOLE_DAYS.test(rate.minDays.trim()) ? Number(rate.minDays) : null;
  const maxDays = WHOLE_DAYS.test(rate.maxDays.trim()) ? Number(rate.maxDays) : null;
  if (
    minDays === null ||
    maxDays === null ||
    minDays > SHIPPING_MAX_DELIVERY_DAYS ||
    maxDays > SHIPPING_MAX_DELIVERY_DAYS
  ) {
    errors.push(`${where}: enter delivery estimates in whole days (0-${SHIPPING_MAX_DELIVERY_DAYS}).`);
  } else if (maxDays < minDays) {
    errors.push(`${where}: the longest delivery estimate cannot be shorter than the shortest.`);
  }
  const base = {
    rateId: rate.rateId,
    label,
    estimatedMinDays: minDays ?? 0,
    estimatedMaxDays: maxDays ?? 0,
  };
  if (rate.pricing === 'free') return { ...base, pricing: 'free' };
  const first = tryAmountInputToMoney(rate.amount.trim() === '' ? 'x' : rate.amount, asset);
  if (first === null) {
    errors.push(
      `${where}: enter ${rate.pricing === 'per_item' ? 'the first item\u2019s' : 'the'} price in ${asset.currency}.`,
    );
    return null;
  }
  if (rate.pricing === 'flat') return { ...base, pricing: 'flat', amountMinor: first.amountMinor };
  const additional = tryAmountInputToMoney(rate.additionalAmount.trim() === '' ? 'x' : rate.additionalAmount, asset);
  if (additional === null) {
    errors.push(`${where}: enter the price of each further item in ${asset.currency} (0 if they ship free).`);
    return null;
  }
  return { ...base, pricing: 'per_item', firstMinor: first.amountMinor, additionalMinor: additional.amountMinor };
}

/**
 * The zones the editor describes, in `asset`, or every problem found so the
 * seller can fix them in one pass. A result is `ok` only when the zones also
 * pass the record schema the transaction service enforces.
 */
export function shippingZonesFromForm(
  values: readonly ShippingZoneFormValue[],
  asset: CommerceAsset,
): ShippingZonesFormResult {
  const errors: string[] = [];
  if (values.length === 0) errors.push('Add at least one zone.');
  if (values.length > SHIPPING_MAX_ZONES) errors.push(`A profile has at most ${SHIPPING_MAX_ZONES} zones.`);
  const zones: ShippingZone[] = [];
  values.forEach((zone, zoneIndex) => {
    const where = `Zone ${zoneIndex + 1}`;
    const name = zone.name.trim();
    if (name === '' || name.length > SHIPPING_MAX_NAME_CHARS) {
      errors.push(`${where}: give the zone a name of 1-${SHIPPING_MAX_NAME_CHARS} characters.`);
    }
    const countries = parseShipsToField(zone.countries);
    const invalid = countries.filter((code) => !isAssignedCountryCode(code));
    if (invalid.length > 0) errors.push(`${where}: not a two-letter country code: ${invalid.join(', ')}.`);
    if (countries.length > SHIPPING_MAX_COUNTRIES)
      errors.push(`${where}: list at most ${SHIPPING_MAX_COUNTRIES} countries.`);
    if (countries.length === 0 && !zone.restOfWorld) {
      errors.push(`${where}: list the countries it serves, or make it the rest of the world.`);
    }
    if (zone.rates.length === 0 || zone.rates.length > SHIPPING_MAX_RATES_PER_ZONE) {
      errors.push(`${where}: give it 1-${SHIPPING_MAX_RATES_PER_ZONE} rates.`);
    }
    const rates = zone.rates.flatMap((rate, rateIndex) => {
      const parsed = rateFromForm(rate, asset, `${where}, rate ${rateIndex + 1}`, errors);
      return parsed ? [parsed] : [];
    });
    zones.push({
      zoneId: zone.zoneId,
      name,
      countries,
      ...(zone.restOfWorld ? { restOfWorld: true } : {}),
      rates,
    });
  });
  if (errors.length > 0) return { ok: false, errors };
  const parsed = shippingZonesSchema.safeParse(zones);
  if (!parsed.success) {
    return {
      ok: false,
      errors: [...new Set(parsed.error.issues.map(({ message }) => `${message}.`.replace(/\.\.$/, '.')))],
    };
  }
  return { ok: true, zones: parsed.data };
}

export function shippingZonesToForm(zones: readonly ShippingZone[], asset: CommerceAsset): ShippingZoneFormValue[] {
  const money = (amountMinor: number) => amountInputFromMoney({ ...asset, amountMinor });
  return zones.map((zone) => ({
    zoneId: zone.zoneId,
    name: zone.name,
    countries: zone.countries.join(', '),
    restOfWorld: zone.restOfWorld === true,
    rates: zone.rates.map((rate) => ({
      rateId: rate.rateId,
      label: rate.label,
      pricing: rate.pricing,
      amount:
        rate.pricing === 'flat' ? money(rate.amountMinor) : rate.pricing === 'per_item' ? money(rate.firstMinor) : '',
      additionalAmount: rate.pricing === 'per_item' ? money(rate.additionalMinor) : '',
      minDays: String(rate.estimatedMinDays),
      maxDays: String(rate.estimatedMaxDays),
    })),
  }));
}
