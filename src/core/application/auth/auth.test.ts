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
import type { THomeserverSignUpParams } from '@/services/homeserver/homeserver.types';
import { mockSession } from '@/test-utils/pubky';
import { asOpaque } from '@/test-utils/type-assertions';

vi.mock('pubky-app-specs', () => ({
  default: vi.fn(() => Promise.resolve()),
  userUriBuilder: (pubky: string) => `pubky://${pubky}/pub/pubky.app/profile.json`,
}));

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

  describe('signUp', () => {
    const createParams = (): THomeserverSignUpParams => ({
      keypair: asOpaque<Keypair>({
        publicKey: vi.fn(() => ({ z32: () => 'test-pubky' })),
        secret: vi.fn(() => new Uint8Array([1, 2, 3])),
      }),
      signupToken: 'test-signup-token',
    });

    it('should sign up successfully', async () => {
      const params = createParams();
      const session = asOpaque<Session>({ token: 'test-token' });
      const expectedResult = { session };

      const signUpSpy = vi.spyOn(HomeserverService, 'signUp').mockResolvedValue(expectedResult);

      const result = await AuthApplication.signUp(params);

      expect(signUpSpy).toHaveBeenCalledWith({ keypair: params.keypair, signupToken: params.signupToken });
      expect(result).toEqual(expectedResult);
    });

    it('should propagate error when signup fails', async () => {
      const params = createParams();
      const signUpSpy = vi.spyOn(HomeserverService, 'signUp').mockRejectedValue(new Error('Signup failed'));

      await expect(AuthApplication.signUp(params)).rejects.toThrow('Signup failed');
      expect(signUpSpy).toHaveBeenCalledOnce();
    });
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

  describe('generateSignupToken', () => {
    it('should generate signup token successfully', async () => {
      const generateSignupTokenSpy = vi.spyOn(HomeserverService, 'generateSignupToken').mockResolvedValue('test-token');

      const result = await AuthApplication.generateSignupToken();

      expect(generateSignupTokenSpy).toHaveBeenCalled();
      expect(result).toBe('test-token');
    });

    it('should propagate error when signup token generation fails', async () => {
      const generateSignupTokenSpy = vi
        .spyOn(HomeserverService, 'generateSignupToken')
        .mockRejectedValue(new Error('Failed to generate signup token'));

      await expect(AuthApplication.generateSignupToken()).rejects.toThrow('Failed to generate signup token');
      expect(generateSignupTokenSpy).toHaveBeenCalledOnce();
    });
  });

  describe('verifySignupToken', () => {
    it('should return valid when the homeserver reports the token is valid', async () => {
      const verifySpy = vi.spyOn(HomeserverService, 'verifySignupToken').mockResolvedValue('valid');

      const result = await AuthApplication.verifySignupToken('YVB2-YFRN-GDY0');

      expect(verifySpy).toHaveBeenCalledWith('YVB2-YFRN-GDY0');
      expect(result).toBe('valid');
    });

    it('should return used when the homeserver reports the token is used', async () => {
      const verifySpy = vi.spyOn(HomeserverService, 'verifySignupToken').mockResolvedValue('used');

      const result = await AuthApplication.verifySignupToken('YVB2-YFRN-GDY0');

      expect(verifySpy).toHaveBeenCalledWith('YVB2-YFRN-GDY0');
      expect(result).toBe('used');
    });

    it('should return invalid when the homeserver does not recognise the token', async () => {
      const verifySpy = vi.spyOn(HomeserverService, 'verifySignupToken').mockResolvedValue('invalid');

      const result = await AuthApplication.verifySignupToken('BADC-0DE0-0000');

      expect(verifySpy).toHaveBeenCalledWith('BADC-0DE0-0000');
      expect(result).toBe('invalid');
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

  describe('userIsSignedUp', () => {
    const testPubky = 'test-pubky' as Pubky;

    it('should return true when profile.json exists', async () => {
      const readSpy = vi
        .spyOn(HomeserverService, 'getJsonIfFound')
        .mockResolvedValue({ found: true, json: { name: 'Test' } });

      const result = await AuthApplication.userIsSignedUp({ pubky: testPubky });

      expect(result).toBe(true);
      expect(readSpy).toHaveBeenCalledWith({ url: `pubky://${testPubky}/pub/pubky.app/profile.json` });
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
      vi.spyOn(HomeserverService, 'getJsonIfFound').mockRejectedValue(serverError);

      await expect(AuthApplication.userIsSignedUp({ pubky: testPubky })).rejects.toMatchObject({
        code: ServerErrorCode.INTERNAL_ERROR,
      });
    });
  });
});
