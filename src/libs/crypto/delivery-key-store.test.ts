import { beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME } from '@/config/database';
import { deliveryKeyId } from '@/libs/commerce/delivery-envelope';
import {
  deliveryKeyStoreDbName,
  dropDeliveryKeyStoreCacheForTests,
  getCurrentDeliveryKey,
  getDeliveryKeyPin,
  getDeliveryPrivateKey,
  listDeliveryKeys,
  putDeliveryKeyPin,
  resetDeliveryKeyStoreForTests,
  storeDeliveryKey,
} from './delivery-key-store';

const OWNER = 'o'.repeat(52);
const OTHER_OWNER = 'p'.repeat(52);
const SELLER = 's'.repeat(52);

function fakePair() {
  const publicKey = crypto.getRandomValues(new Uint8Array(32));
  const privateKey = crypto.getRandomValues(new Uint8Array(32));
  return { keyId: deliveryKeyId(publicKey), publicKey, privateKey };
}

describe('delivery key store', () => {
  beforeEach(async () => {
    await resetDeliveryKeyStoreForTests();
  });

  it('stores a key, reports it as current and unwraps the private half', async () => {
    const pair = fakePair();
    const stored = await storeDeliveryKey(OWNER, pair, new Date('2026-10-12T10:00:00.000Z'));
    expect(stored).toMatchObject({ keyId: pair.keyId, current: true, createdAt: '2026-10-12T10:00:00.000Z' });
    expect(stored.publicKey).toEqual(pair.publicKey);
    expect((await getCurrentDeliveryKey(OWNER))?.keyId).toBe(pair.keyId);
    expect(await getDeliveryPrivateKey(OWNER, pair.keyId)).toEqual(pair.privateKey);
  });

  it('survives a reload: the wrapping key persists and old keys still open after rotation', async () => {
    const first = fakePair();
    const second = fakePair();
    await storeDeliveryKey(OWNER, first, new Date('2026-10-12T10:00:00.000Z'));
    dropDeliveryKeyStoreCacheForTests();
    await storeDeliveryKey(OWNER, second, new Date('2026-10-13T10:00:00.000Z'));
    dropDeliveryKeyStoreCacheForTests();

    expect((await getCurrentDeliveryKey(OWNER))?.keyId).toBe(second.keyId);
    expect((await listDeliveryKeys(OWNER)).map((key) => [key.keyId, key.current])).toEqual([
      [second.keyId, true],
      [first.keyId, false],
    ]);
    expect(await getDeliveryPrivateKey(OWNER, first.keyId)).toEqual(first.privateKey);
    expect(await getDeliveryPrivateKey(OWNER, second.keyId)).toEqual(second.privateKey);
  });

  it('keeps one account from seeing or opening another account key', async () => {
    const pair = fakePair();
    await storeDeliveryKey(OWNER, pair, new Date());
    expect(await getCurrentDeliveryKey(OTHER_OWNER)).toBeNull();
    expect(await listDeliveryKeys(OTHER_OWNER)).toEqual([]);
    expect(await getDeliveryPrivateKey(OTHER_OWNER, pair.keyId)).toBeNull();
  });

  it('returns null for a key id this device never held', async () => {
    await storeDeliveryKey(OWNER, fakePair(), new Date());
    expect(await getDeliveryPrivateKey(OWNER, 'f'.repeat(32))).toBeNull();
  });

  it('does not hold the private key in plaintext at rest', async () => {
    const pair = fakePair();
    await storeDeliveryKey(OWNER, pair, new Date());
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(deliveryKeyStoreDbName(DB_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<{ wrappedPrivateKey: Uint8Array }[]>((resolve, reject) => {
      const request = db.transaction('keys', 'readonly').objectStore('keys').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    expect(rows).toHaveLength(1);
    const wrapped = rows[0]!.wrappedPrivateKey;
    expect(wrapped.byteLength).toBe(12 + 32 + 16);
    expect(Buffer.from(wrapped).includes(Buffer.from(pair.privateKey))).toBe(false);
  });

  it('refuses a wrapped key that was moved to another key id', async () => {
    const a = fakePair();
    const b = fakePair();
    await storeDeliveryKey(OWNER, a, new Date());
    await storeDeliveryKey(OWNER, b, new Date());
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(deliveryKeyStoreDbName(DB_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('keys', 'readwrite');
      const store = transaction.objectStore('keys');
      const read = store.get(`${OWNER}|${a.keyId}`);
      read.onsuccess = () => store.put({ ...read.result, keyId: b.keyId }, `${OWNER}|${b.keyId}`);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
    await expect(getDeliveryPrivateKey(OWNER, b.keyId)).rejects.toThrow();
  });

  it('pins a seller key once and keeps the first-seen time when re-pinned', async () => {
    expect(await getDeliveryKeyPin(OWNER, SELLER)).toBeNull();
    await putDeliveryKeyPin(OWNER, SELLER, 'a'.repeat(32), new Date('2026-10-12T10:00:00.000Z'));
    const repinned = await putDeliveryKeyPin(OWNER, SELLER, 'b'.repeat(32), new Date('2026-10-14T10:00:00.000Z'));
    expect(repinned).toEqual({ sellerPubky: SELLER, keyId: 'b'.repeat(32), firstSeenAt: '2026-10-12T10:00:00.000Z' });
    expect(await getDeliveryKeyPin(OWNER, SELLER)).toEqual(repinned);
    expect(await getDeliveryKeyPin(OTHER_OWNER, SELLER)).toBeNull();
  });
});
