import { describe, expect, it } from 'vitest';
import type { CommerceShippingPresetModelSchema } from '@/models/commerce/commerce.schema';
import type { FxRateSnapshot } from '@/pipes/money/money.types';
import {
  presetToShippingFields,
  shippingFieldsToPresetInput,
  shippingPresetMoney,
} from './useMarketplaceShippingPresets.types';

const OWNER = 's'.repeat(52);

const SNAPSHOT: FxRateSnapshot = {
  fiatPerBtc: {
    USD: '100000',
    EUR: '90000',
    CHF: '80000',
    GBP: '75000',
    JPY: '15000000',
    CAD: '135000',
    AUD: '150000',
  },
};

function createPreset(overrides: Partial<CommerceShippingPresetModelSchema> = {}): CommerceShippingPresetModelSchema {
  return {
    id: `${OWNER}:preset01`,
    owner_id: OWNER,
    label: 'Standard shipping',
    price_minor: 1_250,
    currency: 'USD',
    estimated_min_days: 2,
    estimated_max_days: 5,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    ...overrides,
  };
}

describe('shippingPresetMoney', () => {
  it('reads a preset price in its own currency with the registry exponent', () => {
    expect(shippingPresetMoney(createPreset())).toEqual({ amountMinor: 1_250, currency: 'USD', exponent: 2 });
    expect(shippingPresetMoney(createPreset({ currency: 'CHF', price_minor: 990 }))).toEqual({
      amountMinor: 990,
      currency: 'CHF',
      exponent: 2,
    });
    expect(shippingPresetMoney(createPreset({ currency: 'JPY', price_minor: 1_200 }))).toEqual({
      amountMinor: 1_200,
      currency: 'JPY',
      exponent: 0,
    });
    expect(shippingPresetMoney(createPreset({ currency: 'BTC', price_minor: 15_000 }))).toEqual({
      amountMinor: 15_000,
      currency: 'BTC',
      exponent: 8,
    });
  });

  it('keeps a preset saved before currencies as the US dollars it always was', () => {
    // Existing rows carry currency 'USD' and cents; nothing to migrate.
    expect(shippingPresetMoney({ price_minor: 499, currency: 'USD' })).toEqual({
      amountMinor: 499,
      currency: 'USD',
      exponent: 2,
    });
  });

  it('reads an unknown stored currency at two decimals rather than failing', () => {
    expect(shippingPresetMoney(createPreset({ currency: 'SEK' }))).toEqual({
      amountMinor: 1_250,
      currency: 'SEK',
      exponent: 2,
    });
  });
});

describe('presetToShippingFields', () => {
  it('fills the sell studio fields exactly as the form expects them', () => {
    expect(presetToShippingFields(createPreset(), 'USD', null)).toEqual({
      fields: {
        shippingLabel: 'Standard shipping',
        shippingPrice: '12.50',
        shippingMinDays: '2',
        shippingMaxDays: '5',
      },
      convertedFrom: null,
    });
  });

  it('needs no rate when the preset is already in the listing currency', () => {
    const chf = createPreset({ currency: 'CHF', price_minor: 990 });
    expect(presetToShippingFields(chf, 'CHF', null)?.fields.shippingPrice).toBe('9.90');
    const yen = createPreset({ currency: 'JPY', price_minor: 1_200 });
    expect(presetToShippingFields(yen, 'JPY', null)?.fields.shippingPrice).toBe('1200');
  });

  it('converts a preset into the listing currency with the snapshot and says what it converted from', () => {
    const chf = createPreset({ currency: 'CHF', price_minor: 800 });

    const applied = presetToShippingFields(chf, 'EUR', SNAPSHOT);

    // CHF 8.00 = 0.0001 BTC = EUR 9.00
    expect(applied?.fields.shippingPrice).toBe('9.00');
    expect(applied?.convertedFrom).toEqual({ amountMinor: 800, currency: 'CHF', exponent: 2 });
  });

  it('converts a US dollar preset into yen without a decimal point', () => {
    const applied = presetToShippingFields(createPreset({ price_minor: 1_000 }), 'JPY', SNAPSHOT);

    expect(applied?.fields.shippingPrice).toBe('1500');
  });

  it('converts into bitcoin base units', () => {
    const applied = presetToShippingFields(createPreset({ price_minor: 1_000 }), 'BTC', SNAPSHOT);

    expect(applied?.fields.shippingPrice).toBe('10000');
  });

  it('rounds half up to the listing currency minor unit', () => {
    // USD 0.01 = 1.5 yen -> 2
    const applied = presetToShippingFields(createPreset({ price_minor: 1 }), 'JPY', SNAPSHOT);

    expect(applied?.fields.shippingPrice).toBe('2');
  });

  it('refuses rather than guess when a needed rate is missing', () => {
    const chf = createPreset({ currency: 'CHF', price_minor: 800 });

    expect(presetToShippingFields(chf, 'EUR', null)).toBeNull();
    expect(presetToShippingFields(chf, 'EUR', { fiatPerBtc: { EUR: '90000' } })).toBeNull();
    expect(presetToShippingFields(chf, 'EUR', { fiatPerBtc: { CHF: '80000' } })).toBeNull();
  });

  it('refuses a preset in a currency it cannot convert', () => {
    expect(presetToShippingFields(createPreset({ currency: 'SEK' }), 'EUR', SNAPSHOT)).toBeNull();
  });

  it('refuses a conversion that rounds to zero', () => {
    const sats = createPreset({ currency: 'BTC', price_minor: 1 });

    expect(presetToShippingFields(sats, 'USD', SNAPSHOT)).toBeNull();
  });

  it('round-trips through the save conversion without drift', () => {
    const preset = createPreset({ price_minor: 999, estimated_min_days: 0, estimated_max_days: 365 });
    const applied = presetToShippingFields(preset, 'USD', null);
    const input = shippingFieldsToPresetInput(applied!.fields, 'USD');
    expect(input).toEqual({
      label: 'Standard shipping',
      priceMinor: 999,
      currency: 'USD',
      estimatedMinDays: 0,
      estimatedMaxDays: 365,
    });
  });
});

describe('shippingFieldsToPresetInput', () => {
  const valid = {
    shippingLabel: 'Tracked 48',
    shippingPrice: '4.99',
    shippingMinDays: '1',
    shippingMaxDays: '2',
  };

  it('converts valid sell studio fields', () => {
    expect(shippingFieldsToPresetInput(valid, 'USD')).toEqual({
      label: 'Tracked 48',
      priceMinor: 499,
      currency: 'USD',
      estimatedMinDays: 1,
      estimatedMaxDays: 2,
    });
  });

  it.each([
    ['EUR', '4.99', 499, 'EUR'],
    ['CHF', '5.50', 550, 'CHF'],
    ['GBP', '3.00', 300, 'GBP'],
    ['JPY', '800', 800, 'JPY'],
    ['CAD', '7.25', 725, 'CAD'],
    ['AUD', '8.10', 810, 'AUD'],
    ['BTC', '15000', 15_000, 'BTC'],
  ] as const)('saves a %s price in that currency minor units', (currency, price, priceMinor, expected) => {
    expect(shippingFieldsToPresetInput({ ...valid, shippingPrice: price }, currency)).toMatchObject({
      priceMinor,
      currency: expected,
    });
  });

  it('refuses a fraction yen cannot hold and a bitcoin price with decimals', () => {
    expect(shippingFieldsToPresetInput({ ...valid, shippingPrice: '800.5' }, 'JPY')).toBeNull();
    expect(shippingFieldsToPresetInput({ ...valid, shippingPrice: '150.5' }, 'BTC')).toBeNull();
  });

  it('trims the label', () => {
    expect(shippingFieldsToPresetInput({ ...valid, shippingLabel: '  Tracked 48  ' }, 'USD')?.label).toBe('Tracked 48');
  });

  it('rejects incomplete or invalid fields instead of saving a broken preset', () => {
    expect(shippingFieldsToPresetInput({ ...valid, shippingLabel: '' }, 'USD')).toBeNull();
    expect(shippingFieldsToPresetInput({ ...valid, shippingLabel: 'x'.repeat(101) }, 'USD')).toBeNull();
    expect(shippingFieldsToPresetInput({ ...valid, shippingPrice: '' }, 'USD')).toBeNull();
    expect(shippingFieldsToPresetInput({ ...valid, shippingPrice: '0' }, 'USD')).toBeNull();
    expect(shippingFieldsToPresetInput({ ...valid, shippingPrice: '1.999' }, 'USD')).toBeNull();
    expect(shippingFieldsToPresetInput({ ...valid, shippingPrice: 'abc' }, 'USD')).toBeNull();
    expect(shippingFieldsToPresetInput({ ...valid, shippingMinDays: '' }, 'USD')).toBeNull();
    expect(shippingFieldsToPresetInput({ ...valid, shippingMinDays: '-1' }, 'USD')).toBeNull();
    expect(shippingFieldsToPresetInput({ ...valid, shippingMaxDays: '366' }, 'USD')).toBeNull();
    // Max before min is the one cross-field rule.
    expect(shippingFieldsToPresetInput({ ...valid, shippingMinDays: '5', shippingMaxDays: '2' }, 'USD')).toBeNull();
  });
});
