import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceInventoryImportApplication } from '@/application/commerce/inventory-import';
import { listingToCanonicalRows } from '@/application/commerce/inventory-listing-map';
import type { SellerDeliveryKeyPublication } from '@/libs/commerce/listing-publish-guards';
import type { CommerceListingRecord, CommerceShopRecord } from '@/libs/commerce/marketplace-records';
import type { SellerPaymentConfig } from '@/libs/commerce/payment-methods';
import { DEFAULT_IMPORT_SETTINGS } from '@/pipes/commerce/import-settings';
import type { SyncManyEnvelope } from '@/services/marketplace/marketplace-shop-client';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { IMPORT_SETTINGS_COMPLETE } from '@/test-utils/import-settings';
import { BytesFile, MemoryImportStore } from '@/test-utils/inventory-import-harness';
import { asOpaque } from '@/test-utils/type-assertions';

const PUBKY = 'y'.repeat(52);

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return {
    ...actual,
    getCommerceAdapterMode: () => 'transaction-service',
    getMarketplaceUrl: () => 'https://staging-api.pubky.app',
    isDurableCommerceMode: () => true,
  };
});

vi.mock('@/services/marketplace/marketplace-session', () => ({
  MarketplaceSessionService: {
    getActiveSession: () => ({ token: 'identity', pubky: PUBKY, capabilities: '', expiresAt: Date.now() + 60_000 }),
  },
}));

vi.mock('@/services/marketplace/marketplace-inventory-session', () => ({
  MarketplaceInventorySessionService: {
    getCoveringBearer: (sellerPubky: string) =>
      sellerPubky === PUBKY ? { token: 'inventory', source: 'inventory' } : null,
  },
}));

const WITH_METHOD: SellerPaymentConfig = {
  bitcoinAvailable: true,
  bitcoinOfferAvailable: true,
  paypalAvailable: false,
};
const NO_METHOD: SellerPaymentConfig = { bitcoinAvailable: false, bitcoinOfferAvailable: true, paypalAvailable: false };

function physical(listingId: string): CommerceListingRecord {
  return createCommerceListingFixture({ listingId, ownerPubky: PUBKY });
}

function digital(listingId: string): CommerceListingRecord {
  return createCommerceListingFixture({
    listingId,
    ownerPubky: PUBKY,
    fulfillmentMethods: ['digital'],
    package: undefined,
    shippingOptions: [],
  });
}

function jsonFile(records: CommerceListingRecord[]): BytesFile {
  const rows = records.flatMap(listingToCanonicalRows);
  return new BytesFile(new TextEncoder().encode(JSON.stringify(rows)), 'catalog.json', 'application/json');
}

function syncAll(listings: readonly { listing_id: string }[]): { readonly ok: true; readonly value: SyncManyEnvelope } {
  return {
    ok: true,
    value: asOpaque<SyncManyEnvelope>({
      schema_version: BigInt(1),
      kind: 'listing.sync_many',
      results: listings.map((listing) => ({ listing_id: listing.listing_id, status: 200 })),
    }),
  };
}

describe('import publishes run the sell composer gates once per seller', () => {
  let store: MemoryImportStore;
  let puts: CommerceListingRecord[];
  let paymentLoads: number;
  let keyLoads: number;
  let payment: () => Promise<SellerPaymentConfig>;
  let key: () => Promise<SellerDeliveryKeyPublication>;

  beforeEach(() => {
    store = new MemoryImportStore();
    puts = [];
    paymentLoads = 0;
    keyLoads = 0;
    payment = async () => WITH_METHOD;
    key = async () => 'matches';
  });

  function app() {
    return CommerceInventoryImportApplication.forSeller(PUBKY, {
      store,
      currentItems: async () => ({}),
      putListing: async (record) => {
        puts.push(record);
      },
      listingExists: async () => false,
      syncMany: async (listings) => syncAll(listings),
      loadPaymentConfig: async () => {
        paymentLoads += 1;
        return payment();
      },
      loadDeliveryKeyPublication: async () => {
        keyLoads += 1;
        return key();
      },
      loadShop: async () => null,
    });
  }

  async function plan(records: CommerceListingRecord[]) {
    const importer = app();
    const planned = await importer.planFile(jsonFile(records));
    if (planned.status !== 'planned') throw new Error('plan');
    return { importer, planned };
  }

  const states = () => Object.fromEntries(puts.map((record) => [record.listingId, record.state]));

  describe('when both gates pass', () => {
    it('shows no block in the dry run and publishes every listing active', async () => {
      const { importer, planned } = await plan([physical('boots_01'), digital('guide_01')]);
      expect(planned.publishGate).toEqual({ reason: null, ships: true });
      const published = await importer.publish(planned.manifestId);
      expect(published).toMatchObject({ status: 'complete', published: 2 });
      expect(published.status === 'complete' && published.paused).toBeUndefined();
      expect(states()).toEqual({ boots_01: 'active', guide_01: 'active' });
    });

    it('does not ask for the delivery key when nothing in the file ships', async () => {
      const { importer, planned } = await plan([digital('guide_01'), digital('guide_02')]);
      expect(planned.publishGate).toEqual({ reason: null, ships: false });
      await importer.publish(planned.manifestId);
      expect(keyLoads).toBe(0);
      expect(states()).toEqual({ guide_01: 'active', guide_02: 'active' });
    });
  });

  describe('payment-method gate', () => {
    it('blocks when the seller has no payment method: the dry run says why and every listing is saved paused', async () => {
      payment = async () => NO_METHOD;
      const { importer, planned } = await plan([physical('boots_01'), digital('guide_01')]);
      expect(planned.publishGate).toEqual({ reason: 'no-method', ships: true });

      const published = await importer.publish(planned.manifestId);

      expect(states()).toEqual({ boots_01: 'paused', guide_01: 'paused' });
      expect(published).toMatchObject({ status: 'complete', published: 2, paused: 2, pausedReason: 'no-method' });
      expect(published.status === 'complete' && published.message).toBe(
        '2 listings were saved as paused: no payment method set up.',
      );
      const csv = await importer.resultCsv(planned.manifestId);
      expect(csv).toContain('"synced, paused, no payment method set up"');
      expect(csv.match(/paused, no payment method set up/g)).toHaveLength(2);
    });

    it('blocks as unverified when the payment settings cannot be read', async () => {
      payment = async () => {
        throw new Error('service down');
      };
      const { importer, planned } = await plan([physical('boots_01')]);
      expect(planned.publishGate.reason).toBe('unverified');
      await importer.publish(planned.manifestId);
      expect(states()).toEqual({ boots_01: 'paused' });
      expect(await importer.resultCsv(planned.manifestId)).toContain('paused, payment settings could not be checked');
    });
  });

  describe('delivery-key gate', () => {
    it.each(['missing', 'invalid'] as const)(
      'pauses the listings that ship, but not the digital ones, when the published key is %s',
      async (publication) => {
        key = async () => publication;
        const { importer, planned } = await plan([physical('boots_01'), digital('guide_01'), physical('hat_01')]);
        expect(planned.publishGate).toEqual({ reason: 'no-delivery-key', ships: true });

        const published = await importer.publish(planned.manifestId);

        expect(states()).toEqual({ boots_01: 'paused', guide_01: 'active', hat_01: 'paused' });
        expect(published).toMatchObject({ paused: 2, pausedReason: 'no-delivery-key' });
        const csv = await importer.resultCsv(planned.manifestId);
        expect(csv.match(/paused, no delivery key published/g)).toHaveLength(2);
        expect(csv.match(/"synced"/g)).toHaveLength(1);
      },
    );

    it('blocks as unverified when the delivery key cannot be read', async () => {
      key = async () => {
        throw new Error('homeserver down');
      };
      const { importer, planned } = await plan([physical('boots_01'), digital('guide_01')]);
      expect(planned.publishGate.reason).toBe('delivery-key-unverified');
      await importer.publish(planned.manifestId);
      expect(states()).toEqual({ boots_01: 'paused', guide_01: 'active' });
    });

    it('passes for a mixed file when the key matches or was published from another device', async () => {
      for (const publication of ['matches', 'different'] as const) {
        puts = [];
        store = new MemoryImportStore();
        key = async () => publication;
        const { importer, planned } = await plan([physical('boots_01'), digital('guide_01')]);
        expect(planned.publishGate.reason).toBeNull();
        await importer.publish(planned.manifestId);
        expect(states()).toEqual({ boots_01: 'active', guide_01: 'active' });
      }
    });
  });

  describe('once per import publish', () => {
    it('asks each gate one time for many listings, and again only on a later publish call', async () => {
      key = async () => 'missing';
      const records = ['a_01', 'b_01', 'c_01', 'd_01'].map(physical);
      const { importer, planned } = await plan(records);
      paymentLoads = 0;
      keyLoads = 0;

      await importer.publish(planned.manifestId);
      expect({ paymentLoads, keyLoads }).toEqual({ paymentLoads: 1, keyLoads: 1 });
      expect(puts).toHaveLength(4);
      expect(puts.every((record) => record.state === 'paused')).toBe(true);
    });

    it('evaluates nothing when there is nothing to publish', async () => {
      const importer = app();
      const planned = await importer.planFile(
        new BytesFile(
          new TextEncoder().encode('ID,Type,SKU,Name,Regular price\n1,grouped,g,Group,\n'),
          'none.csv',
          'text/csv',
        ),
        IMPORT_SETTINGS_COMPLETE,
      );
      if (planned.status !== 'planned') throw new Error('plan');
      expect(planned.publishGate).toEqual({ reason: null, ships: false });
      expect({ paymentLoads, keyLoads }).toEqual({ paymentLoads: 0, keyLoads: 0 });
    });
  });

  it('leaves an already paused listing paused without counting it as paused by a gate', async () => {
    payment = async () => NO_METHOD;
    const paused = createCommerceListingFixture({ listingId: 'old_01', ownerPubky: PUBKY, state: 'paused' });
    const { importer, planned } = await plan([paused]);
    const published = await importer.publish(planned.manifestId);
    expect(states()).toEqual({ old_01: 'paused' });
    expect(published).toMatchObject({ status: 'complete', published: 1 });
    expect(published.status === 'complete' && published.paused).toBeUndefined();
    const csv = await importer.resultCsv(planned.manifestId);
    expect(csv).toContain('"synced"');
    expect(csv).not.toContain('paused,');
  });
});

describe('shipping and ships-from are never defaulted', () => {
  const shop = (revision: number, countryCode: string): CommerceShopRecord =>
    ({ revision, location: { countryCode } }) as CommerceShopRecord;

  function importer(options: { shop?: CommerceShopRecord | null; listings?: CommerceListingRecord[] }) {
    return CommerceInventoryImportApplication.forSeller(PUBKY, {
      store: new MemoryImportStore(),
      currentItems: async () => ({}),
      loadShop: async () => options.shop ?? null,
      localRecords: async () => options.listings ?? [],
      loadPaymentConfig: async () => WITH_METHOD,
      loadDeliveryKeyPublication: async () => 'matches',
    });
  }

  it('prefills the country from the shop and the shipping option from the latest listing that has one', async () => {
    const older = createCommerceListingFixture({ listingId: 'old_01', updatedAt: '2026-01-01T00:00:00.000Z' });
    const newer = createCommerceListingFixture({
      listingId: 'new_01',
      updatedAt: '2026-09-01T00:00:00.000Z',
      shippingOptions: [{ id: 'free_01', pricing: 'free', label: 'Free', estimatedMinDays: 2, estimatedMaxDays: 4 }],
    });
    const defaults = await importer({ shop: shop(2, 'CH'), listings: [older, newer] }).importDefaults();
    expect(defaults).toEqual({
      countryCode: 'CH',
      shipping: { mode: 'free', minDays: 2, maxDays: 4 },
      currency: 'USD',
    });
  });

  it('offers nothing, rather than a guess, when the shop and listings say nothing', async () => {
    expect(await importer({}).importDefaults()).toEqual({ countryCode: null, shipping: null, currency: null });
    // The Shop's own fallback shop (revision 1, US) is not the seller's answer.
    expect((await importer({ shop: shop(1, 'US') }).importDefaults()).countryCode).toBeNull();
    expect((await importer({ shop: shop(1, 'DE') }).importDefaults()).countryCode).toBe('DE');
  });

  it('plans a file with neither chosen, carries neither, and publishing fails each listing with a reason', async () => {
    const store = new MemoryImportStore();
    const puts: CommerceListingRecord[] = [];
    const sellerApp = CommerceInventoryImportApplication.forSeller(PUBKY, {
      store,
      currentItems: async () => ({}),
      putListing: async (record) => {
        puts.push(record);
      },
      listingExists: async () => false,
      syncMany: async (listings) => syncAll(listings),
      loadPaymentConfig: async () => WITH_METHOD,
      loadDeliveryKeyPublication: async () => 'matches',
      loadShop: async () => null,
    });
    const planned = await sellerApp.planFile(
      new BytesFile(
        new TextEncoder().encode(
          'ID,Type,SKU,Name,Published,Description,In stock?,Stock,Regular price\n1,simple,a,Item,1,Text,1,2,5\n',
        ),
        'woo.csv',
        'text/csv',
      ),
      DEFAULT_IMPORT_SETTINGS,
    );
    if (planned.status !== 'planned') throw new Error('plan');
    const rows = [...store.payloads.values()].map(
      (value) => JSON.parse(value) as { shippingOptions: unknown[]; extraFields: Record<string, string> },
    );
    expect(rows[0]?.shippingOptions).toEqual([]);
    expect(rows[0]?.extraFields.country_code).toBeUndefined();
    const published = await sellerApp.publish(planned.manifestId);
    expect(published).toMatchObject({ status: 'complete', published: 0, failed: 1 });
    expect(puts).toEqual([]);
  });
});
