import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceInventoryImportApplication } from '@/application/commerce/inventory-import';
import { listingToCanonicalRows } from '@/application/commerce/inventory-listing-map';
import { type ConnectorCatalogProduct, connectorCatalogProductSchema } from '@/libs/commerce/connectors';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { mapConnectorCatalog } from '@/pipes/commerce/connector-catalog-rows';
import type { ImportSettings } from '@/pipes/commerce/import-settings';
import { MarketplaceShopClientService, type SyncManyEnvelope } from '@/services/marketplace/marketplace-shop-client';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { IMPORT_GATES_PASSING, IMPORT_SETTINGS_COMPLETE } from '@/test-utils/import-settings';
import { BytesFile, MemoryImportStore } from '@/test-utils/inventory-import-harness';
import { asOpaque } from '@/test-utils/type-assertions';

const PUBKY = 'y'.repeat(52);

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return {
    ...actual,
    getCommerceAdapterMode: () => 'transaction-service',
    getMarketplaceUrl: () => 'https://marketplace-service.example.test',
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

const SETTINGS: ImportSettings = { ...IMPORT_SETTINGS_COMPLETE, currency: 'USD', countryCode: 'US' };
const NO_PAYMENT_METHOD = async () => ({
  bitcoinAvailable: false,
  bitcoinOfferAvailable: true,
  paypalAvailable: false,
});

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

function storeProduct(id: string, title: string, amountMinor: number): ConnectorCatalogProduct {
  return connectorCatalogProductSchema.parse({
    providerProductId: id,
    title,
    description: 'From the store.',
    imageUrls: ['https://shop.example/a.jpg'],
    variants: [
      {
        providerVariantId: `${id}1`,
        sku: `SKU-${id}`,
        price: { amountMinor, currency: 'USD', exponent: 2 },
        stock: 4,
      },
    ],
  });
}

describe('a connector re-import of a live listing, with a publish gate blocking (C16)', () => {
  let store: MemoryImportStore;
  let puts: CommerceListingRecord[];
  let stored: CommerceListingRecord[];

  beforeEach(() => {
    store = new MemoryImportStore();
    puts = [];
    stored = [];
  });

  function app(gatesBlocked: boolean) {
    return CommerceInventoryImportApplication.forSeller(PUBKY, {
      ...IMPORT_GATES_PASSING,
      ...(gatesBlocked ? { loadPaymentConfig: NO_PAYMENT_METHOD } : {}),
      store,
      currentItems: async () =>
        MarketplaceShopClientService.currentItemsFromRows(stored.flatMap(listingToCanonicalRows)),
      localRecords: async () => stored,
      putListing: async (record) => {
        puts.push(record);
        stored = [...stored.filter((entry) => entry.listingId !== record.listingId), record];
      },
      listingExists: async () => false,
      syncMany: async (listings) => syncAll(listings),
    });
  }

  /** The connector rows as a JSON import, as the Studio plans them. */
  function importFile(products: ConnectorCatalogProduct[]) {
    const { rows } = mapConnectorCatalog({ products, provider: 'woocommerce', sellerPubky: PUBKY, settings: SETTINGS });
    return new BytesFile(new TextEncoder().encode(JSON.stringify(rows)), 'store.json', 'application/json');
  }

  /** Stands in for the photo step, which attaches the uploaded media to the planned rows. */
  function attachPhotos() {
    const media = JSON.stringify(createCommerceListingFixture().media);
    for (const [key, value] of store.payloads) {
      const row = JSON.parse(value) as { extraFields: Record<string, string> };
      store.payloads.set(key, JSON.stringify({ ...row, extraFields: { ...row.extraFields, media_json: media } }));
    }
  }

  async function run(products: ConnectorCatalogProduct[], gatesBlocked: boolean) {
    const importer = app(gatesBlocked);
    const planned = await importer.planFile(importFile(products), SETTINGS);
    if (planned.status !== 'planned') throw new Error('plan');
    attachPhotos();
    const published = await importer.publish(planned.manifestId);
    return { importer, planned, published };
  }

  const stateOf = (listingId: string) => stored.find((entry) => entry.listingId === listingId)?.state;
  const putsFor = (listingId: string) => puts.filter((entry) => entry.listingId === listingId);

  it('publishes a first import live when the gates pass', async () => {
    const { planned } = await run([storeProduct('1', 'Socks', 2500)], false);
    expect(planned.publishGate.reason).toBeNull();
    expect(stateOf('woo-1')).toBe('active');
  });

  it('keeps the listing live, updates its content and says so when a gate blocks the second import', async () => {
    await run([storeProduct('1', 'Socks', 2500)], false);
    expect(stateOf('woo-1')).toBe('active');

    const { importer, planned, published } = await run([storeProduct('1', 'Socks, warm edition', 3000)], true);

    expect(planned.counts).toMatchObject({ create: 0, update: 1, conflict: 0 });
    expect(planned.publishGate).toMatchObject({
      reason: 'no-method',
      pausing: 0,
      keptLive: [{ listingId: 'woo-1', title: 'Socks' }],
    });
    expect(putsFor('woo-1')).toHaveLength(2);
    expect(putsFor('woo-1').map((entry) => entry.state)).toEqual(['active', 'active']);
    const latest = puts.at(-1);
    expect(latest).toMatchObject({ listingId: 'woo-1', state: 'active', title: 'Socks, warm edition' });
    expect(latest?.sale.format === 'fixed_price' && latest.sale.unitPrice.amountMinor).toBe(3000);
    expect(stateOf('woo-1')).toBe('active');
    expect(published).toMatchObject({ status: 'complete', keptLive: 1, keptLiveReason: 'no-method' });
    expect(published.status === 'complete' && published.message).toBe(
      '1 listing was kept live; fix payment method to keep publishing.',
    );
    const csv = await importer.resultCsv(planned.manifestId);
    expect(csv).toContain('"synced, kept live; fix payment method to keep publishing"');
    expect(csv).not.toContain('paused,');
  });

  it('still saves a new product paused beside it, while the live one stays live', async () => {
    await run([storeProduct('1', 'Socks', 2500)], false);

    const { planned } = await run([storeProduct('1', 'Socks', 2600), storeProduct('2', 'Hat', 1800)], true);

    expect(planned.counts).toMatchObject({ create: 1, update: 1 });
    expect(planned.publishGate).toMatchObject({ reason: 'no-method', pausing: 1 });
    expect(stateOf('woo-1')).toBe('active');
    expect(stateOf('woo-2')).toBe('paused');
    expect(putsFor('woo-1').every((entry) => entry.state === 'active')).toBe(true);
  });

  it('keeps a split-mode listing live the same way', async () => {
    const variants = (price: number) =>
      connectorCatalogProductSchema.parse({
        providerProductId: '7',
        title: 'Socks',
        imageUrls: ['https://shop.example/a.jpg'],
        variants: [
          {
            providerVariantId: '71',
            optionValues: [{ name: 'Size', value: 'S' }],
            price: { amountMinor: price, currency: 'USD', exponent: 2 },
            stock: 3,
          },
        ],
      });
    const splitFile = (price: number) => {
      const { rows } = mapConnectorCatalog({
        products: [variants(price)],
        provider: 'woocommerce',
        sellerPubky: PUBKY,
        settings: SETTINGS,
        variantMode: 'split',
      });
      return new BytesFile(new TextEncoder().encode(JSON.stringify(rows)), 'split.json', 'application/json');
    };
    const importer = app(false);
    const first = await importer.planFile(splitFile(2500), SETTINGS);
    if (first.status !== 'planned') throw new Error('plan');
    attachPhotos();
    await importer.publish(first.manifestId);
    expect(stateOf('woo-7-71')).toBe('active');

    const blocked = app(true);
    const second = await blocked.planFile(splitFile(2700), SETTINGS);
    if (second.status !== 'planned') throw new Error('plan');
    attachPhotos();
    await blocked.publish(second.manifestId);

    expect(stateOf('woo-7-71')).toBe('active');
    expect(putsFor('woo-7-71')).toHaveLength(2);
    expect(putsFor('woo-7-71').every((entry) => entry.state === 'active')).toBe(true);
    expect(puts.at(-1)?.title).toBe('Socks, S');
  });
});
