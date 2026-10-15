import { shopStorageKey } from '@/libs/storage-namespace/storage-namespace';

// A cleanup boundary only: this public identity cannot restore any session.
const KEY = shopStorageKey('host-last-identity-v1');
export function readHostIdentity(): string | null {
  return globalThis.localStorage?.getItem(KEY) || null;
}
export function writeHostIdentity(pubky: string | null): void {
  if (pubky) globalThis.localStorage?.setItem(KEY, pubky);
  else globalThis.localStorage?.removeItem(KEY);
}
