/**
 * Browser keys the retired seller "Connect Lock Server" step wrote: the Lock
 * Server creator frontend session (a creator bearer) and the pending connect
 * nonce. Nothing reads them any more; sign-out and account switches remove
 * them so a bearer saved by an older Shop does not outlive the account.
 */
export const RETIRED_LOCKS_SESSION_STORAGE_KEYS = [
  'pubky.marketplace.locks-frontend-session.v1',
  'marketplace:locks-connect-state',
] as const;

export class RetiredLocksSessionStorage {
  private constructor() {}

  static clear(): void {
    if (typeof window === 'undefined') return;
    for (const key of RETIRED_LOCKS_SESSION_STORAGE_KEYS) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Removal failing means storage is unavailable, so nothing persisted either.
      }
    }
  }
}
