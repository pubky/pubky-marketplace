import { DB_NAME } from '@/config/database';
import { deliveryKeyStoreDbName } from './delivery-key-store';

/** Inspect persisted rotation flags without adding a production enumeration API. */
export async function readStoredDeliveryKeyRows(owner: string): Promise<unknown[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(deliveryKeyStoreDbName(DB_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const request = db
        .transaction('keys', 'readonly')
        .objectStore('keys')
        .getAll(IDBKeyRange.bound(`${owner}|`, `${owner}|\uffff`));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
