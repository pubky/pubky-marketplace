import type { Keypair, Session } from '@synonymdev/pubky';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApplication, isDefinitiveSessionAuthFailure } from '@/application/auth/auth';
import type { THomeserverAuthenticateParams } from '@/application/auth/auth.types';
import { AppError } from '@/libs/error/error';
import { AuthErrorCode, ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import type { Pubky } from '@/models/models.types';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { SocialProfileService } from '@/services/homeserver/social-profile';
import { useAuthStore } from '@/stores/auth/auth.store';
import { mockGrantSession, mockSession } from '@/test-utils/pubky';
import { asOpaque } from '@/test-utils/type-assertions';

// Default to the real implementations; individual tests override the staging
// gate so the homeserver environment guard can be exercised for real.
vi.mock('@/config/network', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/network')>();
  return {
    ...actual,
    isStagingHomeserverDeploy: vi.fn(actual.isStagingHomeserverDeploy),
    getHomeserver: vi.fn(actual.getHomeserver),
  };
});

describe('AuthApplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('signIn', () => {
    const createParams = (): THomeserverAuthenticateParams => ({
      keypair: asOpaque<Keypair>({
        publicKey: vi.fn(() => ({ z32: () => 'test-pubky' })),
        secret: vi.fn(() => new Uint8Array([1, 2, 3])),
      }),
      secretKey: 'test-secret-key',
    });

    it('should successfully authenticate and return result', async () => {
      const params = createParams();
      const session = asOpaque<Session>({ token: 'test-token' });
      const expectedResult = { session };

      const signInSpy = vi.spyOn(HomeserverService, 'signIn').mockResolvedValue(expectedResult);

      const result = await AuthApplication.signIn(params);

      expect(signInSpy).toHaveBeenCalledWith({ keypair: params.keypair });
      expect(result).toEqual(expectedResult);
    });

    it('should return undefined when homeserver is not found during authentication', async () => {
      const params = createParams();
      const signInSpy = vi.spyOn(HomeserverService, 'signIn').mockResolvedValue(undefined);

      const result = await AuthApplication.signIn(params);

      expect(signInSpy).toHaveBeenCalledWith({ keypair: params.keypair });
      expect(result).toBeUndefined();
    });

    it('should propagate error when authentication throws', async () => {
      const params = createParams();
      const signInSpy = vi.spyOn(HomeserverService, 'signIn').mockRejectedValue(new Error('Authentication failed'));

      await expect(AuthApplication.signIn(params)).rejects.toThrow('Authentication failed');
      expect(signInSpy).toHaveBeenCalledOnce();
    });
  });

  describe('generateAuthUrl', () => {
    it('should generate and return auth URL', async () => {
      const session = asOpaque<Session>({ token: 'test-token' });
      const cancelAuthFlow = vi.fn();
      const expectedResult = {
        authorizationUrl: 'https://example.com/auth?token=test-token',
        awaitApproval: Promise.resolve(session),
        cancelAuthFlow,
      };

      const generateAuthUrlSpy = vi.spyOn(HomeserverService, 'generateAuthUrl').mockResolvedValue(expectedResult);

      const result = await AuthApplication.generateAuthUrl();

      expect(generateAuthUrlSpy).toHaveBeenCalled();
      expect(result).toEqual(expectedResult);
    });

    it('should propagate error when URL generation fails', async () => {
      const generateAuthUrlSpy = vi
        .spyOn(HomeserverService, 'generateAuthUrl')
        .mockRejectedValue(new Error('Failed to generate auth URL'));

      await expect(AuthApplication.generateAuthUrl()).rejects.toThrow('Failed to generate auth URL');
      expect(generateAuthUrlSpy).toHaveBeenCalledOnce();
    });
  });

  describe('logout', () => {
    it('should successfully logout', async () => {
      const session = mockSession({ signout: vi.fn() });
      const params = { session };
      const logoutSpy = vi.spyOn(HomeserverService, 'logout').mockResolvedValue(undefined);

      await AuthApplication.logout(params);

      expect(logoutSpy).toHaveBeenCalledWith(params);
    });

    it('should propagate error when logout fails', async () => {
      const session = mockSession({ signout: vi.fn() });
      const params = { session };
      const logoutSpy = vi.spyOn(HomeserverService, 'logout').mockRejectedValue(new Error('Logout failed'));

      await expect(AuthApplication.logout(params)).rejects.toThrow('Logout failed');
      expect(logoutSpy).toHaveBeenCalledOnce();
    });
  });

  describe('isDefinitiveSessionAuthFailure', () => {
    const requestError = (statusCode?: number) => {
      const err = new Error('HTTP error') as Error & { name: string; data?: { statusCode?: number } };
      err.name = 'RequestError';
      if (statusCode !== undefined) {
        err.data = { statusCode };
      }
      return err;
    };

    it('excludes wrong-environment homeserver errors', () => {
      expect(
        isDefinitiveSessionAuthFailure(
          Err.auth(AuthErrorCode.WRONG_ENVIRONMENT_HOMESERVER, 'wrong env', {
            service: ErrorService.Homeserver,
            operation: 'assertUserHomeserverAllowed',
          }),
        ),
      ).toBe(false);
    });

    it('treats AppError auth-category as definitive', () => {
      expect(
        isDefinitiveSessionAuthFailure(
          new AppError({
            category: ErrorCategory.Auth,
            code: AuthErrorCode.SESSION_EXPIRED,
            message: 'Session expired',
            service: ErrorService.Homeserver,
            operation: 'restoreSession',
          }),
        ),
      ).toBe(true);
    });

    it('treats RequestError 401 and 403 as definitive', () => {
      expect(isDefinitiveSessionAuthFailure(requestError(401))).toBe(true);
      expect(isDefinitiveSessionAuthFailure(requestError(403))).toBe(true);
    });

    it('does not treat RequestError 5xx or missing status as definitive', () => {
      expect(isDefinitiveSessionAuthFailure(requestError(500))).toBe(false);
      expect(isDefinitiveSessionAuthFailure(requestError())).toBe(false);
    });
  });

  describe('v1 social write permissions', () => {
    const pk = '8kkppkmiubfq4pxn6f73nqrhhhgkb5xyfprntc9si3np9ydbotto' as Pubky;
    it('requires the hosted session for this owner and an approved write scope', () => {
      const session = mockGrantSession(pk);
      try {
        useAuthStore.setState({ session, sessionOwner: 'shop', currentUserPubky: pk });
        expect(SocialProfileService.canWriteV1(pk)).toBe(false);
        useAuthStore.setState({ sessionOwner: 'host' });
        expect(SocialProfileService.canWriteV1(pk)).toBe(true);
        expect(SocialProfileService.canWriteV1('another-account')).toBe(false);
        useAuthStore.setState({
          session: mockSession({
            info: asOpaque({ publicKey: { z32: () => pk }, capabilities: ['/pub/pubky.app/:rw'] }),
          }),
        });
        expect(SocialProfileService.canWriteV1(pk)).toBe(false);
      } finally {
        useAuthStore.getState().reset();
      }
    });
  });

  describe('userIsSignedUp', () => {
    const testPubky = '8kkppkmiubfq4pxn6f73nqrhhhgkb5xyfprntc9si3np9ydbotto' as Pubky;
    const v1 = { url: `pubky://${testPubky}/pub/social/v1/profile.json`, publicRead: true };
    const legacy = { url: `pubky://${testPubky}/pub/pubky.app/profile.json`, publicRead: true };

    it('admits a v1-only account without looking for a legacy profile', async () => {
      const read = vi
        .spyOn(HomeserverService, 'getJsonIfFound')
        .mockResolvedValue({ found: true, json: { name: 'Alice' } });
      await expect(AuthApplication.userIsSignedUp({ pubky: testPubky })).resolves.toBe(true);
      expect(read.mock.calls).toEqual([[v1]]);
    });

    it('admits an existing legacy account when the v1 profile returns 404', async () => {
      const read = vi
        .spyOn(HomeserverService, 'getJsonIfFound')
        .mockResolvedValueOnce({ found: false })
        .mockResolvedValueOnce({ found: true, json: { name: 'Alice' } });
      await expect(AuthApplication.userIsSignedUp({ pubky: testPubky })).resolves.toBe(true);
      expect(read.mock.calls).toEqual([[v1], [legacy]]);
    });

    it('should return true when profile.json exists but is empty or not JSON', async () => {
      vi.spyOn(HomeserverService, 'getJsonIfFound').mockResolvedValue({ found: true, json: undefined });

      await expect(AuthApplication.userIsSignedUp({ pubky: testPubky })).resolves.toBe(true);
    });

    it('should return false without a request error when profile.json is missing', async () => {
      const requestSpy = vi.spyOn(HomeserverService, 'request');
      vi.spyOn(HomeserverService, 'getJsonIfFound').mockResolvedValue({ found: false });

      const result = await AuthApplication.userIsSignedUp({ pubky: testPubky });

      expect(result).toBe(false);
      expect(requestSpy).not.toHaveBeenCalled();
    });

    it('should throw when the read fails with a non-404 error', async () => {
      const serverError = Err.server(ServerErrorCode.INTERNAL_ERROR, 'Server error', {
        service: ErrorService.Homeserver,
        operation: 'userIsSignedUp',
      });
      const read = vi.spyOn(HomeserverService, 'getJsonIfFound').mockRejectedValue(serverError);

      await expect(AuthApplication.userIsSignedUp({ pubky: testPubky })).rejects.toMatchObject({
        code: ServerErrorCode.INTERNAL_ERROR,
      });
      expect(read.mock.calls).toEqual([[v1]]);
    });
  });
});
