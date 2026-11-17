import type { AuthStore } from './auth.types';

type SignInSnapshot = Pick<AuthStore, 'session'>;
type UserSnapshot = Pick<AuthStore, 'session' | 'currentUserPubky'>;
type ProfileSnapshot = Pick<AuthStore, 'session' | 'hasProfile'>;

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

/**
 * The signed-in state or the profile flag differs between two snapshots. A
 * restore and a grant sign-in set the session first and `hasProfile` later, and
 * the pollers require both, so the later change is the one that starts them.
 */
export function signInOrProfileChanged(state: ProfileSnapshot, prevState: ProfileSnapshot): boolean {
  return signInChanged(state, prevState) || state.hasProfile !== prevState.hasProfile;
}

/**
 * The signed-in account was replaced or left: a sign-out or an account switch.
 * A cold load's `null` to pubky is not one, and neither is a transient session
 * drop of the same account (a cross-tab renewal, a new host snapshot).
 */
export function accountLeft(state: UserSnapshot, prevState: UserSnapshot): boolean {
  return prevState.currentUserPubky !== null && state.currentUserPubky !== prevState.currentUserPubky;
}
