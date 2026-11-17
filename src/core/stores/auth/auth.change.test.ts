import type { Session } from '@synonymdev/pubky';
import { describe, expect, it } from 'vitest';
import { asOpaque } from '@/test-utils/type-assertions';
import { accountLeft, isSignedIn, signedInUserChanged, signInChanged, signInOrProfileChanged } from './auth.change';

const session = asOpaque<Session>({});
const out = { session: null, currentUserPubky: null };
const alice = { session, currentUserPubky: 'alice' };
const aliceHydrated = { session: null, currentUserPubky: 'alice' };
const bob = { session, currentUserPubky: 'bob' };

describe('auth change helpers', () => {
  it('reads sign-in from the snapshot it is given', () => {
    expect(isSignedIn(out)).toBe(false);
    expect(isSignedIn(alice)).toBe(true);
  });

  it('reports the session arriving after the persisted pubky was hydrated (cold load)', () => {
    expect(signInChanged(aliceHydrated, out)).toBe(false);
    expect(signInChanged(alice, aliceHydrated)).toBe(true);
    expect(signedInUserChanged(alice, aliceHydrated)).toBe(true);
  });

  it('reports sign-out and an account switch, and nothing for an unrelated update', () => {
    expect(signInChanged(out, alice)).toBe(true);
    expect(signedInUserChanged(bob, alice)).toBe(true);
    expect(signInChanged(bob, alice)).toBe(false);
    expect(signedInUserChanged({ ...alice }, alice)).toBe(false);
  });

  it('reports the profile flag arriving after the session, which the pollers wait for', () => {
    const noProfile = { session, hasProfile: null };
    const withProfile = { session, hasProfile: true };
    expect(signInOrProfileChanged(withProfile, noProfile)).toBe(true);
    expect(signInOrProfileChanged(withProfile, withProfile)).toBe(false);
  });

  it('tells a sign-out or account switch from a cold load or a same-account session drop', () => {
    expect(accountLeft(out, alice)).toBe(true);
    expect(accountLeft(bob, alice)).toBe(true);
    expect(accountLeft(alice, aliceHydrated)).toBe(false);
    expect(accountLeft(aliceHydrated, alice)).toBe(false);
    expect(accountLeft(aliceHydrated, out)).toBe(false);
  });
});
