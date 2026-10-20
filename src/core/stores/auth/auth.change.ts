import type { AuthStore } from './auth.types';

type SignInSnapshot = Pick<AuthStore, 'session'>;
type UserSnapshot = Pick<AuthStore, 'session' | 'currentUserPubky'>;

/**
 * Signed in, read from a snapshot of the auth store.
 *
 * The store's `selectIsAuthenticated` reads the live store, so calling it on
 * the `prevState` a subscription receives compares the current state with
 * itself; use these on the two snapshots instead. They matter on a cold load:
 * the persisted pubky is hydrated first and the session arrives later from the
 * restore, and that arrival is the change a coordinator waits for.
 */
export function isSignedIn(state: SignInSnapshot): boolean {
  return state.session !== null;
}

/** The signed-in state differs between two snapshots. */
export function signInChanged(state: SignInSnapshot, prevState: SignInSnapshot): boolean {
  return isSignedIn(state) !== isSignedIn(prevState);
}

/** The signed-in state or the signed-in account differs between two snapshots. */
export function signedInUserChanged(state: UserSnapshot, prevState: UserSnapshot): boolean {
  return signInChanged(state, prevState) || state.currentUserPubky !== prevState.currentUserPubky;
}
