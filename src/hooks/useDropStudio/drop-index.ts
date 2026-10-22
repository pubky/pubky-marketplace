/**
 * Device-local index of the drop ids this account has published FROM THIS
 * BROWSER, keyed per account in localStorage.
 *
 * Enumeration authority is `CommerceController.listOwnDropIds()` (the
 * homeserver drops directory, cross-device). This index is only a freshness
 * supplement merged in by `useOwnDrops` — it keeps a drop published moments
 * ago visible even if a directory listing lags or fails, and it is NEVER
 * treated as authority: every id is re-read from the homeserver record
 * (`fetchDrop`) and the transaction service (`getOwnDrop`) before anything
 * renders.
 */

import { ownDropsStorageKey } from '@/libs/commerce/own-drops-storage';

function readRaw(accountPubky: string): string[] {
  try {
    const raw = window.localStorage.getItem(ownDropsStorageKey(accountPubky));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  } catch {
    return [];
  }
}

/** Drop ids remembered for this account, newest publish first. */
export function readOwnDropIndex(accountPubky: string): string[] {
  return readRaw(accountPubky);
}

/** Prepends a freshly published drop id (idempotent, newest first). */
export function rememberOwnDrop(accountPubky: string, dropId: string): void {
  const existing = readRaw(accountPubky).filter((id) => id !== dropId);
  try {
    window.localStorage.setItem(ownDropsStorageKey(accountPubky), JSON.stringify([dropId, ...existing]));
  } catch {
    // Quota/private-mode failures only lose the device-local shortcut — the
    // homeserver record and the service aggregate are unaffected.
  }
}

/** Removes an id whose homeserver record no longer exists. */
export function forgetOwnDrop(accountPubky: string, dropId: string): void {
  const remaining = readRaw(accountPubky).filter((id) => id !== dropId);
  try {
    if (remaining.length === 0) {
      window.localStorage.removeItem(ownDropsStorageKey(accountPubky));
    } else {
      window.localStorage.setItem(ownDropsStorageKey(accountPubky), JSON.stringify(remaining));
    }
  } catch {
    // Same non-fatal failure mode as rememberOwnDrop.
  }
}
