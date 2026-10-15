import { DB_NAME } from '@/config/database';
import { db } from '@/database/franky/franky';

export const PUBLIC_CACHE_TABLES: ReadonlySet<string> = new Set([
  'user_counts',
  'user_details',
  'user_ttl',
  'post_counts',
  'post_details',
  'post_relationships',
  'post_ttl',
  'file_details',
  'tag_streams',
  'commerce_shops',
  'commerce_listings',
  'commerce_catalog_entries',
  'commerce_listing_projections',
]);

/**
 * Device-local rows keyed by `owner_id`. Identity switch and sign-out must
 * not wipe another identity's book — ADR-0019 keeps addresses off the
 * homeserver, so they live here across sessions on this device.
 */
export const IDENTITY_SCOPED_DEVICE_TABLES: ReadonlySet<string> = new Set(['commerce_delivery_addresses']);

/** IndexedDB database of the retired encrypted-messaging keyring, deleted once on boot. */
export const LEGACY_MESSAGING_KEYRING_DB_NAME = `${DB_NAME}-messaging-keyring`;

function tablesClearedOnIdentitySwitch(includePublicCache: boolean) {
  return db.tables.filter((table) => {
    if (IDENTITY_SCOPED_DEVICE_TABLES.has(table.name)) return false;
    if (!includePublicCache && PUBLIC_CACHE_TABLES.has(table.name)) return false;
    return true;
  });
}

export async function clearDatabase(): Promise<void> {
  if (!db.isOpen()) {
    await db.open();
  }
  await Promise.all(tablesClearedOnIdentitySwitch(true).map((table) => table.clear()));
}

export async function clearPrivateData(): Promise<void> {
  if (!db.isOpen()) {
    await db.open();
  }
  await Promise.all(tablesClearedOnIdentitySwitch(false).map((table) => table.clear()));
}

/**
 * Removes the IndexedDB database the retired encrypted-messaging transport
 * kept its wrapping key in. Best-effort and idempotent; a blocked delete
 * (another tab still holds it open) is retried on the next boot.
 */
export function deleteLegacyMessagingKeyring(): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(LEGACY_MESSAGING_KEYRING_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

export async function resetDatabase(): Promise<void> {
  const { indexedDB } = await import('fake-indexeddb');

  db.close();
  indexedDB.deleteDatabase(DB_NAME);
  await db.open();
}
