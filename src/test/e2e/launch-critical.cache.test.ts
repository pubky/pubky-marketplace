import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedListingCacheRows } from './launch-critical.cache.mjs';

const dbName = 'shop-franky';
const listing = { id: 'seller:listing', record: { title: 'Fixture listing' } };
const shopRecord = { id: 'seller', record: { title: 'Fixture shop' } };

async function createSchema(version: number, stores: string[]) {
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open(dbName, version);
    open.onupgradeneeded = () => {
      for (const name of stores) open.result.createObjectStore(name, { keyPath: 'id' });
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      open.result.close();
      resolve();
    };
  });
}

async function readRows() {
  return new Promise<unknown[]>((resolve, reject) => {
    const open = indexedDB.open(dbName);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(['commerce_listings', 'commerce_shops']);
      const listings = tx.objectStore('commerce_listings').getAll();
      const shops = tx.objectStore('commerce_shops').getAll();
      tx.oncomplete = () => {
        db.close();
        resolve([listings.result, shops.result]);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

describe('launch fixture cache readiness', () => {
  beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('waits for both stores after the application version probe creates an empty database', async () => {
    await createSchema(1, []);
    const seed = seedListingCacheRows({ listing, shopRecord, dbName, timeoutMs: 1_000, pollMs: 5 }).catch(
      (error: unknown) => error,
    );
    // The real app probes the version before recreating the database with its schema.
    await new Promise((resolve) => setTimeout(resolve, 30));
    await createSchema(2, ['commerce_listings']);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await createSchema(3, ['commerce_shops']);
    expect(await seed).toBe(true);
    expect(await readRows()).toEqual([[listing], [shopRecord]]);
  });

  it('times out without creating an absent application database', async () => {
    const open = vi.spyOn(indexedDB, 'open');
    await expect(seedListingCacheRows({ listing, shopRecord, timeoutMs: 50, pollMs: 5 })).rejects.toThrow(
      'database absent',
    );
    expect(open).not.toHaveBeenCalled();
    expect(await indexedDB.databases()).toEqual([]);
  });

  it('aborts creation if the database disappeared after enumeration', async () => {
    vi.spyOn(indexedDB, 'databases').mockResolvedValueOnce([{ name: dbName, version: 1 }]);
    await expect(seedListingCacheRows({ listing, shopRecord, timeoutMs: 50, pollMs: 5 })).rejects.toThrow('timed out');
    expect(await indexedDB.databases()).toEqual([]);
  });

  it('fails with the missing schema instead of silently skipping the seed', async () => {
    await createSchema(1, ['commerce_listings']);
    await expect(seedListingCacheRows({ listing, shopRecord, timeoutMs: 50, pollMs: 5 })).rejects.toThrow(
      'missing stores commerce_shops',
    );
  });

  it('resolves only when both fixture rows are committed and readable on a new connection', async () => {
    await createSchema(1, ['commerce_listings', 'commerce_shops']);
    await expect(seedListingCacheRows({ listing, shopRecord })).resolves.toBe(true);
    expect(await readRows()).toEqual([[listing], [shopRecord]]);
  });

  it('commits a cart line in the same transaction as the listing it points at', async () => {
    const cartItem = { id: 'buyer|seller:listing|v1', owner_id: 'buyer', listing_id: 'seller:listing' };
    await createSchema(1, ['commerce_listings', 'commerce_shops', 'commerce_cart_items']);
    await expect(seedListingCacheRows({ listing, shopRecord, cartItem })).resolves.toBe(true);
    expect(await readRows()).toEqual([[listing], [shopRecord]]);
    const carts = await new Promise<unknown[]>((resolve, reject) => {
      const open = indexedDB.open(dbName);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const request = open.result.transaction('commerce_cart_items').objectStore('commerce_cart_items').getAll();
        request.onsuccess = () => {
          open.result.close();
          resolve(request.result);
        };
        request.onerror = () => reject(request.error);
      };
    });
    expect(carts).toEqual([cartItem]);
  });

  it('waits for the cart store before seeding a cart line', async () => {
    await createSchema(1, ['commerce_listings', 'commerce_shops']);
    await expect(
      seedListingCacheRows({ listing, shopRecord, cartItem: { id: 'line' }, timeoutMs: 50, pollMs: 5 }),
    ).rejects.toThrow('missing stores commerce_cart_items');
  });

  it('rejects an aborted write transaction and leaves neither fixture row committed', async () => {
    await createSchema(1, ['commerce_listings', 'commerce_shops']);
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = put.apply(this, args);
      if (this.name === 'commerce_shops') {
        request.addEventListener('success', () => this.transaction.abort());
      }
      return request;
    });
    await expect(seedListingCacheRows({ listing, shopRecord, timeoutMs: 1_000 })).rejects.toThrow(
      'Fixture cache transaction aborted',
    );
    expect(await readRows()).toEqual([[], []]);
  });
});
