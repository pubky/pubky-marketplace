import { featureDiscoveryPubkyPrefixes } from '@/config/featureDiscovery';
import { ordersSeenStorageKey } from '@/libs/commerce/marketplace-attention';
import { ownDropsStorageKey } from '@/libs/commerce/own-drops-storage';

/**
 * Removes the `localStorage` entries that embed one account's pubky in their key, so a signed-out
 * account leaves nothing of its own on a shared device:
 *
 * - `pubky.marketplace.ordersSeen.<pubky>`: the orders checkpoint behind the Orders badge
 * - `marketplace:own-drops:<pubky>`: the drops published from this browser
 * - `<shop namespace>pubky-feature-discovery:<pubky>:<feature>` and the same under the pre-namespace
 *   prefix: dismissed notes and badges
 *
 * Device-wide entries (the Shop's persisted stores and the feature flags with no pubky segment) are
 * not touched. Returns the keys it removed.
 */
export function clearPubkyLocalStorage(pubky: string, storage?: Storage): string[] {
  if (pubky.trim() === '') return [];
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target) return [];
    const exact = new Set([ordersSeenStorageKey(pubky), ownDropsStorageKey(pubky)]);
    const prefixes = featureDiscoveryPubkyPrefixes(pubky);
    const doomed: string[] = [];
    for (let index = 0; index < target.length; index++) {
      const key = target.key(index);
      if (key !== null && (exact.has(key) || prefixes.some((prefix) => key.startsWith(prefix)))) doomed.push(key);
    }
    for (const key of doomed) target.removeItem(key);
    return doomed;
  } catch {
    // Storage unavailable (private mode): nothing could have been written.
    return [];
  }
}
