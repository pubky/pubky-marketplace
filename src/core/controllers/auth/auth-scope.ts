import { readAuthEpoch } from '@/controllers/auth/auth-epoch';

/**
 * Same-tab fence for work done on behalf of the signed-in identity.
 *
 * `endAuthScope` runs synchronously when a sign-out or an identity change
 * begins, before any await. Work captures the signal when it starts and checks
 * it before each write (local or remote), so a pass that finishes later never
 * writes for the identity that left. Work started afterwards captures the next
 * scope. The cross-tab counterpart is `auth-epoch`.
 */
let scope = new AbortController();

export function captureAuthScope(): AbortSignal {
  return scope.signal;
}

/** Called by AuthController only, when a sign-out or an identity change begins. */
export function endAuthScope(): void {
  const ended = scope;
  scope = new AbortController();
  ended.abort();
}

/** Reject late account-local writes after either this tab or another tab ended the captured session. */
export function captureAuthWriteGuard(): () => void {
  const signal = captureAuthScope();
  const epoch = readAuthEpoch();
  return () => {
    signal.throwIfAborted();
    if (readAuthEpoch() !== epoch) throw new DOMException('The account session ended.', 'AbortError');
  };
}
