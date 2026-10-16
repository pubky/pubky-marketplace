import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/database/franky/franky';
import {
  DexieManifestStore,
  type HostImportManifest,
  type HostPlannedImportRow,
  MANIFEST_CONFLICT,
} from '@/services/marketplace/marketplace-import-store';
import { MarketplaceShopClientService } from '@/services/marketplace/marketplace-shop-client';

const SELLER = 'y'.repeat(52);

function plannedRow(index: number): HostPlannedImportRow {
  return {
    sourceRow: index + 2,
    sourceIdentity: `listing-${index}#variant:default`,
    rowIdentity: `row-${index}`,
    normalizedHash: index.toString(16).padStart(64, '0'),
    listingIdentity: `listing:listing-${index}`,
    listingId: `listing-${index}`,
    generatedListingId: null,
    variantId: 'default',
    sku: `sku-${index}`,
    intendedAction: 'create',
    idempotencyKey: `00000000-0000-5000-8000-${index.toString(16).padStart(12, '0')}`,
    checkpoint: 'planned',
  };
}

function manifestOf(manifestId: string, rowCount: number): HostImportManifest {
  return {
    schemaVersion: 2,
    kind: 'pubky-shop-import-manifest',
    manifestId,
    manifestVersion: 1,
    sourceSha256: 'a'.repeat(64),
    sourceByteLength: '1',
    rowCount,
    parserVersion: '1',
    mappingVersion: '1',
    recordSchemaVersion: '1',
    createdAt: '2026-10-16T00:00:00.000Z',
    rows: Array.from({ length: rowCount }, (_, index) => plannedRow(index)),
  };
}

/** Row-table operations, counted in rows touched: what a checkpoint costs in IndexedDB. */
function countRowTable() {
  const rows = db.commerce_import_rows;
  const counts = { put: 0, bulkPut: 0, get: 0, bulkGet: 0, where: 0 };
  const put = rows.put.bind(rows);
  const bulkPut = rows.bulkPut.bind(rows);
  const get = rows.get.bind(rows);
  const bulkGet = rows.bulkGet.bind(rows);
  const where = rows.where.bind(rows);
  vi.spyOn(rows, 'put').mockImplementation((...args: Parameters<typeof put>) => {
    counts.put += 1;
    return put(...args);
  });
  vi.spyOn(rows, 'bulkPut').mockImplementation(((items: readonly unknown[], ...rest: unknown[]) => {
    counts.bulkPut += items.length;
    return (bulkPut as (...args: unknown[]) => unknown)(items, ...rest);
  }) as typeof bulkPut);
  vi.spyOn(rows, 'get').mockImplementation(((...args: unknown[]) => {
    counts.get += 1;
    return (get as (...args: unknown[]) => unknown)(...args);
  }) as typeof get);
  vi.spyOn(rows, 'bulkGet').mockImplementation(((keys: readonly unknown[]) => {
    counts.bulkGet += keys.length;
    return (bulkGet as (...args: unknown[]) => unknown)(keys);
  }) as typeof bulkGet);
  vi.spyOn(rows, 'where').mockImplementation(((...args: unknown[]) => {
    counts.where += 1;
    return (where as (...args: unknown[]) => unknown)(...args);
  }) as typeof where);
  return counts;
}

async function oneCheckpointCost(rowCount: number) {
  const manifestId = `cost-${rowCount}`;
  const store = new DexieManifestStore(SELLER);
  await store.create(manifestOf(manifestId, rowCount));
  const counts = countRowTable();
  const snapshot = await store.loadRows(manifestId, ['row-7']);
  const result = await MarketplaceShopClientService.checkpointRow(
    store,
    manifestId,
    snapshot!.manifestVersion,
    'row-7',
    'publishing',
  );
  vi.restoreAllMocks();
  expect(result.ok).toBe(true);
  await store.deleteManifest(manifestId);
  return counts;
}

describe('DexieManifestStore incremental checkpoints', () => {
  beforeEach(async () => {
    await db.open();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  it('costs the same row reads and writes per checkpoint for 50 rows as for 500', async () => {
    const small = await oneCheckpointCost(50);
    const large = await oneCheckpointCost(500);
    expect(small).toEqual({ put: 1, bulkPut: 0, get: 1, bulkGet: 1, where: 0 });
    expect(large).toEqual(small);
  });

  it('writes the one row and the header version, and leaves every other row record untouched', async () => {
    const store = new DexieManifestStore(SELLER);
    await store.create(manifestOf('untouched', 4));
    await store.persistPayloads('untouched', new Map([['row-2', '{"title":"Boots"}']]));
    const before = await db.commerce_import_rows.where('manifestId').equals('untouched').toArray();
    vi.useFakeTimers({ now: Date.parse('2030-01-01T00:00:00.000Z'), toFake: ['Date'] });
    const patched = await store.patchRow('untouched', 1, 'row-2', (row) => ({ ...row, checkpoint: 'publishing' }));
    vi.useRealTimers();
    expect(patched.manifest).toMatchObject({ manifestId: 'untouched', manifestVersion: 2 });
    expect(patched.manifest).not.toHaveProperty('rows');
    const after = await db.commerce_import_rows.where('manifestId').equals('untouched').toArray();
    for (const record of after) {
      const prior = before.find((entry) => entry.rowIdentity === record.rowIdentity)!;
      if (record.rowIdentity === 'row-2') {
        expect(record).toMatchObject({ checkpoint: 'publishing', payload_json: '{"title":"Boots"}' });
        expect(record.updated_at).toBe(Date.parse('2030-01-01T00:00:00.000Z'));
      } else {
        expect(record).toEqual(prior);
      }
    }
    const loaded = await store.load('untouched');
    expect(loaded?.manifestVersion).toBe(2);
    expect(loaded?.rows.map((row) => row.checkpoint)).toEqual(['planned', 'planned', 'publishing', 'planned']);
    await store.deleteManifest('untouched');
  });

  it('lets exactly one of two writers checkpoint the same row at one version', async () => {
    const store = new DexieManifestStore(SELLER);
    await store.create(manifestOf('same-row', 3));
    const results = await Promise.allSettled([
      store.patchRow('same-row', 1, 'row-1', (row) => ({ ...row, checkpoint: 'publishing' })),
      store.patchRow('same-row', 1, 'row-1', (row) => ({ ...row, checkpoint: 'failed' })),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as Error).message).toBe(MANIFEST_CONFLICT);
    const landed = (results.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<{
      row: HostPlannedImportRow;
    }>)!.value.row.checkpoint;
    const loaded = await store.load('same-row');
    expect(loaded?.manifestVersion).toBe(2);
    expect(loaded?.rows[1]?.checkpoint).toBe(landed);
    await store.deleteManifest('same-row');
  });

  it('conflicts a stale writer on a different row, and keeps both rows once it retries', async () => {
    const store = new DexieManifestStore(SELLER);
    await store.create(manifestOf('two-rows', 3));
    const [first, stale] = await Promise.allSettled([
      store.patchRow('two-rows', 1, 'row-0', (row) => ({ ...row, checkpoint: 'publishing' })),
      store.patchRow('two-rows', 1, 'row-2', (row) => ({ ...row, checkpoint: 'publishing' })),
    ]);
    expect(first.status).toBe('fulfilled');
    expect(stale.status).toBe('rejected');
    const fresh = await store.loadRows('two-rows', ['row-2']);
    expect(fresh?.manifestVersion).toBe(2);
    await store.patchRow('two-rows', fresh!.manifestVersion, 'row-2', (row) => ({ ...row, checkpoint: 'publishing' }));
    const loaded = await store.load('two-rows');
    expect(loaded?.manifestVersion).toBe(3);
    expect(loaded?.rows.map((row) => row.checkpoint)).toEqual(['publishing', 'planned', 'publishing']);
    await store.deleteManifest('two-rows');
  });

  it('shares one version guard with compareAndSwap, so neither writer can overwrite the other', async () => {
    const store = new DexieManifestStore(SELLER);
    await store.create(manifestOf('mixed', 2));
    await store.patchRow('mixed', 1, 'row-0', (row) => ({ ...row, checkpoint: 'publishing' }));
    await expect(
      store.compareAndSwap('mixed', 1, (current) => ({
        ...current,
        manifestVersion: 2,
        rows: current.rows.map((row) => ({ ...row, checkpoint: 'failed' as const })),
      })),
    ).rejects.toThrow(MANIFEST_CONFLICT);
    const swapped = await store.compareAndSwap('mixed', 2, (current) => ({
      ...current,
      manifestVersion: 3,
      rows: current.rows.map((row) => (row.rowIdentity === 'row-1' ? { ...row, failureCode: 'note' } : row)),
    }));
    expect(swapped.rows[0]?.checkpoint).toBe('publishing');
    await expect(store.patchRow('mixed', 2, 'row-1', (row) => row)).rejects.toThrow(MANIFEST_CONFLICT);
    expect((await store.load('mixed'))?.manifestVersion).toBe(3);
    await store.deleteManifest('mixed');
  });

  it('rejects a missing row, a changed identity, and another seller, writing nothing', async () => {
    const store = new DexieManifestStore(SELLER);
    await store.create(manifestOf('guarded', 2));
    await expect(store.patchRow('guarded', 1, 'row-9', (row) => row)).rejects.toThrow('manifest_store_error');
    await expect(store.patchRow('guarded', 1, 'row-0', (row) => ({ ...row, rowIdentity: 'row-1' }))).rejects.toThrow(
      'manifest_store_error',
    );
    await expect(new DexieManifestStore('z'.repeat(52)).patchRow('guarded', 1, 'row-0', (row) => row)).rejects.toThrow(
      MANIFEST_CONFLICT,
    );
    expect(await new DexieManifestStore('z'.repeat(52)).loadRows('guarded', ['row-0'])).toBeNull();
    const loaded = await store.load('guarded');
    expect(loaded?.manifestVersion).toBe(1);
    expect(loaded?.rows.every((row) => row.checkpoint === 'planned')).toBe(true);
    await store.deleteManifest('guarded');
  });

  it('reads the version with only the rows asked for, in the order asked', async () => {
    const store = new DexieManifestStore(SELLER);
    await store.create(manifestOf('subset', 5));
    const snapshot = await store.loadRows('subset', ['row-3', 'row-0', 'no-such-row']);
    expect(snapshot?.manifestVersion).toBe(1);
    expect(snapshot?.rows.map((row) => row.rowIdentity)).toEqual(['row-3', 'row-0']);
    await store.deleteManifest('subset');
  });

  it('keeps the transition table: an illegal hop is refused and writes nothing', async () => {
    const store = new DexieManifestStore(SELLER);
    await store.create(manifestOf('illegal', 1));
    const result = await MarketplaceShopClientService.checkpointRow(store, 'illegal', 1, 'row-0', 'complete');
    expect(result.ok).toBe(false);
    expect((await store.load('illegal'))?.manifestVersion).toBe(1);
    await store.deleteManifest('illegal');
  });
});
