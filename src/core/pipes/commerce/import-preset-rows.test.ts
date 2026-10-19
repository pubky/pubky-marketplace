import { describe, expect, it } from 'vitest';
import { IMPORT_SETTINGS_COMPLETE } from '@/test-utils/import-settings';
import { entityIdFrom, finalizePresetRows, isEntityId, type PresetRow } from './import-preset-rows';
import { DEFAULT_IMPORT_SETTINGS } from './import-settings';

function row(overrides: Partial<PresetRow> = {}): PresetRow {
  return {
    recordUri: 'pubky://x/listings/a',
    sellerPubky: 'y'.repeat(52),
    listingId: 'a',
    sourceListingKey: 'a',
    recordRevision: 1,
    variantId: 'v1',
    sku: '',
    state: 'active',
    title: 'Item',
    description: 'Text',
    taxonomy: {},
    category: 'Cat',
    condition: 'new',
    tags: [],
    amountMinor: 100,
    currency: 'USD',
    exponent: 2,
    variantQuantity: 1,
    variantEnabled: true,
    options: {},
    media: [],
    shippingOptions: [],
    returnPolicy: {},
    sale: {},
    externalRefs: {},
    extraFields: {},
    ...overrides,
  };
}

function finalize(rows: PresetRow[]) {
  return finalizePresetRows({
    rows,
    settings: IMPORT_SETTINGS_COMPLETE,
    labelFor: (id) => `label ${id}`,
    lineFor: () => 4,
  });
}

describe('entity ids', () => {
  it('derives a path-safe id and recognises one', () => {
    expect(entityIdFrom(' Café / Crème #1 ')).toBe('Cafe-Creme-1');
    expect(entityIdFrom('***')).toBe('');
    expect(entityIdFrom('a'.repeat(200))).toHaveLength(128);
    expect(isEntityId('ok_id-1')).toBe(true);
    expect(isEntityId('no.dots')).toBe(false);
    expect(isEntityId('')).toBe(false);
  });
});

describe('finalizePresetRows', () => {
  it('skips a listing with a duplicate variant id or a SKU used by an earlier listing, and keeps the rest', () => {
    const result = finalize([
      row({ listingId: 'one', variantId: 'v1', sku: 'S1' }),
      row({ listingId: 'two', variantId: 'v1' }),
      row({ listingId: 'two', variantId: 'v1' }),
      row({ listingId: 'three', variantId: 'v1', sku: 'S1' }),
      row({ listingId: 'four', variantId: 'v1', sku: 'S4' }),
    ]);
    expect(result.rows.map((entry) => entry.listingId)).toEqual(['one', 'four']);
    expect([...result.skippedListingIds].sort()).toEqual(['three', 'two']);
    expect(result.losses.map((loss) => [loss.code, loss.severity, loss.listing, loss.line])).toEqual([
      ['variant_id_duplicate', 'skipped', 'label two', 4],
      ['sku_duplicate', 'skipped', 'label three', 4],
    ]);
  });

  it('skips ids the record cannot hold', () => {
    const result = finalize([row({ listingId: 'bad.id' }), row({ listingId: 'good', variantId: 'bad.variant' })]);
    expect(result.rows).toEqual([]);
    expect(result.losses.map((loss) => loss.code)).toEqual(['identity_invalid', 'identity_invalid']);
  });

  it('pauses a listing with no stock, caps absurd stock, and keeps a listing with stock active', () => {
    const none = finalize([row({ variantQuantity: 0 })]);
    expect(none.rows[0]?.state).toBe('paused');
    const disabled = finalize([row({ variantQuantity: 5, variantEnabled: false })]);
    expect(disabled.rows[0]?.state).toBe('paused');
    const capped = finalize([row({ variantQuantity: 1_000_000 })]);
    expect(capped.rows[0]?.variantQuantity).toBe(999_999);
    expect(finalize([row()]).rows[0]?.state).toBe('active');
  });

  it('keeps variants of one listing identical in every listing-level field', () => {
    const result = finalize([
      row({ variantId: 'v1', sku: 'A', options: { Size: 'S' } }),
      row({ variantId: 'v2', sku: 'B', options: { Size: 'M' }, variantQuantity: 0 }),
    ]);
    const listingFields = (entry: PresetRow) =>
      JSON.stringify([entry.state, entry.title, entry.description, entry.tags, entry.shippingOptions, entry.condition]);
    expect(listingFields(result.rows[0]!)).toBe(listingFields(result.rows[1]!));
    expect(result.rows.map((entry) => entry.variantQuantity)).toEqual([1, 0]);
  });

  it('limits options to the record limits and drops over-long SKUs, with a report entry for each', () => {
    const result = finalize([
      row({
        sku: 'S'.repeat(65),
        options: { A: '1', B: '2', C: '3', D: '4', ['N'.repeat(50)]: 'x' },
      }),
    ]);
    expect(Object.keys(result.rows[0]?.options ?? {})).toEqual(['A', 'B', 'C']);
    expect(result.rows[0]?.sku).toBe('');
    expect(result.losses.map((loss) => loss.code)).toEqual(
      expect.arrayContaining(['options_truncated', 'sku_dropped']),
    );
  });

  it('falls back to a valid condition from the settings', () => {
    expect(finalize([row({ condition: 'bogus' })]).rows[0]?.condition).toBe('new');
  });

  it('carries no shipping option and no country when none was chosen, and never invents them', () => {
    const result = finalizePresetRows({
      rows: [row()],
      settings: DEFAULT_IMPORT_SETTINGS,
      labelFor: () => 'x',
      lineFor: () => 1,
    });
    expect(result.rows[0]?.shippingOptions).toEqual([]);
    expect(result.rows[0]?.extraFields.country_code).toBeUndefined();
    expect(result.rows[0]?.state).toBe('active');
  });
});
