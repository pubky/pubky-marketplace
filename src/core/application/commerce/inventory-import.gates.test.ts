import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceInventoryImportApplication } from '@/application/commerce/inventory-import';
import { listingToCanonicalRows } from '@/application/commerce/inventory-listing-map';
import type { SellerDeliveryKeyPublication } from '@/libs/commerce/listing-publish-guards';
import type { CommerceListingRecord, CommerceShopRecord } from '@/libs/commerce/marketplace-records';
import type { SellerPaymentConfig } from '@/libs/commerce/payment-methods';
import { DEFAULT_IMPORT_SETTINGS } from '@/pipes/commerce/import-settings';
import { MarketplaceShopClientService, type SyncManyEnvelope } from '@/services/marketplace/marketplace-shop-client';
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
  let stored: CommerceListingRecord[];
  let putFailure: ((record: CommerceListingRecord) => Error | null) | null;

  beforeEach(() => {
    store = new MemoryImportStore();
    puts = [];
    paymentLoads = 0;
    keyLoads = 0;
    payment = async () => WITH_METHOD;
    key = async () => 'matches';
    stored = [];
    putFailure = null;
  });

  function app() {
    return CommerceInventoryImportApplication.forSeller(PUBKY, {
      store,
      currentItems: async () =>
        MarketplaceShopClientService.currentItemsFromRows(stored.flatMap(listingToCanonicalRows)),
      localRecords: async () => stored,
      putListing: async (record) => {
        const failure = putFailure?.(record);
        if (failure) throw failure;
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
      expect(planned.publishGate).toEqual({ reason: null, ships: true, pausing: 0, keptLive: [] });
      const published = await importer.publish(planned.manifestId);
      expect(published).toMatchObject({ status: 'complete', published: 2 });
      expect(published.status === 'complete' && published.paused).toBeUndefined();
      expect(states()).toEqual({ boots_01: 'active', guide_01: 'active' });
    });

    it('does not ask for the delivery key when nothing in the file ships', async () => {
      const { importer, planned } = await plan([digital('guide_01'), digital('guide_02')]);
      expect(planned.publishGate).toEqual({ reason: null, ships: false, pausing: 0, keptLive: [] });
      await importer.publish(planned.manifestId);
      expect(keyLoads).toBe(0);
      expect(states()).toEqual({ guide_01: 'active', guide_02: 'active' });
    });
  });

  describe('payment-method gate', () => {
    it('blocks when the seller has no payment method: the dry run says why and every listing is saved paused', async () => {
      payment = async () => NO_METHOD;
      const { importer, planned } = await plan([physical('boots_01'), digital('guide_01')]);
      expect(planned.publishGate).toEqual({ reason: 'no-method', ships: true, pausing: 2, keptLive: [] });

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
        expect(planned.publishGate).toEqual({ reason: 'no-delivery-key', ships: true, pausing: 2, keptLive: [] });

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
      expect(planned.publishGate).toEqual({ reason: null, ships: false, pausing: 0, keptLive: [] });
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

describe('re-importing a listing that is live while a gate blocks', () => {
  let store: MemoryImportStore;
  let puts: CommerceListingRecord[];
  let stored: CommerceListingRecord[];
  let paymentLoads: number;
  let payment: SellerPaymentConfig;
  let key: SellerDeliveryKeyPublication;
  let failOn: string | null;

  beforeEach(() => {
    store = new MemoryImportStore();
    puts = [];
    stored = [];
    paymentLoads = 0;
    payment = WITH_METHOD;
    key = 'matches';
    failOn = null;
  });

  function app() {
    return CommerceInventoryImportApplication.forSeller(PUBKY, {
      store,
      currentItems: async () =>
        MarketplaceShopClientService.currentItemsFromRows(stored.flatMap(listingToCanonicalRows)),
      localRecords: async () => stored,
      putListing: async (record) => {
        if (failOn === record.listingId) throw new Error('homeserver unreachable');
        puts.push(record);
      },
      listingExists: async () => false,
      syncMany: async (listings) => syncAll(listings),
      loadPaymentConfig: async () => {
        paymentLoads += 1;
        return payment;
      },
      loadDeliveryKeyPublication: async () => key,
      loadShop: async () => null,
    });
  }

  const live = (listingId: string, overrides: Partial<CommerceListingRecord> = {}) =>
    createCommerceListingFixture({ listingId, ownerPubky: PUBKY, revision: 3, ...overrides });

  /** The seller's stored listing, edited in the file: a new title and price at the stored revision. */
  const edited = (record: CommerceListingRecord): CommerceListingRecord => ({
    ...record,
    title: `${record.title} (resoled)`,
    sale:
      record.sale.format === 'fixed_price'
        ? { ...record.sale, unitPrice: { ...record.sale.unitPrice, amountMinor: 14_900 } }
        : record.sale,
  });

  async function reimport(file: CommerceListingRecord[]) {
    const importer = app();
    const planned = await importer.planFile(jsonFile(file));
    if (planned.status !== 'planned') throw new Error('plan');
    return { importer, planned };
  }

  const putFor = (listingId: string) => puts.find((record) => record.listingId === listingId);

  it('keeps an active listing active under a payment block, updating its content and continuing its revision', async () => {
    payment = NO_METHOD;
    const boots = live('boots_01');
    stored = [boots];
    const { importer, planned } = await reimport([edited(boots)]);

    expect(planned.counts).toMatchObject({ update: 1, create: 0 });
    expect(planned.publishGate).toEqual({
      reason: 'no-method',
      ships: true,
      pausing: 0,
      keptLive: [{ listingId: 'boots_01', title: boots.title }],
    });

    const published = await importer.publish(planned.manifestId);

    const record = putFor('boots_01');
    expect(record).toMatchObject({
      state: 'active',
      revision: 4,
      title: `${boots.title} (resoled)`,
      createdAt: boots.createdAt,
    });
    expect(record?.sale.format === 'fixed_price' && record.sale.unitPrice.amountMinor).toBe(14_900);
    expect(published).toMatchObject({ status: 'complete', published: 1, keptLive: 1, keptLiveReason: 'no-method' });
    expect(published.status === 'complete' && published.paused).toBeUndefined();
    expect(published.status === 'complete' && published.message).toBe(
      '1 listing was kept live; fix payment method to keep publishing.',
    );
    const csv = await importer.resultCsv(planned.manifestId);
    expect(csv).toContain('"synced, kept live; fix payment method to keep publishing"');
    expect(csv).not.toContain('paused,');
    expect(paymentLoads).toBe(2);
  });

  it('keeps a shipping listing active under a delivery-key block, and still updates its shipping facts', async () => {
    key = 'missing';
    const boots = live('boots_01');
    stored = [boots];
    const changed = edited(boots);
    changed.shippingOptions = [
      { id: 'ship_01', pricing: 'free', label: 'Free shipping', estimatedMinDays: 2, estimatedMaxDays: 5 },
    ];
    const { importer, planned } = await reimport([changed]);
    expect(planned.publishGate.reason).toBe('no-delivery-key');
    expect(planned.publishGate.keptLive).toHaveLength(1);

    const published = await importer.publish(planned.manifestId);

    const record = putFor('boots_01');
    expect(record?.state).toBe('active');
    expect(record?.shippingOptions?.[0]).toMatchObject({ pricing: 'free', estimatedMinDays: 2 });
    expect(published).toMatchObject({ keptLive: 1, keptLiveReason: 'no-delivery-key' });
    const csv = await importer.resultCsv(planned.manifestId);
    expect(csv).toContain('"synced, kept live; fix delivery key to keep publishing"');
    expect(csv).not.toContain('skipped:');
  });

  it('skips a switch from digital to shipping, reports it, and keeps the digital listing live', async () => {
    key = 'missing';
    const guide = createCommerceListingFixture({
      listingId: 'guide_01',
      ownerPubky: PUBKY,
      revision: 2,
      fulfillmentMethods: ['digital'],
      package: undefined,
      shippingOptions: [],
    });
    stored = [guide];
    const shipping = createCommerceListingFixture({ listingId: 'guide_01', ownerPubky: PUBKY, revision: 2 });
    const { importer, planned } = await reimport([{ ...shipping, title: 'Field guide, printed' }]);
    expect(planned.publishGate).toMatchObject({ reason: 'no-delivery-key', ships: true });

    const published = await importer.publish(planned.manifestId);

    const record = putFor('guide_01');
    expect(record).toMatchObject({ state: 'active', title: 'Field guide, printed', fulfillmentMethods: ['digital'] });
    expect(record?.package).toBeUndefined();
    expect(record?.shippingOptions).toEqual([]);
    expect(published.status === 'complete' && published.message).toBe(
      '1 listing was kept live; fix delivery key to keep publishing. 1 change was skipped.',
    );
    expect(await importer.resultCsv(planned.manifestId)).toContain(
      '"synced, kept live; fix delivery key to keep publishing; skipped: switch to shipping"',
    );
  });

  it('also skips a switch to shipping under a payment block, since the delivery key is then unchecked', async () => {
    payment = NO_METHOD;
    const guide = digital('guide_01');
    stored = [{ ...guide, revision: 2 }];
    const { importer, planned } = await reimport([{ ...physical('guide_01'), revision: 2 }]);
    await importer.publish(planned.manifestId);
    expect(putFor('guide_01')?.fulfillmentMethods).toEqual(['digital']);
    expect(putFor('guide_01')?.state).toBe('active');
  });

  it('does not keep live a listing whose row pauses it, or one that is already paused', async () => {
    payment = NO_METHOD;
    const boots = live('boots_01');
    const hat = live('hat_01', { state: 'paused' });
    stored = [boots, hat];
    const { importer, planned } = await reimport([{ ...edited(boots), state: 'paused' }, edited(hat)]);
    // Both rows already say paused, so the gate has nothing to pause or keep live.
    expect(planned.publishGate).toMatchObject({ pausing: 0, keptLive: [] });
    const published = await importer.publish(planned.manifestId);
    expect(putFor('boots_01')?.state).toBe('paused');
    expect(putFor('hat_01')?.state).toBe('paused');
    expect(published.status === 'complete' && published.keptLive).toBeUndefined();
  });

  it('handles a mixed file: live listings stay live, new and paused ones are saved paused, digital ones live under a key block', async () => {
    key = 'missing';
    const boots = live('boots_01');
    const hat = live('hat_01', { state: 'paused' });
    const guide = { ...digital('guide_01'), revision: 3 };
    stored = [boots, hat, guide];
    const { importer, planned } = await reimport([
      edited(boots),
      edited(hat),
      physical('new_01'),
      digital('new_digital_01'),
      edited(guide),
    ]);
    expect(planned.publishGate).toMatchObject({
      reason: 'no-delivery-key',
      pausing: 1,
      keptLive: [{ listingId: 'boots_01', title: boots.title }],
    });

    const published = await importer.publish(planned.manifestId);

    expect(Object.fromEntries(puts.map((record) => [record.listingId, record.state]))).toEqual({
      boots_01: 'active',
      hat_01: 'paused',
      new_01: 'paused',
      new_digital_01: 'active',
      guide_01: 'active',
    });
    expect(published).toMatchObject({ status: 'complete', published: 5, keptLive: 1, paused: 1 });
    expect(published.status === 'complete' && published.message).toContain('1 listing was saved as paused');
    expect(published.status === 'complete' && published.message).toContain(
      '1 listing was kept live; fix delivery key to keep publishing.',
    );
    const csv = await importer.resultCsv(planned.manifestId);
    expect(csv.match(/kept live; fix delivery key to keep publishing/g)).toHaveLength(1);
    expect(csv.match(/paused, no delivery key published/g)).toHaveLength(1);
  });

  it('updates a live listing in full, with no skips, when the gates pass', async () => {
    const boots = live('boots_01');
    stored = [boots];
    const { importer, planned } = await reimport([edited(boots)]);
    expect(planned.publishGate).toEqual({ reason: null, ships: true, pausing: 0, keptLive: [] });
    const published = await importer.publish(planned.manifestId);
    expect(putFor('boots_01')).toMatchObject({ state: 'active', revision: 4 });
    expect(published.status === 'complete' && published.keptLive).toBeUndefined();
    expect(await importer.resultCsv(planned.manifestId)).not.toContain('kept live');
  });

  /** What an interrupted run leaves behind: the later listings are still planned. */
  async function markPlanned(manifestId: string, listingIds: string[]) {
    const manifest = await store.load(manifestId);
    if (!manifest) throw new Error('manifest');
    await store.compareAndSwap(manifestId, manifest.manifestVersion, (current) => ({
      ...current,
      manifestVersion: current.manifestVersion + 1,
      rows: current.rows.map((row) =>
        listingIds.includes(row.listingId) ? { ...row, checkpoint: 'planned', failureCode: undefined } : row,
      ),
    }));
  }

  it('resumes after a partial publish: the first listing stays live, the rest are saved, and the summary counts both runs', async () => {
    payment = NO_METHOD;
    const boots = live('boots_01');
    const hat = live('hat_01', { state: 'paused' });
    stored = [boots, hat];
    const { importer, planned } = await reimport([
      edited(boots),
      { ...edited(hat), state: 'active' },
      physical('new_01'),
    ]);
    expect(planned.publishGate).toMatchObject({
      pausing: 2,
      keptLive: [{ listingId: 'boots_01', title: boots.title }],
    });

    failOn = 'hat_01';
    const first = await importer.publish(planned.manifestId);
    expect(first).toMatchObject({ status: 'error' });
    expect(puts.map((record) => record.listingId)).toEqual(['boots_01']);
    expect(putFor('boots_01')?.state).toBe('active');
    await markPlanned(planned.manifestId, ['hat_01']);

    failOn = null;
    paymentLoads = 0;
    const resumed = await importer.resume(planned.manifestId);

    expect(paymentLoads).toBe(1);
    expect(puts.map((record) => record.listingId)).toEqual(['boots_01', 'hat_01', 'new_01']);
    expect(Object.fromEntries(puts.map((record) => [record.listingId, record.state]))).toEqual({
      boots_01: 'active',
      hat_01: 'paused',
      new_01: 'paused',
    });
    expect(resumed).toMatchObject({ status: 'complete', keptLive: 1, paused: 2, keptLiveReason: 'no-method' });
    const csv = await importer.resultCsv(planned.manifestId);
    expect(csv.match(/kept live; fix payment method to keep publishing/g)).toHaveLength(1);
    expect(csv.match(/paused, no payment method set up/g)).toHaveLength(2);
  });

  it('fails the one listing, leaving the live one as it was, when the combined record is not valid', async () => {
    payment = NO_METHOD;
    const boots = live('boots_01');
    stored = [boots];
    const invalid = edited(boots);
    invalid.title = 'x'.repeat(200);
    const { importer, planned } = await reimport([invalid]);
    const published = await importer.publish(planned.manifestId);
    expect(puts).toEqual([]);
    expect(published).toMatchObject({ status: 'complete', published: 0, failed: 1 });
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
