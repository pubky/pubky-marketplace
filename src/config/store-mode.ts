import { getStoreSeller as getConfiguredStoreSeller } from '@/libs/runtime-config/runtime-config';

/**
 * Store mode (`PUBKY_RUNTIME_STORE_SELLER`): the deployment is one seller's store on the
 * seller's own origin instead of the full Market. Read per call, like every runtime value.
 * Which routes a store serves is decided by `src/app/store-route-policy.ts`.
 */
export function getStoreSeller(): string | null {
  return getConfiguredStoreSeller() ?? null;
}

export function isStoreMode(): boolean {
  return getStoreSeller() !== null;
}

/**
 * Whether this page is a store opened outside a secure context (plain `http://` on a host other
 * than localhost). Grant sign-in needs WebCrypto and Web Locks, which browsers offer only in a
 * secure context, so the store shows how to open it over HTTPS instead. Always false on the server.
 */
export function isStoreModeInsecureContext(): boolean {
  return isStoreMode() && typeof window !== 'undefined' && !window.isSecureContext;
}
