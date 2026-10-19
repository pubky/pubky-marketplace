/**
 * Device custody for seller delivery keys and buyer pins (design:
 * docs/ecommerce/encrypted-delivery-address-design.md §C).
 *
 * Lives in its own IndexedDB database, deliberately NOT in the Dexie cache:
 * sign-out wipes the cache, and a seller who signs out must still be able to
 * open the addresses sealed to a key they published earlier. Records are keyed by
 * the owning account, so another account on the same browser profile never
 * sees them.
 *
 * Seller private keys are wrapped with the AES-GCM helper in
 * `./secret-wrapping` under a NON-EXTRACTABLE device key, and each
 * wrapped key is bound to its owner and key id by AAD. Fail closed: with no
 * WebCrypto or IndexedDB every call throws; there is no plaintext fallback.
 */

import { DB_NAME } from '@/config/database';
import { base64UrlToBytes, bytesToBase64Url } from '@/libs/commerce/priv-envelope';
import { buildWrapAad, unwrapPayload, wrapPayload } from '@/libs/crypto/secret-wrapping';
import { DatabaseErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';

const DB_VERSION = 2;
const WRAPPING_STORE = 'wrapping-key';
const KEYS_STORE = 'keys';
const PINS_STORE = 'pins';
const RECORDS_STORE = 'records';
const WRAPPING_KEY_ID = 'wrapping-key';
const WRAP_TABLE = 'marketplace_delivery_keys';
const RECORDS_WRAP_TABLE = 'marketplace_device_records';

export const deliveryKeyStoreDbName = (databaseName: string) => `${databaseName}-delivery-keys`;
const STORE_DB_NAME = deliveryKeyStoreDbName(DB_NAME);

type StoredKeyRow = {
  owner: string;
  keyId: string;
  publicKey: string;
  createdAt: string;
  current: boolean;
  wrappedPrivateKey: Uint8Array;
};

type PinRow = { owner: string; seller: string; keyId: string; firstSeenAt: string };

export type StoredDeliveryKey = { keyId: string; publicKey: Uint8Array; createdAt: string; current: boolean };
export type DeliveryKeyPin = { sellerPubky: string; keyId: string; firstSeenAt: string };

let dbPromise: Promise<IDBDatabase> | null = null;
let cachedWrappingKey: CryptoKey | null = null;

function fail(operation: string, message: string, cause?: unknown): never {
  throw Err.database(DatabaseErrorCode.INIT_FAILED, message, { service: ErrorService.Local, operation, cause });
}

function assertAvailable(operation: string): void {
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.subtle !== 'object' || crypto.subtle === null) {
    fail(operation, 'WebCrypto is unavailable; delivery key custody cannot operate and never falls back to plaintext.');
  }
  if (typeof indexedDB === 'undefined') {
    fail(operation, 'IndexedDB is unavailable; delivery key custody cannot operate.');
  }
}

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(STORE_DB_NAME, DB_VERSION);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Failed to open the delivery key database'));
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WRAPPING_STORE)) db.createObjectStore(WRAPPING_STORE);
      if (!db.objectStoreNames.contains(KEYS_STORE)) db.createObjectStore(KEYS_STORE);
      if (!db.objectStoreNames.contains(PINS_STORE)) db.createObjectStore(PINS_STORE);
      if (!db.objectStoreNames.contains(RECORDS_STORE)) db.createObjectStore(RECORDS_STORE);
    };
    request.onsuccess = () => {
      const connection = request.result;
      connection.onversionchange = () => {
        connection.close();
        dbPromise = null;
        cachedWrappingKey = null;
      };
      resolve(connection);
    };
  });
  return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Delivery key store request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Delivery key store transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Delivery key store transaction aborted'));
  });
}

function isUsableWrappingKey(candidate: unknown): candidate is CryptoKey {
  const key = candidate as CryptoKey | undefined;
  return (
    typeof key === 'object' &&
    key !== null &&
    key.type === 'secret' &&
    key.algorithm?.name === 'AES-GCM' &&
    Array.isArray(key.usages) &&
    key.usages.includes('encrypt') &&
    key.usages.includes('decrypt')
  );
}

/**
 * Reads or creates the device wrapping key in one readwrite transaction, so
 * two tabs racing first use serialize on IndexedDB and adopt the same key.
 * A stored record that is not a usable key is never replaced: replacing it
 * would orphan every wrapped private key, so that is a hard failure.
 */
async function wrappingKey(operation: string): Promise<CryptoKey> {
  if (cachedWrappingKey) return cachedWrappingKey;
  assertAvailable(operation);
  try {
    const db = await openDb();
    const generated = await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const transaction = db.transaction(WRAPPING_STORE, 'readwrite');
    const store = transaction.objectStore(WRAPPING_STORE);
    const existing: unknown = await requestResult(store.get(WRAPPING_KEY_ID));
    let key: CryptoKey;
    if (existing === undefined) {
      store.add(generated, WRAPPING_KEY_ID);
      key = generated;
    } else if (isUsableWrappingKey(existing)) {
      key = existing;
    } else {
      transaction.abort();
      throw new Error('The stored delivery wrapping key is unusable');
    }
    await transactionDone(transaction);
    cachedWrappingKey = key;
    return key;
  } catch (error) {
    return fail(
      operation,
      'Failed to load or create the delivery key wrapping key; refusing to operate without it.',
      error,
    );
  }
}

const rowId = (owner: string, keyId: string) => `${owner}|${keyId}`;
const wrapAad = (owner: string, keyId: string) => buildWrapAad(WRAP_TABLE, rowId(owner, keyId));

function toPublic(row: StoredKeyRow): StoredDeliveryKey {
  return {
    keyId: row.keyId,
    publicKey: base64UrlToBytes(row.publicKey),
    createdAt: row.createdAt,
    current: row.current,
  };
}

async function readAllRows(db: IDBDatabase, owner: string): Promise<StoredKeyRow[]> {
  const range = IDBKeyRange.bound(`${owner}|`, `${owner}|\uffff`);
  const rows = (await requestResult(
    db.transaction(KEYS_STORE, 'readonly').objectStore(KEYS_STORE).getAll(range),
  )) as StoredKeyRow[];
  return rows.filter((row) => row.owner === owner);
}

/**
 * Stores a new keypair for `owner` and makes it the current key. Earlier
 * private keys are kept so orders sealed to them still open.
 */
export async function storeDeliveryKey(
  owner: string,
  pair: { keyId: string; publicKey: Uint8Array; privateKey: Uint8Array },
  createdAt: Date,
): Promise<StoredDeliveryKey> {
  const key = await wrappingKey('storeDeliveryKey');
  try {
    const wrapped = await wrapPayload(key, wrapAad(owner, pair.keyId), pair.privateKey);
    const db = await openDb();
    const transaction = db.transaction(KEYS_STORE, 'readwrite');
    const store = transaction.objectStore(KEYS_STORE);
    const existing = (await requestResult(
      store.getAll(IDBKeyRange.bound(`${owner}|`, `${owner}|\uffff`)),
    )) as StoredKeyRow[];
    for (const row of existing) {
      if (row.owner === owner && row.current) store.put({ ...row, current: false }, rowId(owner, row.keyId));
    }
    const row: StoredKeyRow = {
      owner,
      keyId: pair.keyId,
      publicKey: bytesToBase64Url(pair.publicKey),
      createdAt: createdAt.toISOString(),
      current: true,
      wrappedPrivateKey: wrapped,
    };
    store.put(row, rowId(owner, pair.keyId));
    await transactionDone(transaction);
    return toPublic(row);
  } catch (error) {
    return fail('storeDeliveryKey', 'Failed to store the delivery key.', error);
  }
}

export async function getCurrentDeliveryKey(owner: string): Promise<StoredDeliveryKey | null> {
  assertAvailable('getCurrentDeliveryKey');
  try {
    const rows = await readAllRows(await openDb(), owner);
    const current = rows.find((row) => row.current);
    return current ? toPublic(current) : null;
  } catch (error) {
    return fail('getCurrentDeliveryKey', 'Failed to read the delivery key.', error);
  }
}

export async function listDeliveryKeys(owner: string): Promise<StoredDeliveryKey[]> {
  assertAvailable('listDeliveryKeys');
  try {
    const rows = await readAllRows(await openDb(), owner);
    return rows.map(toPublic).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    return fail('listDeliveryKeys', 'Failed to list delivery keys.', error);
  }
}

/**
 * The private key for `keyId`, or `null` when this device holds no such key
 * (it was created elsewhere, or the browser profile was cleared). Throws when
 * a key is stored but cannot be unwrapped. The caller owns the returned bytes
 * and should zero them after use.
 */
export async function getDeliveryPrivateKey(owner: string, keyId: string): Promise<Uint8Array | null> {
  const key = await wrappingKey('getDeliveryPrivateKey');
  try {
    const db = await openDb();
    const row = (await requestResult(
      db.transaction(KEYS_STORE, 'readonly').objectStore(KEYS_STORE).get(rowId(owner, keyId)),
    )) as StoredKeyRow | undefined;
    if (!row || row.owner !== owner) return null;
    return await unwrapPayload(key, wrapAad(owner, keyId), row.wrappedPrivateKey);
  } catch (error) {
    return fail('getDeliveryPrivateKey', 'Failed to unwrap the delivery private key.', error);
  }
}

export async function getDeliveryKeyPin(owner: string, sellerPubky: string): Promise<DeliveryKeyPin | null> {
  assertAvailable('getDeliveryKeyPin');
  try {
    const db = await openDb();
    const row = (await requestResult(
      db.transaction(PINS_STORE, 'readonly').objectStore(PINS_STORE).get(rowId(owner, sellerPubky)),
    )) as PinRow | undefined;
    return row ? { sellerPubky: row.seller, keyId: row.keyId, firstSeenAt: row.firstSeenAt } : null;
  } catch (error) {
    return fail('getDeliveryKeyPin', 'Failed to read the delivery key pin.', error);
  }
}

/** Pins `keyId` for `sellerPubky`. An existing pin keeps its `firstSeenAt`. */
export async function putDeliveryKeyPin(
  owner: string,
  sellerPubky: string,
  keyId: string,
  now: Date,
): Promise<DeliveryKeyPin> {
  assertAvailable('putDeliveryKeyPin');
  try {
    const db = await openDb();
    const transaction = db.transaction(PINS_STORE, 'readwrite');
    const store = transaction.objectStore(PINS_STORE);
    const id = rowId(owner, sellerPubky);
    const existing = (await requestResult(store.get(id))) as PinRow | undefined;
    const row: PinRow = { owner, seller: sellerPubky, keyId, firstSeenAt: existing?.firstSeenAt ?? now.toISOString() };
    store.put(row, id);
    await transactionDone(transaction);
    return { sellerPubky, keyId, firstSeenAt: row.firstSeenAt };
  } catch (error) {
    return fail('putDeliveryKeyPin', 'Failed to store the delivery key pin.', error);
  }
}

/**
 * Device-bound sealed records for one account (the seller's Shippo token,
 * ship-from address and purchased label references). The bytes are wrapped
 * under the same non-extractable device key as the delivery private keys and
 * bound to `owner` and `recordId` by AAD, so a row copied to another id or
 * account fails to open. These never leave the device.
 */
const recordWrapAad = (owner: string, recordId: string) => buildWrapAad(RECORDS_WRAP_TABLE, rowId(owner, recordId));

export async function putDeviceRecord(owner: string, recordId: string, plaintext: Uint8Array): Promise<void> {
  const key = await wrappingKey('putDeviceRecord');
  try {
    const wrapped = await wrapPayload(key, recordWrapAad(owner, recordId), plaintext);
    const db = await openDb();
    const transaction = db.transaction(RECORDS_STORE, 'readwrite');
    transaction.objectStore(RECORDS_STORE).put(wrapped, rowId(owner, recordId));
    await transactionDone(transaction);
  } catch (error) {
    return fail('putDeviceRecord', 'Failed to store the device record.', error);
  }
}

/** The record's plaintext, or `null` when this device holds none. Throws when a stored record cannot be unwrapped. */
export async function getDeviceRecord(owner: string, recordId: string): Promise<Uint8Array | null> {
  const key = await wrappingKey('getDeviceRecord');
  try {
    const db = await openDb();
    const wrapped = (await requestResult(
      db.transaction(RECORDS_STORE, 'readonly').objectStore(RECORDS_STORE).get(rowId(owner, recordId)),
    )) as Uint8Array | undefined;
    if (!wrapped) return null;
    return await unwrapPayload(key, recordWrapAad(owner, recordId), wrapped);
  } catch (error) {
    return fail('getDeviceRecord', 'Failed to open the device record.', error);
  }
}

export async function deleteDeviceRecord(owner: string, recordId: string): Promise<void> {
  assertAvailable('deleteDeviceRecord');
  try {
    const db = await openDb();
    const transaction = db.transaction(RECORDS_STORE, 'readwrite');
    transaction.objectStore(RECORDS_STORE).delete(rowId(owner, recordId));
    await transactionDone(transaction);
  } catch (error) {
    return fail('deleteDeviceRecord', 'Failed to delete the device record.', error);
  }
}

/** Test seam: drops the in-memory handles and deletes the database. Never used in production. */
export async function resetDeliveryKeyStoreForTests(): Promise<void> {
  cachedWrappingKey = null;
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      // The delete below is what matters.
    }
    dbPromise = null;
  }
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(STORE_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** Test seam: drops only the in-memory cache, simulating a reload. */
export function dropDeliveryKeyStoreCacheForTests(): void {
  cachedWrappingKey = null;
}
