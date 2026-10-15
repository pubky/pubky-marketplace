import type { Session } from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApplication } from '@/application/auth/auth';
import { BootstrapApplication } from '@/application/bootstrap/bootstrap';
import { CommerceController } from '@/controllers/commerce/commerce';
import { clearDatabase, clearPrivateData } from '@/database/franky/franky.helpers';
import { Identity } from '@/libs/identity/identity';
import { useAuthStore } from '@/stores/auth/auth.store';
import { AUTH_PERSIST_KEY } from '@/stores/persistedKeys';
import { mockKeypair } from '@/test-utils/pubky';
import { AuthController } from './auth';
import { approve, deferred, grantSession, resetGrantTest } from './auth.grant-test-utils';

vi.mock('@/database/franky/franky.helpers', () => ({ clearDatabase: vi.fn(), clearPrivateData: vi.fn() }));
vi.mock('@/libs/query-client/query-client.factory', async (original) => ({
  ...(await original<object>()),
  clearAllQueryClients: vi.fn(),
}));
vi.mock('@/libs/utils/utils', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  clearCookies: vi.fn(),
}));

beforeEach(() => {
  resetGrantTest();
  vi.mocked(clearDatabase).mockClear();
  vi.mocked(clearPrivateData).mockClear();
});
afterEach(() => {
  AuthController.cancelAllAuthFlows();
  vi.restoreAllMocks();
});

describe('grant-only authentication lifecycle', () => {
  it('retires an owned approval rejected for insufficient permissions', async () => {
    const session = grantSession();
    const refusal = new Error('insufficient capabilities');
    vi.spyOn(AuthApplication, 'assertFullGrantSession').mockRejectedValue(refusal);
    await expect(approve(session)).rejects.toBe(refusal);
    expect(AuthApplication.logout).toHaveBeenCalledWith({ session });
    expect(AuthApplication.saveGrantSession).not.toHaveBeenCalled();
    expect(useAuthStore.getState().session).toBeNull();
  });
  it.each(['ring', 'bitkit', 'passport'] as const)(
    'saves the %s SDK record before exposing identity or bootstrapping',
    async (signer) => {
      const session = grantSession();
      await approve(session, signer);
      const saved = deferred<string>();
      vi.mocked(AuthApplication.saveGrantSession).mockReturnValue(saved.promise);
      vi.mocked(AuthApplication.userIsSignedUp).mockResolvedValue(true);
      const pending = AuthController.initializeAuthenticatedSession({ session });
      await vi.waitFor(() => expect(AuthApplication.saveGrantSession).toHaveBeenCalledWith(session));
      expect(useAuthStore.getState().session).toBeNull();
      expect(BootstrapApplication.initialize).not.toHaveBeenCalled();
      saved.resolve('alice:grant-1');
      await pending;
      expect(useAuthStore.getState()).toMatchObject({
        session,
        grantSigner: signer,
        grantSessionRecordId: 'alice:grant-1',
        hasProfile: true,
      });
      expect(AuthApplication.commitGrantSession).toHaveBeenCalledWith('alice:grant-1');
      expect(BootstrapApplication.initialize).toHaveBeenCalled();
      expect(JSON.parse(localStorage.getItem(AUTH_PERSIST_KEY)!).state.sessionExport).toBeNull();
    },
  );

  it('never bootstraps or persists a live identity after a blocked SDK save', async () => {
    const session = grantSession();
    await approve(session);
    vi.mocked(AuthApplication.saveGrantSession).mockRejectedValue(new Error('storage blocked'));
    await expect(AuthController.initializeAuthenticatedSession({ session })).rejects.toThrow('storage blocked');
    expect(useAuthStore.getState().session).toBeNull();
    expect(AuthApplication.userIsSignedUp).not.toHaveBeenCalled();
    expect(AuthApplication.logout).toHaveBeenCalledWith({ session });
    expect(AuthApplication.clearGrantSessions).toHaveBeenCalled();
  });

  it('keeps a committed record if profile lookup temporarily fails', async () => {
    const clearCommerce = vi.spyOn(CommerceController, 'clearMarketplaceSession');
    const session = grantSession();
    await approve(session);
    vi.mocked(AuthApplication.userIsSignedUp).mockRejectedValue(new Error('offline'));
    await expect(AuthController.initializeAuthenticatedSession({ session })).rejects.toThrow('offline');
    expect(AuthApplication.removeGrantSession).not.toHaveBeenCalled();
    expect(AuthApplication.logout).not.toHaveBeenCalled();
    expect(clearCommerce).not.toHaveBeenCalled();
  });

  it.each(['mnemonic', 'encrypted-file', 'signup'] as const)(
    'records %s as local-key and saves before store initialization',
    async (mode) => {
      const session = grantSession();
      const keypair = mockKeypair({ publicKey: session.info.publicKey });
      vi.spyOn(Identity, 'keypairFromMnemonic').mockReturnValue(keypair);
      vi.spyOn(Identity, 'decryptRecoveryFile').mockResolvedValue(keypair);
      vi.spyOn(Identity, 'keypairFromSecretKey').mockReturnValue(keypair);
      vi.spyOn(AuthApplication, 'signIn').mockResolvedValue({ session });
      vi.spyOn(AuthApplication, 'signUp').mockResolvedValue({ session });
      if (mode === 'mnemonic') await AuthController.loginWithMnemonic({ mnemonic: 'test' });
      else if (mode === 'encrypted-file')
        await AuthController.loginWithEncryptedFile({ encryptedFile: new File([], 'test'), password: 'test' });
      else await AuthController.signUp({ secretKey: 'test', signupToken: 'invite' });
      expect(AuthApplication.saveGrantSession).toHaveBeenCalledWith(session);
      expect(useAuthStore.getState()).toMatchObject({
        session,
        grantSigner: 'local-key',
        grantSessionRecordId: 'alice:grant-1',
      });
      if (mode === 'signup') {
        expect(AuthApplication.userIsSignedUp).not.toHaveBeenCalled();
        expect(useAuthStore.getState().hasProfile).toBe(false);
      }
    },
  );

  it('saves Ring signup grants with Ring ownership', async () => {
    const session = grantSession();
    vi.spyOn(AuthApplication, 'generateSignupAuthUrl').mockResolvedValue({
      authorizationUrl: 'pubkyauth://signup_grant',
      awaitApproval: Promise.resolve(session),
      cancelAuthFlow: vi.fn(),
    });
    const flow = await AuthController.getSignupAuthUrl('invite');
    await AuthController.initializeAuthenticatedSession({ session: await flow.awaitApproval });
    expect(useAuthStore.getState().grantSigner).toBe('ring');
    expect(AuthApplication.saveGrantSession).toHaveBeenCalledWith(session);
  });

  it('does not restore an old cookie or destroy legacy local history on migration', async () => {
    useAuthStore.setState({ currentUserPubky: 'alice', sessionExport: 'legacy-cookie', session: null });
    const restore = vi.spyOn(AuthApplication, 'restorePersistedSession');
    await expect(AuthController.restorePersistedSession()).resolves.toEqual({ status: 'deferred' });
    expect(restore).not.toHaveBeenCalled();
    const session = grantSession();
    await approve(session);
    await AuthController.initializeAuthenticatedSession({ session });
    expect(clearDatabase).not.toHaveBeenCalled();
    expect(clearPrivateData).not.toHaveBeenCalled();
  });

  it('cleans private data only after a different account is approved', async () => {
    useAuthStore.setState({ currentUserPubky: 'bob', sessionExport: 'legacy-cookie' });
    const session = grantSession();
    await approve(session);
    expect(clearDatabase).not.toHaveBeenCalled();
    await AuthController.initializeAuthenticatedSession({ session });
    expect(clearDatabase).toHaveBeenCalledOnce();
  });

  it('discards a stale pending approval after logout without saving it', async () => {
    const pending = deferred<Session>();
    const session = grantSession();
    vi.spyOn(AuthApplication, 'generateGrantAuthUrl').mockResolvedValue({
      authorizationUrl: 'pubkyauth://signin_grant',
      awaitApproval: pending.promise,
      cancelAuthFlow: vi.fn(),
    });
    const flow = await AuthController.getAuthUrl();
    const result = flow.awaitApproval.catch((error) => error);
    await AuthController.logout();
    pending.resolve(session);
    expect(await result).toMatchObject({ name: 'AuthFlowCanceled' });
    expect(AuthApplication.saveGrantSession).not.toHaveBeenCalled();
    expect(AuthApplication.logout).toHaveBeenCalledWith({ session });
  });

  it('does not reinitialize a session if logout starts while its SDK save is pending', async () => {
    const session = grantSession();
    await approve(session);
    const saved = deferred<string>();
    vi.mocked(AuthApplication.saveGrantSession).mockReturnValue(saved.promise);
    const completion = AuthController.initializeAuthenticatedSession({ session }).catch((error) => error);
    await vi.waitFor(() => expect(AuthApplication.saveGrantSession).toHaveBeenCalled());
    const logout = AuthController.logout();
    saved.resolve('alice:grant-1');
    expect(await completion).toMatchObject({ name: 'AuthFlowCanceled' });
    await logout;
    expect(useAuthStore.getState().session).toBeNull();
    expect(AuthApplication.userIsSignedUp).not.toHaveBeenCalled();
  });

  it('removes only the signed-out account records while a newer account wins', async () => {
    const old = grantSession('alice');
    useAuthStore.getState().init({
      session: old,
      currentUserPubky: 'alice',
      hasProfile: true,
      grantSessionRecordId: 'alice:old',
      grantSigner: 'ring',
    });
    const remote = deferred<void>();
    vi.mocked(AuthApplication.logout).mockReturnValue(remote.promise);
    const logout = AuthController.logout();
    localStorage.removeItem(AUTH_PERSIST_KEY);
    const winner = grantSession('bob');
    useAuthStore.getState().init({
      session: winner,
      currentUserPubky: 'bob',
      hasProfile: true,
      grantSessionRecordId: 'bob:new',
      grantSigner: 'passport',
    });
    remote.resolve();
    await logout;
    expect(AuthApplication.clearGrantSessions).toHaveBeenCalledWith(
      expect.objectContaining({ recordIds: expect.not.arrayContaining(['bob:new']) }),
    );
    expect(useAuthStore.getState().session).toBe(winner);
  });

  it('preserves a newer identity when an older profile lookup resolves late', async () => {
    const session = grantSession();
    await approve(session);
    const profile = deferred<boolean>();
    vi.mocked(AuthApplication.userIsSignedUp).mockReturnValue(profile.promise);
    const old = AuthController.initializeAuthenticatedSession({ session }).catch((error) => error);
    await vi.waitFor(() => expect(AuthApplication.userIsSignedUp).toHaveBeenCalled());
    localStorage.removeItem(AUTH_PERSIST_KEY);
    const winner = grantSession('bob');
    useAuthStore.getState().init({
      session: winner,
      currentUserPubky: 'bob',
      hasProfile: false,
      grantSessionRecordId: 'bob:new',
      grantSigner: 'passport',
    });
    profile.resolve(true);
    expect(await old).toMatchObject({ name: 'AuthFlowCanceled' });
    expect(useAuthStore.getState()).toMatchObject({ session: winner, hasProfile: false });
  });

  it('step-up saves and replaces the same identity with the selected signer', async () => {
    const previous = grantSession();
    useAuthStore.getState().init({
      session: previous,
      currentUserPubky: 'alice',
      hasProfile: true,
      grantSessionRecordId: 'alice:old',
      grantSigner: 'ring',
    });
    const session = grantSession('alice', 'shop.pubky.app', 'new');
    vi.spyOn(AuthApplication, 'generateGrantAuthUrl').mockResolvedValue({
      authorizationUrl: 'pubkyauth://signin_grant',
      awaitApproval: Promise.resolve(session),
      cancelAuthFlow: vi.fn(),
    });
    const callback = { xSuccess: 'https://shop.test/return' };
    const flow = await AuthController.getStepUpAuthUrl({ signer: 'passport', xCallback: callback });
    await AuthController.completeStepUpReauth({ session: await flow.awaitApproval });
    expect(AuthApplication.generateGrantAuthUrl).toHaveBeenCalledWith(callback);
    expect(useAuthStore.getState()).toMatchObject({ session, grantSigner: 'passport' });
    expect(AuthApplication.clearGrantSessions).toHaveBeenCalledWith({ protectedRecordIds: ['alice:grant-1'] });
  });

  it('passes the request for keys, or the sign-in without them, through to the application', async () => {
    const generate = vi.spyOn(AuthApplication, 'generateGrantAuthUrl').mockResolvedValue({
      authorizationUrl: 'pubkyauth://signin_grant',
      awaitApproval: new Promise<Session>(() => undefined),
      cancelAuthFlow: vi.fn(),
    });
    await AuthController.getGrantAuthUrl();
    expect(generate).toHaveBeenLastCalledWith();
    await AuthController.getGrantAuthUrl({ withPrivKeys: false });
    expect(generate).toHaveBeenLastCalledWith(undefined, { withPrivKeys: false });
    await AuthController.getPassportGrantAuthUrl({ xSource: 'Pubky Shop' }, { withPrivKeys: false });
    expect(generate).toHaveBeenLastCalledWith({ xSource: 'Pubky Shop' }, { withPrivKeys: false });
  });

  it('rejects a wrong-identity step-up before saving its record', async () => {
    useAuthStore.getState().init({
      session: grantSession(),
      currentUserPubky: 'alice',
      hasProfile: true,
      grantSessionRecordId: 'alice:old',
    });
    const session = grantSession('bob');
    await approve(session);
    await expect(AuthController.completeStepUpReauth({ session })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(AuthApplication.saveGrantSession).not.toHaveBeenCalled();
    expect(AuthApplication.logout).toHaveBeenCalledWith({ session });
    expect(useAuthStore.getState().currentUserPubky).toBe('alice');
  });
});
