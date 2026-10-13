import { DatabaseErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';

// Public identifiers only. Each entry has its own key so concurrent tabs cannot
// overwrite another tab's cleanup obligations with a read/modify/write race.
const PREFIX = 'shop-owned-grant-v1:';
type Obligation = { version: 1; kind: 'key' | 'record'; id: string; expiresAt: number };
const active = new Set<string>();
const key = (kind: Obligation['kind'], id: string) => `${PREFIX}${kind}:${id}`;

function storageFailure(cause?: unknown) {
  return Err.database(
    DatabaseErrorCode.INIT_FAILED,
    'Browser storage is blocked. Enable storage to sign in securely.',
    {
      service: ErrorService.Homeserver,
      operation: 'ownedGrantStorage',
      cause,
    },
  );
}

/** Check before creating a delegated key so blocked storage cannot strand a new key. */
export function assertOwnedGrantStorageAvailable(): void {
  const probe = `shop-grant-storage-probe:${crypto.randomUUID()}`;
  try {
    localStorage.setItem(probe, '1');
    if (localStorage.getItem(probe) !== '1') throw storageFailure();
    localStorage.removeItem(probe);
  } catch (error) {
    throw storageFailure(error);
  }
}

export function rememberOwnedGrant(kind: Obligation['kind'], id: string, expiresAt = 0): void {
  const entry: Obligation = { version: 1, kind, id, expiresAt };
  const name = key(kind, id);
  try {
    localStorage.setItem(name, JSON.stringify(entry));
    if (localStorage.getItem(name) !== JSON.stringify(entry)) throw storageFailure();
    if (expiresAt) active.add(name);
  } catch (error) {
    throw storageFailure(error);
  }
}

export function forgetOwnedGrant(kind: Obligation['kind'], id: string): void {
  const name = key(kind, id);
  localStorage.removeItem(name);
  active.delete(name);
}

export function retireOwnedGrant(kind: Obligation['kind'], id: string): void {
  active.delete(key(kind, id));
  rememberOwnedGrant(kind, id);
}

export function pendingOwnedGrants(): Obligation[] {
  const entries: Obligation[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const name = localStorage.key(i);
    if (!name?.startsWith(PREFIX) || active.has(name)) continue;
    const entry = JSON.parse(localStorage.getItem(name) ?? 'null') as Obligation;
    if (
      !entry ||
      entry.version !== 1 ||
      (entry.kind !== 'key' && entry.kind !== 'record') ||
      typeof entry.id !== 'string' ||
      !entry.id ||
      typeof entry.expiresAt !== 'number'
    )
      throw storageFailure();
    if (entry.expiresAt <= Date.now()) entries.push(entry);
  }
  return entries;
}

/**
 * SDK 0.16 has no public per-flow key removal API. This compatibility adapter
 * deletes ONLY a key ID obtained from this Shop flow's saveDelegated(). It
 * never enumerates key records, credentials, or App sessions. Unknown database
 * versions/schemas fail closed and keep the public cleanup marker.
 */
export async function removeOwnedDelegatedKey(id: string): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pubky-auth', 1);
    request.onupgradeneeded = () => {
      request.transaction?.abort();
    };
    request.onblocked = () => reject(storageFailure());
    request.onerror = () => reject(storageFailure(request.error));
    request.onsuccess = () => resolve(request.result);
  });
  try {
    if (
      db.version !== 1 ||
      !db.objectStoreNames.contains('delegatedGrantKeys') ||
      !db.objectStoreNames.contains('storedSessions')
    )
      throw storageFailure();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('delegatedGrantKeys', 'readwrite');
      const store = tx.objectStore('delegatedGrantKeys');
      if (store.keyPath !== 'keyId') {
        tx.abort();
        reject(storageFailure());
        return;
      }
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(storageFailure(tx.error));
    });
  } finally {
    db.close();
  }
}

export function delegatedKeyId(saved: string): string {
  const state: unknown = JSON.parse(saved);
  if (!state || typeof state !== 'object') throw storageFailure();
  const value = state as { key_id?: unknown; client_pk?: unknown; authorization_url?: unknown };
  // Pinned SDK 0.16 pending-flow schema (not the stored credential schema).
  if (
    typeof value.key_id !== 'string' ||
    !value.key_id ||
    typeof value.client_pk !== 'string' ||
    typeof value.authorization_url !== 'string'
  ) {
    throw storageFailure();
  }
  return value.key_id;
}
