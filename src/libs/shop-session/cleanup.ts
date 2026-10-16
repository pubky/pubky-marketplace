import type { ShopHostSnapshot } from './bridge';

// Shared with App: a public cleanup boundary, never a credential or SDK pointer.
const APPLIED_EPOCH_KEY = 'shop-host-cleanup-epoch-v1';
export function readAppliedHostCleanupEpoch(): string | null {
  return localStorage.getItem(APPLIED_EPOCH_KEY);
}
export function writeAppliedHostCleanupEpoch(epoch: string): void {
  localStorage.setItem(APPLIED_EPOCH_KEY, epoch);
}

export async function withShopHostCleanupLock<T>(run: () => Promise<T>): Promise<T> {
  return globalThis.navigator?.locks ? navigator.locks.request('pubky-shop-host-cleanup', run) : run();
}

/** Fence a queued bridge snapshot against an App transition whose message is still in flight. */
export function isCurrentHostCleanupSnapshot(snapshot: ShopHostSnapshot): boolean {
  const raw = localStorage.getItem('auth-store-v3');
  // An older host with no durable state still receives first-visit cleanup. Once
  // another App tab has committed a boundary, its state also fences older hosts.
  if (!raw) {
    const freshGuest =
      snapshot.status === 'signed-out' &&
      snapshot.generation === '' &&
      snapshot.shopCleanupEpoch === '' &&
      snapshot.pubky === null &&
      snapshot.sessionStoreId === null &&
      snapshot.grantId === null &&
      snapshot.clientId === null;
    return snapshot.shopCleanupEpoch === undefined || freshGuest;
  }
  const state = (JSON.parse(raw) as { state?: Record<string, unknown> }).state;
  return Boolean(
    state &&
    (state.shopCleanupEpoch ?? '') === (snapshot.shopCleanupEpoch ?? '') &&
    state.generation === snapshot.generation &&
    (state.currentUserPubky ?? null) === snapshot.pubky,
  );
}
