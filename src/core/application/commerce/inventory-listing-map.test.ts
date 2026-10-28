import { describe, expect, it } from 'vitest';
import { PHOTO_REQUIRED_MESSAGE } from '@/pipes/commerce/import-publish-failure';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { listingToCanonicalRows, mapCanonicalRowsToListing } from './inventory-listing-map';

describe('mapCanonicalRowsToListing', () => {
  it('prefers extraFields.record_json for a Shop-valid create', () => {
    const record = createCommerceListingFixture({ listingId: 'boots_01' });
    const rows = listingToCanonicalRows(record);
    const mapped = mapCanonicalRowsToListing(rows, record.ownerPubky);
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.record.listingId).toBe('boots_01');
      expect(mapped.record.media[0]?.url).toContain('/media/');
    }
  });

  it('maps canonical {accepted,days} return policy when record_json is absent', () => {
    const record = createCommerceListingFixture();
    const [row] = listingToCanonicalRows(record);
    const withoutJson = {
      ...row,
      extraFields: { country_code: 'US', media_json: JSON.stringify(record.media) },
    };
    const mapped = mapCanonicalRowsToListing([withoutJson], record.ownerPubky);
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.record.returnPolicy.acceptsReturns).toBe(true);
      expect(mapped.record.location.countryCode).toBe('US');
    }
  });

  it('publishes an imported UK as GB, from the country_code field and from location_json', () => {
    const record = createCommerceListingFixture();
    const [row] = listingToCanonicalRows(record);
    const media_json = JSON.stringify(record.media);
    for (const extraFields of <Array<Record<string, string>>>[
      { country_code: 'uk', media_json },
      { location_json: JSON.stringify({ countryCode: 'UK', region: 'London' }), media_json },
    ]) {
      const mapped = mapCanonicalRowsToListing([{ ...row!, extraFields }], record.ownerPubky);
      expect(mapped.ok).toBe(true);
      if (mapped.ok) expect(mapped.record.location.countryCode).toBe('GB');
    }
  });

  it('publishes UK as GB and refuses a code that names no country in record_json too', () => {
    const uk = createCommerceListingFixture({ location: { countryCode: 'UK' } });
    const mapped = mapCanonicalRowsToListing(listingToCanonicalRows(uk), uk.ownerPubky);
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.record.location.countryCode).toBe('GB');
      expect(mapped.record.revision).toBe(uk.revision + 1);
    }

    const zz = createCommerceListingFixture({ location: { countryCode: 'ZZ' } });
    expect(mapCanonicalRowsToListing(listingToCanonicalRows(zz), zz.ownerPubky)).toEqual({
      ok: false,
      message: '"ZZ" is not a country code. Use a two-letter code like CH or US.',
    });
  });

  it('refuses an imported country code that names no country', () => {
    const record = createCommerceListingFixture();
    const [row] = listingToCanonicalRows(record);
    const media_json = JSON.stringify(record.media);
    for (const extraFields of <Array<Record<string, string>>>[
      { country_code: 'ZZ', media_json },
      { location_json: JSON.stringify({ countryCode: 'ZZ' }), media_json },
    ]) {
      expect(mapCanonicalRowsToListing([{ ...row!, extraFields }], record.ownerPubky)).toEqual({
        ok: false,
        message: '"ZZ" is not a country code. Use a two-letter code like CH or US.',
      });
    }
  });

  it('refuses a row-built listing with no photo using the photo message', () => {
    const record = createCommerceListingFixture();
    const [row] = listingToCanonicalRows(record);
    const mapped = mapCanonicalRowsToListing(
      [{ ...row!, media: [], extraFields: { country_code: 'US' } }],
      record.ownerPubky,
    );
    expect(mapped).toEqual({ ok: false, message: PHOTO_REQUIRED_MESSAGE });
  });

  it('turns a variant_price_minor extra field into a variant price override', () => {
    const record = createCommerceListingFixture();
    const [row] = listingToCanonicalRows(record);
    const base = { ...row!, extraFields: { country_code: 'US', media_json: JSON.stringify(record.media) } };
    const cheap = { ...base, variantId: 'cheap', sku: 'CHEAP' };
    const dear = {
      ...base,
      variantId: 'dear',
      sku: 'DEAR',
      extraFields: { ...base.extraFields, variant_price_minor: String(base.amountMinor + 500) },
    };
    const same = {
      ...base,
      variantId: 'same',
      sku: 'SAME',
      extraFields: { ...base.extraFields, variant_price_minor: String(base.amountMinor) },
    };
    const mapped = mapCanonicalRowsToListing([cheap, dear, same], record.ownerPubky);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.record.variants.map((variant) => variant.priceOverride)).toEqual([
      undefined,
      { amountMinor: base.amountMinor + 500, currency: base.currency, exponent: base.exponent },
      undefined,
    ]);
  });

  it('ignores a malformed variant_price_minor instead of failing the listing', () => {
    const record = createCommerceListingFixture();
    const [row] = listingToCanonicalRows(record);
    const mapped = mapCanonicalRowsToListing(
      [
        {
          ...row!,
          extraFields: { country_code: 'US', media_json: JSON.stringify(record.media), variant_price_minor: '12.5' },
        },
      ],
      record.ownerPubky,
    );
    expect(mapped.ok).toBe(true);
    if (mapped.ok) expect(mapped.record.variants[0]?.priceOverride).toBeUndefined();
  });
});
