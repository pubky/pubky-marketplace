import type { Session } from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceApplication } from '@/application/commerce/commerce';
import { MarketplaceGrantSessionCoordinator } from '@/coordinators/marketplace-grant-session/marketplace-grant-session';
import type { MintedGrantSession } from '@/services/marketplace/marketplace-grant-session';
import type { MarketplaceSessionEndedEvent } from '@/services/marketplace/marketplace-session';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { asOpaque } from '@/test-utils/type-assertions';
import { CommerceController } from './commerce';

const runtime = vi.hoisted(() => ({ grantSessions: true }));
vi.mock('@/libs/runtime-config/runtime-config', async (original) => ({
  ...(await original<typeof import('@/libs/runtime-config/runtime-config')>()),
  getMarketplaceGrantSessionEnabled: () => runtime.grantSessions,
}));
vi.mock('@/libs/logger/logger', () => ({
  Logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const PUBKY = 'y'.repeat(52);
const OTHER_PUBKY = 'z'.repeat(52);
const CAPS = '/pub/pubky.app/marketplace-service/v1/:rw,/priv/pubky.app/:rw';
const MINTED: MintedGrantSession = {
  token: 't'.repeat(43),
  sessionId: '22222222-2222-4222-8222-222222222222',
  pubky: PUBKY,
  capabilities: CAPS,
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const INFO = { pubky: PUBKY, capabilities: CAPS, expiresAt: MINTED.expiresAt, issuedAt: '2026-10-15T00:00:00.000Z' };

function signIn(pubky = PUBKY, grant: object | null = {}) {
  const session = asOpaque<Session>({ grant: grant ?? undefined, info: { publicKey: { z32: () => pubky } } });
  useAuthStore.setState({ session, currentUserPubky: pubky, isLoggingOut: false });
  return session;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

let mint: ReturnType<typeof vi.spyOn>;
let install: ReturnType<typeof vi.spyOn>;
let revoke: ReturnType<typeof vi.spyOn>;
let restore: ReturnType<typeof vi.spyOn>;
let active: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  runtime.grantSessions = true;
  useCommerceStore.getState().setMarketplaceSession(null);
  mint = vi.spyOn(CommerceApplication, 'mintMarketplaceSessionFromGrant').mockResolvedValue(MINTED);
  install = vi.spyOn(CommerceApplication, 'installGrantMarketplaceSession').mockReturnValue(INFO);
  revoke = vi.spyOn(CommerceApplication, 'revokeGrantMarketplaceSession').mockResolvedValue(undefined);
  restore = vi.spyOn(CommerceApplication, 'restoreMarketplaceSession').mockReturnValue(null);
  active = vi.spyOn(CommerceApplication, 'hasActiveMarketplaceSession').mockReturnValue(false);
});
afterEach(() => {
  CommerceController.unbindMarketplaceSessionStore();
  MarketplaceGrantSessionCoordinator.resetInstance();
  vi.restoreAllMocks();
  useAuthStore.setState({ session: null, currentUserPubky: null, isLoggingOut: false });
  useCommerceStore.getState().setMarketplaceSession(null);
});

describe('CommerceController.ensureMarketplaceSessionFromGrant', () => {
  it('mints from the sign-in grant and mirrors the session into the store', async () => {
    const session = signIn();
    await expect(CommerceController.ensureMarketplaceSessionFromGrant()).resolves.toEqual(INFO);
    expect(mint).toHaveBeenCalledWith({ grant: asOpaque<{ grant: unknown }>(session).grant, pubky: PUBKY });
    expect(install).toHaveBeenCalledWith(MINTED, PUBKY);
    expect(useCommerceStore.getState().marketplaceSession).toEqual(INFO);
  });

  it('does nothing with the flag off, without a grant, or while signing out', async () => {
    runtime.grantSessions = false;
    signIn();
    expect(await CommerceController.ensureMarketplaceSessionFromGrant()).toBeNull();
    runtime.grantSessions = true;
    signIn(PUBKY, null);
    expect(await CommerceController.ensureMarketplaceSessionFromGrant()).toBeNull();
    signIn();
    useAuthStore.setState({ isLoggingOut: true });
    expect(await CommerceController.ensureMarketplaceSessionFromGrant()).toBeNull();
    expect(mint).not.toHaveBeenCalled();
  });

  it('adopts a persisted session instead of minting', async () => {
    signIn();
    restore.mockReturnValue(INFO);
    await expect(CommerceController.ensureMarketplaceSessionFromGrant()).resolves.toEqual(INFO);
    expect(mint).not.toHaveBeenCalled();
  });

  it('returns the active session without minting', async () => {
    signIn();
    active.mockReturnValue(true);
    useCommerceStore.getState().setMarketplaceSession(INFO);
    await expect(CommerceController.ensureMarketplaceSessionFromGrant()).resolves.toEqual(INFO);
    expect(mint).not.toHaveBeenCalled();
  });

  it('shares one attempt between concurrent callers', async () => {
    signIn();
    const pending = deferred<MintedGrantSession>();
    mint.mockReturnValue(pending.promise);
    const first = CommerceController.ensureMarketplaceSessionFromGrant();
    const second = CommerceController.ensureMarketplaceSessionFromGrant();
    pending.resolve(MINTED);
    await expect(Promise.all([first, second])).resolves.toEqual([INFO, INFO]);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('revokes and drops a session minted after the account changed', async () => {
    signIn();
    const pending = deferred<MintedGrantSession>();
    mint.mockReturnValue(pending.promise);
    const attempt = CommerceController.ensureMarketplaceSessionFromGrant();
    signIn(OTHER_PUBKY);
    pending.resolve(MINTED);
    await expect(attempt).resolves.toBeNull();
    expect(revoke).toHaveBeenCalledWith(MINTED);
    expect(install).not.toHaveBeenCalled();
    expect(useCommerceStore.getState().marketplaceSession).toBeNull();
  });

  it('revokes a minted session the replacement guard refuses', async () => {
    signIn();
    install.mockImplementation(() => {
      throw new Error('narrower_than_current');
    });
    await expect(CommerceController.ensureMarketplaceSessionFromGrant()).resolves.toBeNull();
    expect(revoke).toHaveBeenCalledWith(MINTED);
    expect(useCommerceStore.getState().marketplaceSession).toBeNull();
  });

  it('does not retry a refused mint for the same sign-in unless asked', async () => {
    signIn();
    mint.mockRejectedValueOnce(new Error('homeserver_proof_invalid'));
    expect(await CommerceController.ensureMarketplaceSessionFromGrant()).toBeNull();
    expect(await CommerceController.ensureMarketplaceSessionFromGrant()).toBeNull();
    expect(mint).toHaveBeenCalledTimes(1);
    await expect(CommerceController.ensureMarketplaceSessionFromGrant({ retryAfterFailure: true })).resolves.toEqual(
      INFO,
    );
    expect(mint).toHaveBeenCalledTimes(2);
    // A new sign-in starts clean.
    mint.mockRejectedValueOnce(new Error('homeserver_unavailable'));
    signIn();
    expect(await CommerceController.ensureMarketplaceSessionFromGrant()).toBeNull();
    signIn();
    await expect(CommerceController.ensureMarketplaceSessionFromGrant()).resolves.toEqual(INFO);
  });
});

describe('a grant-minted session the service rejects (Kimi #248 P1)', () => {
  /** Binds the controller's session-ended handler and returns a way to fire it. */
  function bindSessionEnded() {
    let fire: ((event: MarketplaceSessionEndedEvent) => void) | null = null;
    vi.spyOn(CommerceApplication, 'onMarketplaceSessionEnded').mockImplementation((listener) => {
      fire = listener;
      return () => undefined;
    });
    vi.spyOn(CommerceApplication, 'onInventorySessionEnded').mockReturnValue(() => undefined);
    CommerceController.bindMarketplaceSessionStore();
    return (event: MarketplaceSessionEndedEvent) => fire?.(event);
  }

  it('is not re-minted by the coordinator for the same sign-in', async () => {
    const end = bindSessionEnded();
    signIn();
    MarketplaceGrantSessionCoordinator.getInstance().start();
    await vi.waitFor(() => expect(useCommerceStore.getState().marketplaceSession).toEqual(INFO));
    expect(mint).toHaveBeenCalledTimes(1);

    // The service answers 401 for the minted bearer; the store clears.
    end({ reason: 'rejected', issuedAt: INFO.issuedAt });
    await Promise.resolve();

    expect(useCommerceStore.getState().marketplaceSession).toBeNull();
    expect(mint).toHaveBeenCalledTimes(1);
    expect(await CommerceController.ensureMarketplaceSessionFromGrant()).toBeNull();
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('is minted again after a natural expiry', async () => {
    const end = bindSessionEnded();
    signIn();
    MarketplaceGrantSessionCoordinator.getInstance().start();
    await vi.waitFor(() => expect(mint).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(useCommerceStore.getState().marketplaceSession).toEqual(INFO));

    end({ reason: 'expired', issuedAt: INFO.issuedAt });

    await vi.waitFor(() => expect(mint).toHaveBeenCalledTimes(2));
  });

  it('can still be retried explicitly from the dialog', async () => {
    const end = bindSessionEnded();
    signIn();
    await CommerceController.ensureMarketplaceSessionFromGrant();
    end({ reason: 'rejected', issuedAt: INFO.issuedAt });

    await expect(CommerceController.ensureMarketplaceSessionFromGrant({ retryAfterFailure: true })).resolves.toEqual(
      INFO,
    );
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('does not mark the sign-in for a rejection of some other session', async () => {
    const end = bindSessionEnded();
    signIn();
    await CommerceController.ensureMarketplaceSessionFromGrant();
    end({ reason: 'rejected', issuedAt: '2000-01-01T00:00:00.000Z' });

    useCommerceStore.getState().setMarketplaceSession(null);
    await expect(CommerceController.ensureMarketplaceSessionFromGrant()).resolves.toEqual(INFO);
  });
});

describe('a restored session the service rejects (Kimi #248 delta P3-1)', () => {
  it('is re-minted once, and a rejection of that mint stops further mints', async () => {
    let fire: ((event: MarketplaceSessionEndedEvent) => void) | null = null;
    vi.spyOn(CommerceApplication, 'onMarketplaceSessionEnded').mockImplementation((listener) => {
      fire = listener;
      return () => undefined;
    });
    vi.spyOn(CommerceApplication, 'onInventorySessionEnded').mockReturnValue(() => undefined);
    CommerceController.bindMarketplaceSessionStore();
    const restoredInfo = { ...INFO, issuedAt: '2026-10-15T00:00:01.000Z' };
    restore.mockReturnValueOnce(restoredInfo);
    signIn();
    MarketplaceGrantSessionCoordinator.getInstance().start();
    await vi.waitFor(() => expect(useCommerceStore.getState().marketplaceSession).toEqual(restoredInfo));
    expect(mint).not.toHaveBeenCalled();

    // A stale persisted bearer is rejected: one fresh mint replaces it.
    fire!({ reason: 'rejected', issuedAt: restoredInfo.issuedAt });
    await vi.waitFor(() => expect(mint).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(useCommerceStore.getState().marketplaceSession).toEqual(INFO));

    // That minted session is rejected too: the sign-in is marked, no loop.
    fire!({ reason: 'rejected', issuedAt: INFO.issuedAt });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mint).toHaveBeenCalledTimes(1);
  });
});

describe('a restore that throws (Kimi #248 P2)', () => {
  it('resolves null instead of rejecting the shared attempt', async () => {
    signIn();
    restore.mockImplementation(() => {
      throw new Error('a replaced-session listener threw');
    });
    await expect(CommerceController.ensureMarketplaceSessionFromGrant()).resolves.toBeNull();
    expect(mint).not.toHaveBeenCalled();
  });
});

describe('MarketplaceGrantSessionCoordinator', () => {
  it('handles a rejection from the controller instead of leaving it unhandled', async () => {
    const rejected = Promise.reject(new Error('unexpected'));
    const handled = vi.spyOn(rejected, 'catch');
    const ensure = vi.spyOn(CommerceController, 'ensureMarketplaceSessionFromGrant').mockReturnValue(rejected);
    MarketplaceGrantSessionCoordinator.getInstance().start();
    signIn();
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(handled).toHaveBeenCalledTimes(1);
    await expect(handled.mock.results[0].value).resolves.toBeUndefined();
  });

  it('mints after sign-in and again when the session ends', async () => {
    const ensure = vi.spyOn(CommerceController, 'ensureMarketplaceSessionFromGrant').mockResolvedValue(null);
    MarketplaceGrantSessionCoordinator.getInstance().start();
    expect(ensure).not.toHaveBeenCalled();

    signIn();
    expect(ensure).toHaveBeenCalledTimes(1);

    useCommerceStore.getState().setMarketplaceSession(INFO);
    useCommerceStore.getState().setMarketplaceSession(null);
    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it('stays idle with the flag off, while signing out and after stop', () => {
    const ensure = vi.spyOn(CommerceController, 'ensureMarketplaceSessionFromGrant').mockResolvedValue(null);
    const coordinator = MarketplaceGrantSessionCoordinator.getInstance();
    coordinator.start();
    runtime.grantSessions = false;
    signIn();
    runtime.grantSessions = true;
    useAuthStore.setState({ isLoggingOut: true });
    expect(ensure).not.toHaveBeenCalled();
    coordinator.stop();
    signIn(OTHER_PUBKY);
    expect(ensure).not.toHaveBeenCalled();
  });
});
