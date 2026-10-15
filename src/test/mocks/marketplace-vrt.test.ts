import type { Session } from '@synonymdev/pubky';
import { describe, expect, it } from 'vitest';
import { createMarketplaceVrtAuthStore } from './marketplace-vrt';

describe('Marketplace visual auth fixture', () => {
  it('keeps the live session identity aligned when a scene changes viewer or signs out', () => {
    let viewer: string | null = 'a'.repeat(52);
    const useAuthStore = createMarketplaceVrtAuthStore({ getCurrentUserPubky: () => viewer });
    const getSession = () => useAuthStore.getState().session as Session | null;

    const firstSession = getSession();
    expect(firstSession?.grant).toBeTruthy();
    expect(firstSession?.info.publicKey.z32()).toBe(viewer);
    expect(getSession()).toBe(firstSession);

    viewer = 'b'.repeat(52);
    expect(getSession()?.info.publicKey.z32()).toBe(viewer);
    expect(getSession()).not.toBe(firstSession);

    viewer = null;
    expect(useAuthStore.getState().currentUserPubky).toBeNull();
    expect(getSession()).toBeNull();
    expect((useAuthStore.getState().selectSession as () => Session | null)()).toBeNull();
  });

  it('does not turn a guest or explicit identity-only scene into an authenticated session', () => {
    const guest = createMarketplaceVrtAuthStore({ currentUserPubky: null });
    expect(guest.getState().currentUserPubky).toBeNull();
    expect(guest.getState().session).toBeNull();

    const identityOnly = createMarketplaceVrtAuthStore({ currentUserPubky: 'a'.repeat(52), session: null });
    expect(identityOnly.getState().currentUserPubky).toBe('a'.repeat(52));
    expect(identityOnly.getState().session).toBeNull();
  });
});
