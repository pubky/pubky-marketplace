const OWN_DROPS_STORAGE_KEY_PREFIX = 'marketplace:own-drops:';

/** The `localStorage` key of the drops one account published from this browser. */
export function ownDropsStorageKey(accountPubky: string): string {
  return `${OWN_DROPS_STORAGE_KEY_PREFIX}${accountPubky}`;
}
