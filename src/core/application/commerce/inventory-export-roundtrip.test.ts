import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceInventoryImportApplication } from '@/application/commerce/inventory-import';
import {
  type CanonicalImportRow,
  listingToCanonicalRows,
  mapCanonicalRowsToListing,
} from '@/application/commerce/inventory-listing-map';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { MarketplaceShopClientService, type SyncManyEnvelope } from '@/services/marketplace/marketplace-shop-client';
import { createRoundTripListings } from '@/test/fixtures/commerce/roundtrip-listings';
import { IMPORT_GATES_PASSING } from '@/test-utils/import-settings';
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

const NO_BEARER_SELLER = 'z'.repeat(52);

function syncOk(listings: readonly { listing_id: string }[]) {
  return {
    ok: true as const,
    value: asOpaque<SyncManyEnvelope>({
      schema_version: BigInt(1),
      kind: 'listing.sync_many',
      results: listings.map((listing) => ({ listing_id: listing.listing_id, status: 200 })),
    }),
  };
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : entry,
  );
}

describe('dashboard export CSV round-trips through the importer', () => {
  const listings = createRoundTripListings();
  const variantRows = listings.reduce((total, record) => total + record.variants.length, 0);
  let store: MemoryImportStore;
  let puts: CommerceListingRecord[];
  let syncCalls: string[][];

  beforeEach(() => {
    store = new MemoryImportStore();
    puts = [];
    syncCalls = [];
    vi.restoreAllMocks();
  });

  function importer() {
    return CommerceInventoryImportApplication.forSeller(PUBKY, {
      ...IMPORT_GATES_PASSING,
      store,
      localRecords: async () => listings,
      putListing: async (record) => {
        puts.push(record);
      },
      listingExists: async () => false,
      syncMany: async (batch) => {
        syncCalls.push(batch.map((listing) => listing.listing_id));
        return syncOk(batch);
      },
    });
  }

  function serveFromService(records: readonly CommerceListingRecord[], pageSize = 5) {
    return vi
      .spyOn(MarketplaceShopClientService, 'listSellerListings')
      .mockImplementation(async (_client, _pubky, query) => {
        const start = query?.cursor ? Number(query.cursor) : 0;
        const slice = records.slice(start, start + pageSize);
        const next = start + pageSize < records.length ? String(start + pageSize) : null;
        return {
          ok: true,
          value: asOpaque({ listings: slice.map((record) => ({ record })), next_cursor: next }),
        };
      });
  }

  async function exportedCsv(): Promise<Uint8Array> {
    serveFromService(listings);
    return importer().exportListingsCsv();
  }

  it('exports the canonical columns, one row per variant, with media references and record_json', async () => {
    const csv = new TextDecoder().decode(await exportedCsv());
    const header = (csv.split(/\r?\n/, 1)[0] ?? '').split(',').map((cell) => cell.replaceAll('"', ''));
    expect(header.slice(0, 5)).toEqual([
      'record_uri',
      'seller_pubky',
      'listing_id',
      'source_listing_key',
      'record_revision',
    ]);
    expect(header).toEqual(expect.arrayContaining(['media_json', 'shipping_options_json', 'sale_json', 'record_json']));
    expect(header).not.toContain('price_minor');
    expect(csv).toContain('/pub/pubky.app/marketplace/v1/media/img_a');
    expect(csv.trim().split(/\r?\n/).length).toBeGreaterThanOrEqual(variantRows + 1);
  });

  it('plans zero changes when all exported listings are imported back (service source, paged)', async () => {
    const csv = await exportedCsv();
    const planned = await importer().planFile(new BytesFile(csv, 'export.csv', 'text/csv'));
    expect(planned.status).toBe('planned');
    if (planned.status !== 'planned') return;
    expect(planned.rowCount).toBe(variantRows);
    expect(planned.counts).toEqual({ create: 0, update: 0, end: 0, unchanged: variantRows, conflict: 0 });
    const result = await importer().publish(planned.manifestId);
    expect(result).toMatchObject({ status: 'complete', published: 0, synced: 0, failed: 0 });
    expect(puts).toEqual([]);
    expect(syncCalls).toEqual([]);
  });

  it('exports and re-plans the same way from the local catalog when the service is unavailable', async () => {
    vi.spyOn(MarketplaceShopClientService, 'listSellerListings').mockResolvedValue({
      ok: false,
      error: asOpaque({ code: 'service_error', details: {}, message: 'down' }),
    });
    const csv = await importer().exportListingsCsv();
    const planned = await importer().planFile(new BytesFile(csv, 'export.csv', 'text/csv'));
    expect(planned).toMatchObject({
      status: 'planned',
      rowCount: variantRows,
      counts: { create: 0, update: 0, end: 0, unchanged: variantRows, conflict: 0 },
    });
  });

  it('exports from the local catalog for a seller without an Inventory grant', async () => {
    const local = CommerceInventoryImportApplication.forSeller(NO_BEARER_SELLER, {
      ...IMPORT_GATES_PASSING,
      localRecords: async () => listings,
    });
    const csv = new TextDecoder().decode(await local.exportListingsCsv());
    expect(csv).toContain('plain_01');
    expect(csv).toContain('second_12');
  });

  it('keeps every listing identical when the parsed export is mapped back to a record', async () => {
    const csv = await exportedCsv();
    const planned = await importer().planFile(new BytesFile(csv, 'export.csv', 'text/csv'));
    expect(planned.status).toBe('planned');
    if (planned.status !== 'planned') return;
    const manifest = await store.load(planned.manifestId);
    const byListing = new Map<string, CanonicalImportRow[]>();
    for (const row of manifest?.rows ?? []) {
      const json = await store.getPayloadJson(planned.manifestId, row.rowIdentity);
      const payload = JSON.parse(json ?? 'null') as CanonicalImportRow;
      byListing.set(row.listingId, [...(byListing.get(row.listingId) ?? []), payload]);
    }
    expect(byListing.size).toBe(listings.length);
    for (const original of listings) {
      const mapped = mapCanonicalRowsToListing(byListing.get(original.listingId) ?? [], PUBKY);
      expect(mapped.ok, original.listingId).toBe(true);
      if (mapped.ok) expect(stable(mapped.record), original.listingId).toBe(stable(original));
    }
  });

  it('plans exactly one update for one edited exported row, and publishes only that listing', async () => {
    const csv = new TextDecoder().decode(await exportedCsv());
    const edited = csv.replace(',"Second plain",', ',"Second plain, renamed",');
    expect(edited).not.toBe(csv);
    const planned = await importer().planFile(
      new BytesFile(new TextEncoder().encode(edited), 'edited.csv', 'text/csv'),
    );
    expect(planned.status).toBe('planned');
    if (planned.status !== 'planned') return;
    expect(planned.counts).toEqual({ create: 0, update: 1, end: 0, unchanged: variantRows - 1, conflict: 0 });

    const result = await importer().publish(planned.manifestId);
    expect(result).toMatchObject({ status: 'complete', published: 1, synced: 1, failed: 0 });
    expect(puts.map((record) => record.listingId)).toEqual(['second_12']);
    expect(puts[0]).toMatchObject({ title: 'Second plain, renamed', revision: 3, state: 'active' });
    expect(syncCalls).toEqual([['second_12']]);
  });

  it('applies edits to price, stock, SKU and state of one variant row without touching other record fields', async () => {
    const original = listings.find((record) => record.listingId === 'variants_02')!;
    const rows = listings.flatMap(listingToCanonicalRows).map((row) => {
      if (row.listingId !== 'variants_02') return row;
      const listingEdit = { ...row, amountMinor: 14_400, state: 'paused' };
      return row.variantId === 'size_41' ? { ...listingEdit, variantQuantity: 11, sku: 'BOOT-41-NEW' } : listingEdit;
    });
    const csv = MarketplaceShopClientService.exportListingsCsv(rows);
    const planned = await importer().planFile(new BytesFile(csv, 'edited.csv', 'text/csv'));
    expect(planned.status).toBe('planned');
    if (planned.status !== 'planned') return;
    expect(planned.counts).toEqual({
      create: 0,
      update: original.variants.length,
      end: 0,
      unchanged: variantRows - original.variants.length,
      conflict: 0,
    });
    await importer().publish(planned.manifestId);
    const record = puts.find((entry) => entry.listingId === 'variants_02')!;
    expect(record.revision).toBe(original.revision + 1);
    expect(record.state).toBe('paused');
    expect(record.sale).toMatchObject({
      format: 'fixed_price',
      unitPrice: { amountMinor: 14_400, currency: 'USD', exponent: 2 },
    });
    expect(record.variants.find((variant) => variant.id === 'size_41')).toMatchObject({
      quantity: 11,
      sku: 'BOOT-41-NEW',
      mediaIds: ['img_b'],
    });
    expect(record.variants.find((variant) => variant.id === 'size_42')?.priceOverride).toEqual({
      amountMinor: 13_900,
      currency: 'USD',
      exponent: 2,
    });
    expect(record.media).toEqual(original.media);
    expect(record.location).toEqual(original.location);
    expect(puts.map((entry) => entry.listingId)).toEqual(['variants_02']);
  });
});
