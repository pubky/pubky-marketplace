import { FEATURE_DISCOVERY_STORAGE_PREFIX, LEGACY_FEATURE_DISCOVERY_STORAGE_PREFIX } from '@/config/featureDiscovery';
import { getStorageAdoptLegacy } from '@/config/storage-namespace';
import { Logger } from '@/libs/logger/logger';
import { migrateLegacyLocalStorage } from '@/libs/storage-namespace/migrate-legacy-local-storage';
import { legacyStorageKey, shopStorageKey } from '@/libs/storage-namespace/storage-namespace';

// Namespaced so the Shop and pubky.app can share one origin (see `@/libs/storage-namespace`).
export const AUTH_PERSIST_KEY = shopStorageKey('auth-store');
export const NOTIFICATION_PERSIST_KEY = shopStorageKey('notification-store');
export const SEARCH_PERSIST_KEY = shopStorageKey('search-store');
export const HOME_PERSIST_KEY = shopStorageKey('home-store');
export const HOT_PERSIST_KEY = shopStorageKey('hot-store');
export const SETTINGS_PERSIST_KEY = shopStorageKey('settings-storage');
export const MARKETPLACE_DISPLAY_PERSIST_KEY = shopStorageKey('marketplace-display-storage');
export const BUYER_COUNTRY_PERSIST_KEY = shopStorageKey('buyer-country-storage');
export const SELLER_PAYMENT_CONFIRM_PERSIST_KEY = shopStorageKey('seller-payment-confirm-storage');
export const MIGRATION_STORE_KEY = 'migration-store';

// List of all persisted store keys (Local storage keys)
// EX: MIGRATION_STORE_KEY won't be included in this list because it's not a persisted store key.
export const PERSISTED_STORE_KEYS = [
  AUTH_PERSIST_KEY,
  NOTIFICATION_PERSIST_KEY,
  SEARCH_PERSIST_KEY,
  HOME_PERSIST_KEY,
  HOT_PERSIST_KEY,
  SETTINGS_PERSIST_KEY,
  MARKETPLACE_DISPLAY_PERSIST_KEY,
  BUYER_COUNTRY_PERSIST_KEY,
] as const;

/**
 * Moves an existing Shop user's pre-namespace entries (`auth-store`, `settings-storage`,
 * the feature-discovery flags, ...) to the names above. It runs here, as this module is
 * evaluated, because Zustand `persist` reads its key while each store module loads: every
 * persisted store imports this file first, so the entries are in place before any store
 * hydrates. A recorded outcome makes every later call a no-op.
 */
function migrateLegacyBrowserLocalStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const result = migrateLegacyLocalStorage(
      window.localStorage,
      {
        keys: Object.fromEntries(PERSISTED_STORE_KEYS.map((key) => [legacyStorageKey(key), key])),
        prefixes: { [`${LEGACY_FEATURE_DISCOVERY_STORAGE_PREFIX}:`]: `${FEATURE_DISCOVERY_STORAGE_PREFIX}:` },
      },
      { adopt: getStorageAdoptLegacy() },
    );
    if (result.status === 'failed') {
      Logger.warn('Could not migrate the Shop browser storage to its namespace; retrying on the next load', {
        error: result.error,
        moved: result.moved,
      });
    }
  } catch (error) {
    Logger.warn('Browser storage is unavailable; skipping the Shop storage namespace migration', { error });
  }
}

migrateLegacyBrowserLocalStorage();

/**
 * Whether the record the retired onboarding store persisted still holds key material.
 * A record that can't be read counts as holding a key, so it is never deleted on a guess.
 */
function retiredOnboardingRecordHoldsKey(raw: string): boolean {
  try {
    const record: unknown = JSON.parse(raw);
    const state = (record as { state?: { secretKey?: unknown; mnemonic?: unknown } } | null)?.state;
    if (!state || typeof state !== 'object') return true;
    return Boolean(state.secretKey) || Boolean(state.mnemonic);
  } catch {
    return true;
  }
}

/**
 * Shop signup is retired and nothing reads the record its onboarding store persisted.
 * Remove it once it holds no key. A record that still holds a `secretKey` or `mnemonic`
 * may be the only browser copy of a key that was never backed up, so it stays.
 * Only the Shop-namespaced name is considered: the un-prefixed `onboarding-storage`
 * can belong to pubky.app on a shared origin and is never touched.
 */
function removeRetiredOnboardingStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const key = shopStorageKey('onboarding-storage');
    const raw = window.localStorage.getItem(key);
    if (raw === null || retiredOnboardingRecordHoldsKey(raw)) return;
    window.localStorage.removeItem(key);
  } catch {
    // Storage is unavailable, so nothing could have been persisted.
  }
}

removeRetiredOnboardingStorage();
