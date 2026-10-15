import { PubkySpecsBuilder } from 'pubky-app-specs';
import { describe, expect, it } from 'vitest';
import { COMMERCE_SHOP_BIO_MAX_CHARS, COMMERCE_SHOP_NAME_MAX_CHARS } from '@/config/commerce';
import { COMMERCE_FIXTURE_SELLER } from '@/test/fixtures/commerce/commerce';
import { CommerceRecordNormalizer } from './commerce.normalizer';
import { buildDefaultShopRecord, DEFAULT_SHOP_COUNTRY_CODE } from './default-shop';

const NOW = new Date('2026-10-14T12:00:00.000Z');

describe('buildDefaultShopRecord', () => {
  it('builds a spec-valid shop.json from the seller profile', () => {
    const record = buildDefaultShopRecord({
      ownerPubky: COMMERCE_FIXTURE_SELLER,
      profile: { name: '  Satoshi  ', bio: 'Bitcoin goods.' },
      location: { countryCode: 'DE', region: 'Berlin' },
      now: NOW,
    });

    expect(record).toEqual({
      schemaVersion: 1,
      recordType: 'shop',
      ownerPubky: COMMERCE_FIXTURE_SELLER,
      revision: 1,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      name: 'Satoshi',
      bio: 'Bitcoin goods.',
      location: { countryCode: 'DE', region: 'Berlin' },
      shippingPolicy: '',
      returnPolicy: '',
      vacationMode: false,
    });
    const result = new PubkySpecsBuilder(COMMERCE_FIXTURE_SELLER).createShop(record);
    expect(result.meta.url).toBe(CommerceRecordNormalizer.shopUri(COMMERCE_FIXTURE_SELLER));
    expect(result.meta.url).toContain('/pub/pubky.app/marketplace/v1/shop.json');
  });

  it('falls back to a name from the pubky and the default country without a profile or location', () => {
    const record = buildDefaultShopRecord({ ownerPubky: COMMERCE_FIXTURE_SELLER, profile: null, now: NOW });

    expect(record.name).toBe(`Shop ${COMMERCE_FIXTURE_SELLER.slice(0, 8)}`);
    expect(record.bio).toBe('');
    expect(record.location).toEqual({ countryCode: DEFAULT_SHOP_COUNTRY_CODE });
    expect(() => new PubkySpecsBuilder(COMMERCE_FIXTURE_SELLER).createShop(record)).not.toThrow();
  });

  it('uses the fallback name for a blank profile name and truncates long fields', () => {
    const blank = buildDefaultShopRecord({
      ownerPubky: COMMERCE_FIXTURE_SELLER,
      profile: { name: '   ', bio: '' },
      now: NOW,
    });
    const long = buildDefaultShopRecord({
      ownerPubky: COMMERCE_FIXTURE_SELLER,
      profile: {
        name: 'n'.repeat(COMMERCE_SHOP_NAME_MAX_CHARS + 20),
        bio: 'b'.repeat(COMMERCE_SHOP_BIO_MAX_CHARS + 20),
      },
      now: NOW,
    });

    expect(blank.name).toBe(`Shop ${COMMERCE_FIXTURE_SELLER.slice(0, 8)}`);
    expect(long.name).toHaveLength(COMMERCE_SHOP_NAME_MAX_CHARS);
    expect(long.bio).toHaveLength(COMMERCE_SHOP_BIO_MAX_CHARS);
  });
});
