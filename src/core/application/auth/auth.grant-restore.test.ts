import type { Session } from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { mockAuthStore } from '@/test-utils/stores';
import { asOpaque } from '@/test-utils/type-assertions';
import { AuthApplication } from './auth';

const ref = { pubky: 'alice', clientId: 'pubky.app', grantId: 'grant-1', sessionStoreId: 'app-record' };
const session = (overrides: Record<string, unknown> = {}) =>
  asOpaque<Session>({
    info: { publicKey: { z32: () => ref.pubky }, capabilities: ['/:rw'] },
    grant: {
      sessionInfo: vi.fn().mockResolvedValue({
        publicKey: { z32: () => ref.pubky },
        capabilities: ['/:rw'],
        clientId: ref.clientId,
        grantId: ref.grantId,
        ...overrides,
      }),
    },
  });
beforeEach(() => {
  vi.spyOn(HomeserverService, 'assertUserHomeserverAllowed').mockResolvedValue(undefined);
  vi.spyOn(HomeserverService, 'removeGrantSession').mockResolvedValue(undefined);
  vi.spyOn(HomeserverService, 'logout').mockResolvedValue(undefined);
  vi.spyOn(HomeserverService, 'saveGrantSession').mockResolvedValue('unexpected');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetRuntimeConfigForTests();
});

describe('grant restore failure and ownership rules', () => {
  it('ignores persisted cookie exports and never tries ambient-cookie or bridge fallback', async () => {
    const restore = vi.spyOn(HomeserverService, 'restoreSession');
    expect(
      await AuthApplication.restorePersistedSession({ authStore: mockAuthStore({ sessionExport: 'legacy-cookie' }) }),
    ).toEqual({ status: 'signed-out' });
    expect(restore).not.toHaveBeenCalled();
  });
  it.each([
    new Error('network disconnected'),
    new DOMException('Storage blocked', 'UnknownError'),
    new Error('unknown SDK failure'),
  ])('retains Shop credential for inconclusive failure %s', async (error) => {
    vi.spyOn(HomeserverService, 'restoreGrantSession').mockRejectedValue(error);
    expect(
      await AuthApplication.restorePersistedSession({
        authStore: mockAuthStore({ grantSessionRecordId: 'shop-record' }),
      }),
    ).toEqual({ status: 'deferred' });
    expect(HomeserverService.removeGrantSession).not.toHaveBeenCalled();
    expect(HomeserverService.logout).not.toHaveBeenCalled();
  });
  it('keeps a narrower grant for explicit upgrade instead of revoking it', async () => {
    const narrow = asOpaque<Session>({
      info: { publicKey: { z32: () => ref.pubky }, capabilities: ['/pub/pubky.app/:rw'] },
      grant: {},
    });
    vi.spyOn(HomeserverService, 'restoreGrantSession').mockResolvedValue(narrow);
    expect(
      await AuthApplication.restorePersistedSession({
        authStore: mockAuthStore({ grantSessionRecordId: 'shop-record' }),
      }),
    ).toEqual({ status: 'deferred' });
    expect(HomeserverService.removeGrantSession).not.toHaveBeenCalled();
    expect(HomeserverService.logout).not.toHaveBeenCalled();
  });
  it('removes only a definitively expired Shop record', async () => {
    vi.spyOn(HomeserverService, 'restoreGrantSession').mockRejectedValue(
      Err.auth(AuthErrorCode.SESSION_EXPIRED, 'expired', { service: ErrorService.Homeserver, operation: 'test' }),
    );
    expect(
      await AuthApplication.restorePersistedSession({
        authStore: mockAuthStore({ grantSessionRecordId: 'shop-record' }),
      }),
    ).toEqual({ status: 'signed-out' });
    expect(HomeserverService.removeGrantSession).toHaveBeenCalledWith('shop-record');
  });
  it('restores a standalone grant issued for the runtime Shop client id', async () => {
    vi.stubEnv('PUBKY_RUNTIME_SHOP_GRANT_CLIENT_ID', 'staging.pubky.app');
    resetRuntimeConfigForTests();
    const restored = session({ clientId: 'staging.pubky.app' });
    vi.spyOn(HomeserverService, 'restoreGrantSession').mockResolvedValue(restored);
    expect(
      await AuthApplication.restorePersistedSession({
        authStore: mockAuthStore({ currentUserPubky: 'alice', grantSessionRecordId: 'shop-record' }),
      }),
    ).toEqual({ status: 'restored', session: restored });
    expect(HomeserverService.removeGrantSession).not.toHaveBeenCalled();
    expect(HomeserverService.logout).not.toHaveBeenCalled();
  });
  it('accepts a root grant owned by App without saving it again', async () => {
    const restored = session();
    vi.spyOn(HomeserverService, 'restoreGrantSession').mockResolvedValue(restored);
    expect(await AuthApplication.restoreHostSession(ref)).toBe(restored);
    expect(HomeserverService.restoreGrantSession).toHaveBeenCalledWith('app-record');
    expect(HomeserverService.saveGrantSession).not.toHaveBeenCalled();
  });
  it('reuses an App grant with core Shop permissions without forcing a Chat approval', async () => {
    const restored = session({ capabilities: ['/pub/pubky.app/:rw', '/pub/paykit/:rw', '/priv/pubky.app/:rw'] });
    vi.spyOn(HomeserverService, 'restoreGrantSession').mockResolvedValue(restored);
    expect(await AuthApplication.restoreHostSession(ref)).toBe(restored);
    expect(HomeserverService.saveGrantSession).not.toHaveBeenCalled();
    expect(HomeserverService.removeGrantSession).not.toHaveBeenCalled();
    expect(HomeserverService.logout).not.toHaveBeenCalled();
  });
  it.each([
    { clientId: 'shop.pubky.app' },
    { grantId: 'other' },
    { publicKey: { z32: () => 'bob' } },
    { capabilities: ['/pub/pubky.app/:rw'] },
  ])('rejects host identity/client/grant/scope mismatch without deleting or revoking %j', async (mismatch) => {
    vi.spyOn(HomeserverService, 'restoreGrantSession').mockResolvedValue(session(mismatch));
    await expect(AuthApplication.restoreHostSession(ref)).rejects.toMatchObject({ operation: 'restoreHostSession' });
    expect(HomeserverService.removeGrantSession).not.toHaveBeenCalled();
    expect(HomeserverService.logout).not.toHaveBeenCalled();
    expect(HomeserverService.saveGrantSession).not.toHaveBeenCalled();
  });
  it('rejects a cookie record referenced by App without touching it', async () => {
    vi.spyOn(HomeserverService, 'restoreGrantSession').mockResolvedValue(
      asOpaque<Session>({ info: { publicKey: { z32: () => ref.pubky }, capabilities: ['/:rw'] } }),
    );
    await expect(AuthApplication.restoreHostSession(ref)).rejects.toMatchObject({ operation: 'restoreHostSession' });
    expect(HomeserverService.removeGrantSession).not.toHaveBeenCalled();
    expect(HomeserverService.logout).not.toHaveBeenCalled();
  });
});
