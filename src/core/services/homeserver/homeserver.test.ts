import type { Keypair, PublicKey, Session } from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPABILITIES, RING_COOKIE_CAPABILITIES } from '@/config/app';
import { AppError } from '@/libs/error/error';
import {
  AuthErrorCode,
  ClientErrorCode,
  NetworkErrorCode,
  ServerErrorCode,
  ValidationErrorCode,
} from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { HttpMethod } from '@/libs/http/http.types';
import { Logger } from '@/libs/logger/logger';
import { asOpaque } from '@/test-utils/type-assertions';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';

// =============================================================================
// HOISTED MOCKS - Must be hoisted to run before module imports
// =============================================================================

const mockState = vi.hoisted(() => ({
  // Signer methods
  signup: vi.fn(),
  signin: vi.fn(),
  publishHomeserverForce: vi.fn(),
  // Session methods
  sessionSignout: vi.fn(),
  // Session storage
  sessionStorageGet: vi.fn(),
  sessionStorageExists: vi.fn(),
  sessionStoragePutJson: vi.fn(),
  sessionStoragePutBytes: vi.fn(),
  sessionStorageDelete: vi.fn(),
  sessionStorageList: vi.fn(),
  // Client methods
  clientFetch: vi.fn(),
  // Public storage
  publicStorageGet: vi.fn(),
  publicStorageExists: vi.fn(),
  publicStorageList: vi.fn(),
  // Pubky methods
  getHomeserverOf: vi.fn(),
  restoreSession: vi.fn(),
  sessionRestore: vi.fn(),
  grantStartDelegated: vi.fn(),
  grantStoreRemove: vi.fn(),
  grantStoreRestore: vi.fn(),
  grantStoreClearAll: vi.fn(),
  grantStoreList: vi.fn(),
  grantStoreIsAvailable: vi.fn(),
  startAuthFlow: vi.fn(),
  resumeAuthFlow: vi.fn(),
  authFlowKindSignin: vi.fn(),
  authTokenFromBytes: vi.fn(),
  eventStreamForUser: vi.fn(),
  // Auth store session
  currentSession: null as Session | null,
}));

// Mock global fetch for generateSignupToken tests (calls /api/dev/signup-token)
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock pubky-app-specs to avoid WebAssembly issues
vi.mock('pubky-app-specs', () => ({
  default: vi.fn(() => Promise.resolve()),
  getValidMimeTypes: () => ['image/jpeg', 'image/png'],
}));

// Mock Logger to suppress console output during tests
vi.mock('@/libs/logger/logger', () => ({
  Logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock useAuthStore to provide session
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: {
    getState: () => ({
      selectSession: () => {
        // Access mockState.currentSession at call time, not at mock creation time
        return mockState.currentSession;
      },
    }),
  },
}));

// =============================================================================
// MOCK @synonymdev/pubky MODULE
// =============================================================================

vi.mock('@synonymdev/pubky', () => {
  const createMockPubkyInstance = () => ({
    getHomeserverOf: (...args: unknown[]) => mockState.getHomeserverOf(...args),
    restoreSession: (...args: unknown[]) => mockState.restoreSession(...args),
    startCookieAuthFlow: (...args: unknown[]) => mockState.startAuthFlow(...args),
    resumeCookieAuthFlow: (...args: unknown[]) => mockState.resumeAuthFlow(...args),
    eventStreamForUser: (...args: unknown[]) => mockState.eventStreamForUser(...args),
    client: {
      fetch: (...args: unknown[]) => mockState.clientFetch(...args),
    },
    browserSessionStore: {
      restore: (...args: unknown[]) => mockState.grantStoreRestore(...args),
      remove: (...args: unknown[]) => mockState.grantStoreRemove(...args),
      clearAll: (...args: unknown[]) => mockState.grantStoreClearAll(...args),
      list: (...args: unknown[]) => mockState.grantStoreList(...args),
      isAvailable: (...args: unknown[]) => mockState.grantStoreIsAvailable(...args),
    },
    publicStorage: {
      get: (...args: unknown[]) => mockState.publicStorageGet(...args),
      exists: (...args: unknown[]) => mockState.publicStorageExists(...args),
      list: (...args: unknown[]) => mockState.publicStorageList(...args),
    },
    signer: () => ({
      signup: (...args: unknown[]) => mockState.signup(...args),
      signin: (...args: unknown[]) => mockState.signin(...args),
      pkdns: {
        publishHomeserverForce: (...args: unknown[]) => mockState.publishHomeserverForce(...args),
      },
    }),
  });

  const MockPubky = vi.fn().mockImplementation(createMockPubkyInstance);
  // @ts-expect-error - Adding static testnet method
  MockPubky.testnet = vi.fn().mockImplementation(createMockPubkyInstance);

  return {
    // Parser behavior is covered with the real SDK in config/app.test.ts.
    validateCapabilities: (value: string) => value,
    Pubky: MockPubky,
    Session: {
      restore: (...args: unknown[]) => mockState.sessionRestore(...args),
    },
    GrantAuthFlow: {
      startDelegated: (...args: unknown[]) => mockState.grantStartDelegated(...args),
      isDelegationAvailable: true,
    },
    PublicKey: {
      from: vi.fn().mockReturnValue({
        z32: () => 'homeserver-public-key-z32',
      }),
    },
    Keypair: {
      random: vi.fn(),
      fromSecret: vi.fn(),
    },
    AuthFlowKind: {
      signin: () => mockState.authFlowKindSignin(),
    },
    AuthToken: {
      fromBytes: (...args: unknown[]) => mockState.authTokenFromBytes(...args),
    },
    resolvePubky: vi.fn((url: string) => url.replace('pubky://', 'https://')),
  };
});

// =============================================================================
// HELPER FACTORIES
// =============================================================================

/**
 * Creates a mock Session object
 */
const createMockSession = (): Session =>
  asOpaque<Session>({
    info: {
      publicKey: {
        z32: () => 'user',
      },
    },
    storage: {
      get: (...args: unknown[]) => mockState.sessionStorageGet(...args),
      exists: (...args: unknown[]) => mockState.sessionStorageExists(...args),
      putJson: (...args: unknown[]) => mockState.sessionStoragePutJson(...args),
      putBytes: (...args: unknown[]) => mockState.sessionStoragePutBytes(...args),
      delete: (...args: unknown[]) => mockState.sessionStorageDelete(...args),
      list: (...args: unknown[]) => mockState.sessionStorageList(...args),
    },
    signout: (...args: unknown[]) => mockState.sessionSignout(...args),
  });

/**
 * Creates a mock Keypair
 */
const createMockKeypair = (): Keypair =>
  asOpaque<Keypair>({
    publicKey: {
      z32: () => 'test-public-key-z32',
    } as PublicKey,
    secret: vi.fn(() => new Uint8Array(32).fill(1)),
  });

/**
 * Temporarily declare a staging deploy (PUBKY_RUNTIME_ENV=staging) and point
 * runtime config at canonical staging homeserver values.
 */
async function withStagingHomeserverEnv(
  run: () => Promise<void>,
  { keepTestHomeserver = false }: { keepTestHomeserver?: boolean } = {},
): Promise<void> {
  const { resetRuntimeConfigForTests } = await import('@/libs/runtime-config/runtime-config');
  const { NETWORK_RUNTIME_DEFAULTS } = await import('@/libs/runtime-config/runtime-config.schema');

  const previousDeployEnv = process.env.PUBKY_RUNTIME_ENV;
  const previousHomeserver = process.env.PUBKY_RUNTIME_HOMESERVER;
  const previousHomeserverUrl = process.env.PUBKY_RUNTIME_HOMESERVER_URL;
  process.env.PUBKY_RUNTIME_ENV = 'staging';
  if (!keepTestHomeserver) {
    process.env.PUBKY_RUNTIME_HOMESERVER = NETWORK_RUNTIME_DEFAULTS.homeserver;
    process.env.PUBKY_RUNTIME_HOMESERVER_URL = NETWORK_RUNTIME_DEFAULTS.homeserverUrl;
  }
  resetRuntimeConfigForTests();

  try {
    await run();
  } finally {
    process.env.PUBKY_RUNTIME_ENV = previousDeployEnv;
    process.env.PUBKY_RUNTIME_HOMESERVER = previousHomeserver;
    process.env.PUBKY_RUNTIME_HOMESERVER_URL = previousHomeserverUrl;
    resetRuntimeConfigForTests();
  }
}

// =============================================================================
// TEST SUITE
// =============================================================================

describe('HomeserverService', () => {
  let HomeserverService: typeof import('@/services/homeserver/homeserver').HomeserverService;

  afterEach(removeWebLocks);

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockState.currentSession = null;
    installWebLocks();
    mockState.grantStoreIsAvailable.mockReset().mockResolvedValue(true);

    // Setup default successful behaviors
    mockState.signup.mockResolvedValue(createMockSession());
    mockState.signin.mockResolvedValue(createMockSession());
    mockState.publishHomeserverForce.mockResolvedValue(undefined);
    mockState.clientFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    mockState.publicStorageGet.mockResolvedValue(new Response('{}', { status: 200 }));
    mockState.publicStorageExists.mockResolvedValue(true);
    mockState.publicStorageList.mockResolvedValue([]);
    mockState.getHomeserverOf.mockResolvedValue('https://test-homeserver.com');
    mockState.sessionSignout.mockResolvedValue(undefined);
    mockState.sessionStorageGet.mockResolvedValue(new Response('{}', { status: 200 }));
    mockState.sessionStorageExists.mockResolvedValue(true);
    mockState.sessionStoragePutJson.mockResolvedValue(undefined);
    mockState.sessionStoragePutBytes.mockResolvedValue(undefined);
    mockState.sessionStorageDelete.mockResolvedValue(undefined);
    mockState.sessionStorageList.mockResolvedValue([]);
    mockState.startAuthFlow.mockReturnValue({
      authorizationUrl: 'https://auth.example.com/authorize',
      tryPollOnce: vi.fn().mockResolvedValue(createMockSession()),
      free: vi.fn(),
    });
    mockState.authTokenFromBytes.mockReset();
    mockState.authFlowKindSignin.mockReturnValue('signin-kind');
    mockState.eventStreamForUser.mockReturnValue({
      path: vi.fn().mockReturnThis(),
      live: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockResolvedValue(new ReadableStream()),
    });

    // Reset module cache and re-import
    vi.resetModules();
    ({ HomeserverService } = await import('@/services/homeserver/homeserver'));
  });

  // ===========================================================================
  // API SURFACE
  // ===========================================================================

  describe('API Surface', () => {
    it('should expose the expected public API', () => {
      expect(HomeserverService).toBeDefined();

      const expectedMethods = [
        'signUp',
        'verifySignupToken',
        'signIn',
        'logout',
        'generateAuthUrl',
        'signInWithFullGrantAuthToken',
        'currentSessionHasFullGrant',
        'request',
        'putBlob',
        'list',
        'delete',
        'get',
        'exists',
        'generateSignupToken',
        'subscribeUserEventStreamForPath',
      ] as const;

      expectedMethods.forEach((method) => {
        expect(typeof HomeserverService[method]).toBe('function');
      });
    });
  });

  // ===========================================================================
  // AUTHENTICATION
  // ===========================================================================

  describe('Authentication', () => {
    describe('signUp', () => {
      it('should return session on successful signup', async () => {
        const keypair = createMockKeypair();
        const signupToken = 'valid-signup-token';
        const expectedSession = createMockSession();

        mockState.signup.mockResolvedValue(undefined);
        mockState.signin.mockResolvedValue(expectedSession);

        const result = await HomeserverService.signUp({ keypair, signupToken });

        expect(result).toEqual({ session: expectedSession });
      });

      it('should call signer.signup with signup token', async () => {
        const keypair = createMockKeypair();
        const signupToken = 'test-token';

        await HomeserverService.signUp({ keypair, signupToken });

        expect(mockState.signup).toHaveBeenCalledWith(
          expect.anything(), // homeserver public key
          signupToken,
        );
      });

      it('should throw SIGNUP_FAILED error when signup fails with Error', async () => {
        const keypair = createMockKeypair();
        const signupToken = 'invalid-token';

        mockState.signup.mockRejectedValue(new Error('Invalid token'));
        mockState.signin.mockRejectedValue(new Error('Account does not exist'));

        await expect(HomeserverService.signUp({ keypair, signupToken })).rejects.toMatchObject({
          category: ErrorCategory.Server,
          code: ServerErrorCode.INTERNAL_ERROR,
        });
      });

      it('should throw SIGNUP_FAILED error when signup fails with non-Error', async () => {
        const keypair = createMockKeypair();
        const signupToken = 'bad-token';

        mockState.signup.mockRejectedValue('string error');
        mockState.signin.mockRejectedValue(new Error('Account does not exist'));

        await expect(HomeserverService.signUp({ keypair, signupToken })).rejects.toMatchObject({
          category: ErrorCategory.Server,
          code: ServerErrorCode.INTERNAL_ERROR,
        });
      });

      it('should preserve original error message in error details', async () => {
        const keypair = createMockKeypair();
        const signupToken = 'token';
        const originalMessage = 'Token expired';

        mockState.signup.mockRejectedValue(new Error(originalMessage));
        mockState.signin.mockRejectedValue(new Error('Account does not exist'));

        try {
          await HomeserverService.signUp({ keypair, signupToken });
          expect.fail('Should have thrown');
        } catch (error) {
          // Use name check instead of instanceof due to module reset
          expect((error as Error).name).toBe('AppError');
          // The original error message becomes the error message
          expect((error as AppError).message).toBe(originalMessage);
        }
      });
    });

    it('recovers an account after a production invite was consumed before grant completion', async () => {
      const session = createMockSession();
      mockState.signup.mockRejectedValue(new Error('Invite already consumed'));
      mockState.signin.mockResolvedValue(session);
      await expect(HomeserverService.signUp({ keypair: createMockKeypair(), signupToken: 'spent' })).resolves.toEqual({
        session,
      });
      expect(mockState.signin).toHaveBeenCalledWith('shop.pubky.app');
    });

    it('uses the runtime client id for recovery-key sign-in and signup', async () => {
      const { resetRuntimeConfigForTests } = await import('@/libs/runtime-config/runtime-config');
      vi.stubEnv('PUBKY_RUNTIME_SHOP_GRANT_CLIENT_ID', 'staging.pubky.app');
      resetRuntimeConfigForTests();
      try {
        await HomeserverService.signIn({ keypair: createMockKeypair() });
        expect(mockState.signin).toHaveBeenLastCalledWith('staging.pubky.app');
        await HomeserverService.signUp({ keypair: createMockKeypair(), signupToken: 'invite' });
        expect(mockState.signin).toHaveBeenLastCalledWith('staging.pubky.app');
      } finally {
        vi.unstubAllEnvs();
        resetRuntimeConfigForTests();
      }
    });

    describe('signUp (staging: direct URL, grant session)', () => {
      it('creates the account without a cookie, publishes and signs in with the Shop client', async () => {
        await withStagingHomeserverEnv(async () => {
          const session = createMockSession();
          mockState.clientFetch.mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));
          mockState.signin.mockResolvedValue(session);
          expect(await HomeserverService.signUp({ keypair: createMockKeypair(), signupToken: 'invite' })).toEqual({
            session,
          });
          expect(mockState.clientFetch).toHaveBeenCalledWith(
            expect.stringContaining('/signup?'),
            expect.objectContaining({ credentials: 'omit' }),
          );
          expect(mockState.publishHomeserverForce).toHaveBeenCalled();
          expect(mockState.signin).toHaveBeenCalledWith('shop.pubky.app');
          expect(mockState.sessionRestore).not.toHaveBeenCalled();
        });
      });
      it('recovers a consumed invite using a grant without cookie restoration', async () => {
        await withStagingHomeserverEnv(async () => {
          const session = createMockSession();
          mockState.clientFetch.mockResolvedValue(new Response('used', { status: 400 }));
          mockState.signin.mockResolvedValue(session);
          expect(await HomeserverService.signUp({ keypair: createMockKeypair(), signupToken: 'invite' })).toEqual({
            session,
          });
          expect(mockState.signin).toHaveBeenCalledWith('shop.pubky.app');
          expect(mockState.sessionRestore).not.toHaveBeenCalled();
        });
      });
      it('keeps the spent invite recoverable after grant creation failures', async () => {
        await withStagingHomeserverEnv(async () => {
          vi.useFakeTimers();
          try {
            mockState.clientFetch.mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));
            mockState.signin.mockRejectedValue(new Error('offline'));
            const result = HomeserverService.signUp({ keypair: createMockKeypair(), signupToken: 'invite' }).catch(
              (error) => error,
            );
            await vi.runAllTimersAsync();
            expect(await result).toMatchObject({ code: ServerErrorCode.SERVICE_UNAVAILABLE });
            expect(mockState.signin).toHaveBeenCalledTimes(4);
            expect(mockState.sessionRestore).not.toHaveBeenCalled();
          } finally {
            vi.useRealTimers();
          }
        });
      });
    });

    describe('verifySignupToken', () => {
      it('should return valid when the homeserver responds with status valid', async () => {
        mockState.clientFetch.mockResolvedValue(new Response(JSON.stringify({ status: 'valid' }), { status: 200 }));

        const result = await HomeserverService.verifySignupToken('YVB2-YFRN-GDY0');

        expect(result).toBe('valid');
        expect(mockState.clientFetch).toHaveBeenCalledWith(expect.stringContaining('/signup_tokens/YVB2-YFRN-GDY0'), {
          method: HttpMethod.GET,
        });
      });

      it('should return used when the homeserver responds with status used', async () => {
        mockState.clientFetch.mockResolvedValue(new Response(JSON.stringify({ status: 'used' }), { status: 200 }));

        const result = await HomeserverService.verifySignupToken('YVB2-YFRN-GDY0');

        expect(result).toBe('used');
      });

      it('should return invalid when the homeserver responds with 404', async () => {
        mockState.clientFetch.mockResolvedValue(new Response(null, { status: 404 }));

        const result = await HomeserverService.verifySignupToken('BADC-0DE0-0000');

        expect(result).toBe('invalid');
      });

      it('should return invalid when the homeserver responds with an unexpected payload', async () => {
        mockState.clientFetch.mockResolvedValue(new Response(JSON.stringify({ status: 'unknown' }), { status: 200 }));

        const result = await HomeserverService.verifySignupToken('BADC-0DE0-0000');

        expect(result).toBe('invalid');
      });

      it('logs only the status when the verification body is not JSON', async () => {
        const windowed = '{"status":"valid"';
        mockState.clientFetch.mockResolvedValue(new Response(windowed, { status: 200 }));
        const { Logger } = await import('@/libs/logger/logger');

        const result = await HomeserverService.verifySignupToken('YVB2-YFRN-GDY0');

        expect(result).toBe('invalid');
        expect(JSON.stringify(vi.mocked(Logger.warn).mock.calls)).not.toContain(windowed);
        expect(JSON.stringify(vi.mocked(Logger.warn).mock.calls)).not.toContain('Unexpected token');
      });

      it('should rethrow when the homeserver cannot be reached', async () => {
        mockState.clientFetch.mockRejectedValue(new Error('network error'));

        await expect(HomeserverService.verifySignupToken('YVB2-YFRN-GDY0')).rejects.toThrow('network error');
      });

      it('should URL-encode the signup token', async () => {
        mockState.clientFetch.mockResolvedValue(new Response(JSON.stringify({ status: 'valid' }), { status: 200 }));

        await HomeserverService.verifySignupToken('AB CD/EF');

        expect(mockState.clientFetch).toHaveBeenCalledWith(expect.stringContaining('/signup_tokens/AB%20CD%2FEF'), {
          method: HttpMethod.GET,
        });
      });
    });

    describe('signIn', () => {
      it('should skip homeserver resolution when the deploy is not staging', async () => {
        const keypair = createMockKeypair();

        await HomeserverService.assertUserHomeserverAllowed({ publicKey: keypair.publicKey });

        expect(mockState.getHomeserverOf).not.toHaveBeenCalled();
      });

      it('should return session on successful signin', async () => {
        const keypair = createMockKeypair();
        const expectedSession = createMockSession();

        mockState.getHomeserverOf.mockResolvedValue('https://homeserver.example.com');
        mockState.signin.mockResolvedValue(expectedSession);

        const result = await HomeserverService.signIn({ keypair });

        expect(mockState.signin).toHaveBeenCalled();
        expect(result).toEqual({ session: expectedSession });
      });

      it('should check homeserver before signing in', async () => {
        const keypair = createMockKeypair();

        mockState.getHomeserverOf.mockResolvedValue('https://homeserver.example.com');

        await HomeserverService.signIn({ keypair });

        expect(mockState.getHomeserverOf).toHaveBeenCalledWith(keypair.publicKey);
      });

      it('should attempt to republish homeserver and return undefined when the record is provably absent', async () => {
        // NOTE: This is intentional behavior - after republishing the homeserver,
        // the method returns undefined to signal the caller should retry signin.
        // The republish is a recovery mechanism when PKARR records are stale,
        // and only fires when the lookup RESOLVED to "no record".
        const keypair = createMockKeypair();

        mockState.getHomeserverOf.mockResolvedValue(null);

        const result = await HomeserverService.signIn({ keypair });

        expect(mockState.publishHomeserverForce).toHaveBeenCalled();
        expect(result).toBeUndefined();
      });

      it('should not republish when the homeserver lookup fails outside staging', async () => {
        // A thrown lookup does not prove the record is absent — republishing on
        // it could overwrite an existing record that points elsewhere.
        const keypair = createMockKeypair();

        mockState.getHomeserverOf.mockRejectedValue(new Error('PKARR relay unavailable'));

        await expect(HomeserverService.signIn({ keypair })).rejects.toMatchObject({
          category: ErrorCategory.Server,
        });
        expect(mockState.signin).not.toHaveBeenCalled();
        expect(mockState.publishHomeserverForce).not.toHaveBeenCalled();
      });

      it('should throw SESSION_EXPIRED error when both signin and republish fail', async () => {
        // NOTE: handleError converts 401 errors to SESSION_EXPIRED (see error.utils.ts)
        const keypair = createMockKeypair();

        mockState.getHomeserverOf.mockResolvedValue(null);
        mockState.publishHomeserverForce.mockRejectedValue(new Error('Republish failed'));

        await expect(HomeserverService.signIn({ keypair })).rejects.toMatchObject({
          category: ErrorCategory.Auth,
          code: AuthErrorCode.SESSION_EXPIRED,
        });
      });

      it('should reject mismatched homeserver on staging without republishing', async () => {
        await withStagingHomeserverEnv(async () => {
          const keypair = createMockKeypair();
          mockState.getHomeserverOf.mockResolvedValue({
            z32: () => 'prod-homeserver-public-key-z32',
          });

          await expect(HomeserverService.signIn({ keypair })).rejects.toMatchObject({
            category: ErrorCategory.Auth,
            code: AuthErrorCode.WRONG_ENVIRONMENT_HOMESERVER,
          });
          expect(mockState.signin).not.toHaveBeenCalled();
          expect(mockState.publishHomeserverForce).not.toHaveBeenCalled();
        });
      });

      it('should reject an absent homeserver record on staging without republishing', async () => {
        // Absence cannot prove the key belongs to this deploy — it is rejected
        // like a mismatch (deterministic, non-retryable) rather than surfaced
        // as a transient server error.
        await withStagingHomeserverEnv(async () => {
          const keypair = createMockKeypair();
          mockState.getHomeserverOf.mockResolvedValue(null);

          await expect(HomeserverService.signIn({ keypair })).rejects.toMatchObject({
            category: ErrorCategory.Auth,
            code: AuthErrorCode.WRONG_ENVIRONMENT_HOMESERVER,
          });
          expect(mockState.signin).not.toHaveBeenCalled();
          expect(mockState.publishHomeserverForce).not.toHaveBeenCalled();
        });
      });

      it('should not republish when homeserver resolution fails on staging', async () => {
        await withStagingHomeserverEnv(async () => {
          const keypair = createMockKeypair();
          mockState.getHomeserverOf.mockRejectedValue(new Error('PKARR relay unavailable'));

          await expect(HomeserverService.signIn({ keypair })).rejects.toMatchObject({
            category: ErrorCategory.Server,
          });
          expect(mockState.signin).not.toHaveBeenCalled();
          expect(mockState.publishHomeserverForce).not.toHaveBeenCalled();
        });
      });

      it('should allow signin on staging when PKARR homeserver matches configured homeserver', async () => {
        await withStagingHomeserverEnv(async () => {
          const { NETWORK_RUNTIME_DEFAULTS } = await import('@/libs/runtime-config/runtime-config.schema');
          const keypair = createMockKeypair();
          const expectedSession = createMockSession();
          mockState.getHomeserverOf.mockResolvedValue({
            z32: () => NETWORK_RUNTIME_DEFAULTS.homeserver,
          });
          mockState.signin.mockResolvedValue(expectedSession);

          const result = await HomeserverService.signIn({ keypair });

          expect(result).toEqual({ session: expectedSession });
          expect(mockState.publishHomeserverForce).not.toHaveBeenCalled();
        });
      });

      it('should keep the staging guard active when homeserver config drifts from the canonical defaults', async () => {
        // Regression: the guard is driven by the declared PUBKY_RUNTIME_ENV, not
        // by config equality with the compiled-in staging defaults — drift used
        // to silently disable it and re-enable the force-republish path.
        await withStagingHomeserverEnv(
          async () => {
            const keypair = createMockKeypair();
            mockState.getHomeserverOf.mockResolvedValue({
              z32: () => 'prod-homeserver-public-key-z32',
            });

            await expect(HomeserverService.signIn({ keypair })).rejects.toMatchObject({
              category: ErrorCategory.Auth,
              code: AuthErrorCode.WRONG_ENVIRONMENT_HOMESERVER,
            });
            expect(mockState.signin).not.toHaveBeenCalled();
            expect(mockState.publishHomeserverForce).not.toHaveBeenCalled();
          },
          { keepTestHomeserver: true },
        );
      });
    });

    describe('logout', () => {
      it('should sign out using the Session object', async () => {
        const session = createMockSession();

        await HomeserverService.logout({ session });

        expect(mockState.sessionSignout).toHaveBeenCalledOnce();
      });

      it('should throw error when signout fails', async () => {
        const session = createMockSession();
        mockState.sessionSignout.mockRejectedValue(new Error('Network error'));

        await expect(HomeserverService.logout({ session })).rejects.toMatchObject({
          category: ErrorCategory.Server,
          code: ServerErrorCode.INTERNAL_ERROR,
        });
      });
    });

    describe('grant key removal (sign-out and expiry cleanup)', () => {
      // After the module reset above: the error class must come from the same graph.
      let isGrantKeyRemovalError: typeof import('./error.utils').isGrantKeyRemovalError;

      beforeEach(async () => {
        ({ isGrantKeyRemovalError } = await import('./error.utils'));
        mockState.grantStoreRemove.mockReset().mockResolvedValue(undefined);
        mockState.grantStoreClearAll.mockReset().mockResolvedValue(undefined);
        mockState.grantStoreList.mockReset().mockResolvedValue([]);
        mockState.grantStoreIsAvailable.mockReset().mockResolvedValue(true);
      });

      it('remove rejects while the record is still stored, even when the SDK call resolved', async () => {
        mockState.grantStoreList.mockResolvedValue([{ id: 'rec-1' }]);

        const failure = await HomeserverService.removeGrantSession('rec-1').catch((error: unknown) => error);

        expect(isGrantKeyRemovalError(failure)).toBe(true);
        expect(mockState.grantStoreRemove).toHaveBeenCalledWith('rec-1');
      });

      it('remove rejects when the SDK delete fails and the record is still stored', async () => {
        mockState.grantStoreRemove.mockRejectedValue(new Error('IndexedDB delete failed'));
        mockState.grantStoreList.mockResolvedValue([{ id: 'rec-1' }, { id: 'rec-2' }]);

        const failure = await HomeserverService.removeGrantSession('rec-1').catch((error: unknown) => error);

        expect(isGrantKeyRemovalError(failure)).toBe(true);
      });

      it('remove rejects when the store cannot be read back', async () => {
        mockState.grantStoreList.mockRejectedValue(new Error('IndexedDB unavailable'));

        const failure = await HomeserverService.removeGrantSession('rec-1').catch((error: unknown) => error);

        expect(isGrantKeyRemovalError(failure)).toBe(true);
      });

      it('remove resolves once the record is gone, even if the SDK delete reported an error', async () => {
        mockState.grantStoreRemove.mockRejectedValue(new Error('already deleted'));
        mockState.grantStoreList.mockResolvedValue([{ id: 'rec-2' }]);

        await expect(HomeserverService.removeGrantSession('rec-1')).resolves.toBeUndefined();
      });

      it('remove rejects an unavailable store even when list silently reports no records', async () => {
        mockState.grantStoreIsAvailable.mockResolvedValue(false);

        const failure = await HomeserverService.removeGrantSession('rec-1').catch((error: unknown) => error);

        expect(isGrantKeyRemovalError(failure)).toBe(true);
        expect(mockState.grantStoreRemove).not.toHaveBeenCalled();
      });

      it('remove rejects when storage becomes unavailable during a silent SDK no-op', async () => {
        mockState.grantStoreIsAvailable.mockResolvedValueOnce(true).mockResolvedValue(false);
        const failure = await HomeserverService.removeGrantSession('rec-1').catch((error: unknown) => error);
        expect(isGrantKeyRemovalError(failure)).toBe(true);
      });

      it('remove preserves the cleanup error when availability cannot be checked after a failed delete', async () => {
        mockState.grantStoreRemove.mockRejectedValue(new Error('IndexedDB unavailable'));
        mockState.grantStoreIsAvailable.mockRejectedValue(new Error('Availability check failed'));

        const failure = await HomeserverService.removeGrantSession('rec-1').catch((error: unknown) => error);

        expect(isGrantKeyRemovalError(failure)).toBe(true);
      });

      it('removes only explicit Shop record IDs and never uses clearAll', async () => {
        mockState.grantStoreList.mockResolvedValue([{ id: 'app-record' }]);
        await HomeserverService.clearGrantSessions({ recordIds: ['shop-record'] });
        expect(mockState.grantStoreRemove).toHaveBeenCalledWith('shop-record');
        expect(mockState.grantStoreRemove).not.toHaveBeenCalledWith('app-record');
        expect(mockState.grantStoreClearAll).not.toHaveBeenCalled();
      });
    });
    it('rejects legacy cookie restoration and redemption without fetching', async () => {
      await expect(HomeserverService.restoreSession({ sessionExport: 'legacy' })).rejects.toMatchObject({
        code: AuthErrorCode.UNAUTHORIZED,
      });
      await expect(HomeserverService.signInWithFullGrantAuthToken(new Uint8Array())).rejects.toMatchObject({
        code: AuthErrorCode.UNAUTHORIZED,
      });
      expect(mockState.sessionRestore).not.toHaveBeenCalled();
      expect(mockState.clientFetch).not.toHaveBeenCalled();
    });

    describe('currentSessionHasFullGrant', () => {
      const PUBKY_APP_SIGN_IN = '/pub/pubky.app/:rw,/priv/social/:rw,/priv/app.locks/content/:r';
      const cookieSession = (capabilities: string) =>
        asOpaque<Session>({ info: { capabilities: capabilities.split(',') } });
      const grantSession = (capabilities: string) =>
        asOpaque<Session>({ info: { capabilities: capabilities.split(',') }, grant: { id: 'grant-1' } });

      it.each([
        ['a Ring cookie session holding the Ring set', cookieSession(RING_COOKIE_CAPABILITIES), false],
        [
          'a Ring cookie session holding the Ring set in another order',
          cookieSession(RING_COOKIE_CAPABILITIES.split(',').reverse().join(',')),
          false,
        ],
        ['a cookie session that pubky.app narrowed to its own set', cookieSession(PUBKY_APP_SIGN_IN), false],
        ['a cookie session holding only the Shop grant', cookieSession(CAPABILITIES), false],
        ['a root cookie session', cookieSession('/:rw'), false],
        ['a grant session holding the Shop grant', grantSession(CAPABILITIES), true],
        ['an older grant missing chat permissions', grantSession(RING_COOKIE_CAPABILITIES), true],
        ['a core-only grant', grantSession('/pub/pubky.app/:rw,/pub/paykit/:rw,/priv/pubky.app/:rw'), true],
        ['a Chat-only grant', grantSession('/pub/chat/v0/:rw,/priv/chat/v0/:rw'), false],
      ])('%s → %s', (_label, session, full) => {
        mockState.currentSession = session;

        expect(HomeserverService.currentSessionHasFullGrant()).toBe(full);
      });

      it('is false with no session', () => {
        mockState.currentSession = null;

        expect(HomeserverService.currentSessionHasFullGrant()).toBe(false);
      });

      it("reports the Shop's private and Paykit trees unwritable once pubky.app narrowed the cookie", () => {
        mockState.currentSession = cookieSession(PUBKY_APP_SIGN_IN);
        expect(HomeserverService.canCurrentSessionWrite('/priv/pubky.app/')).toBe(false);
        expect(HomeserverService.canCurrentSessionWrite('/pub/paykit/')).toBe(false);
        expect(HomeserverService.canCurrentSessionWrite('/pub/pubky.app/')).toBe(true);

        mockState.currentSession = cookieSession(RING_COOKIE_CAPABILITIES);
        expect(HomeserverService.canCurrentSessionWrite('/priv/pubky.app/')).toBe(true);
        expect(HomeserverService.canCurrentSessionWrite('/pub/paykit/')).toBe(true);
        expect(HomeserverService.canCurrentSessionWrite('/priv/social/')).toBe(true);
      });
    });
  });

  describe('Data Operations', () => {
    describe('bounded auth IO', () => {
      afterEach(() => vi.useRealTimers());

      it('keeps a timed-out retirement retryable and ignores late remote success', async () => {
        vi.useFakeTimers();
        let finishSignout!: () => void;
        const pendingSignout = new Promise<void>((resolve) => {
          finishSignout = resolve;
        });
        const session = asOpaque<Session>({
          grant: {
            sessionInfo: vi.fn().mockResolvedValue({
              clientId: 'shop.pubky.app',
              publicKey: { z32: () => 'user' },
              grantId: 'old',
            }),
          },
          signout: vi.fn().mockReturnValueOnce(pendingSignout).mockResolvedValue(undefined),
        });
        mockState.grantStoreRestore.mockResolvedValue(session);
        mockState.grantStoreRemove.mockReset().mockResolvedValue(undefined);
        mockState.grantStoreList.mockReset().mockResolvedValue([]);
        HomeserverService.queueGrantRetirement('user:old');
        const marker = 'shop-owned-grant-v1:retirement:user:old';
        let failure: unknown;
        void HomeserverService.clearGrantSessions().catch((error: unknown) => {
          failure = error;
        });
        await vi.advanceTimersByTimeAsync(15_001);
        expect(failure).toMatchObject({ category: ErrorCategory.Timeout });
        expect(localStorage.getItem(marker)).not.toBeNull();
        expect(mockState.grantStoreRemove).not.toHaveBeenCalled();
        finishSignout();
        await vi.advanceTimersByTimeAsync(1);
        expect(localStorage.getItem(marker)).not.toBeNull();
        expect(mockState.grantStoreRemove).not.toHaveBeenCalled();
        await HomeserverService.clearGrantSessions();
        expect(mockState.grantStoreRemove).toHaveBeenCalledExactlyOnceWith('user:old');
        expect(localStorage.getItem(marker)).toBeNull();
      });

      it('cannot deliver a late read result to the bootstrap continuation after timeout', async () => {
        vi.useFakeTimers();
        let finishRead!: (response: Response) => void;
        mockState.currentSession = createMockSession();
        mockState.sessionStorageGet.mockReturnValue(
          new Promise<Response>((resolve) => {
            finishRead = resolve;
          }),
        );
        const persist = vi.fn();
        const result = HomeserverService.request({ method: HttpMethod.GET, url: 'pubky://user/pub/last_read' })
          .then(persist)
          .catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(15_001);
        expect(await result).toMatchObject({ category: ErrorCategory.Timeout });
        finishRead(new Response('{"timestamp":123}'));
        await vi.advanceTimersByTimeAsync(1);
        expect(persist).not.toHaveBeenCalled();
      });

      it.each(['request', 'body', 'list', 'logout'] as const)(
        'settles a stalled %s instead of holding auth forever',
        async (operation) => {
          vi.useFakeTimers();
          const stalled = new Promise<never>(() => {});
          mockState.currentSession = createMockSession();
          let call: Promise<unknown>;
          if (operation === 'list') {
            mockState.sessionStorageList.mockReturnValue(stalled);
            call = HomeserverService.list({ baseDirectory: 'pubky://user/pub/feeds/' });
          } else if (operation === 'logout') {
            mockState.sessionSignout.mockReturnValue(stalled);
            call = HomeserverService.logout({ session: mockState.currentSession });
          } else {
            mockState.sessionStorageGet.mockReturnValue(
              operation === 'request'
                ? stalled
                : Promise.resolve({
                    ok: true,
                    text: () => stalled,
                  }),
            );
            call = HomeserverService.request({ method: HttpMethod.GET, url: 'pubky://user/pub/last_read' });
          }
          let result: unknown;
          void call.catch((error: unknown) => {
            result = error;
          });
          await vi.advanceTimersByTimeAsync(15_001);
          expect(result).toMatchObject({ category: ErrorCategory.Timeout, code: 'REQUEST_TIMEOUT' });
        },
      );
    });

    describe('request', () => {
      describe('GET requests', () => {
        it('should return parsed JSON for successful GET', async () => {
          mockState.currentSession = createMockSession();
          const testData = { name: 'test', value: 123 };
          mockState.sessionStorageGet.mockResolvedValue(new Response(JSON.stringify(testData), { status: 200 }));

          const result = await HomeserverService.request<typeof testData>({
            method: HttpMethod.GET,
            url: 'pubky://user/pub/data.json',
          });

          expect(result).toEqual(testData);
          expect(mockState.sessionStorageGet).toHaveBeenCalledWith('/pub/data.json');
        });

        it('should return undefined for empty GET response', async () => {
          mockState.currentSession = createMockSession();
          mockState.sessionStorageGet.mockResolvedValue(new Response('', { status: 200 }));

          const result = await HomeserverService.request({
            method: HttpMethod.GET,
            url: 'pubky://user/pub/empty.json',
          });

          expect(result).toBeUndefined();
        });

        it('should return undefined for invalid JSON response', async () => {
          mockState.currentSession = createMockSession();
          mockState.sessionStorageGet.mockResolvedValue(new Response('not-valid-json', { status: 200 }));

          const result = await HomeserverService.request({
            method: HttpMethod.GET,
            url: 'pubky://user/pub/invalid.json',
          });

          expect(result).toBeUndefined();
        });
      });

      describe('PUT requests', () => {
        it('should send JSON body for PUT request', async () => {
          mockState.currentSession = createMockSession();
          const bodyData = { name: 'new-value' };
          await HomeserverService.request({
            method: HttpMethod.PUT,
            url: 'pubky://user/pub/data.json',
            bodyJson: bodyData,
          });

          expect(mockState.sessionStoragePutJson).toHaveBeenCalledWith('/pub/data.json', bodyData);
        });

        it('should throw INVALID_INPUT when PUT is attempted without a session on a pubky:// address', async () => {
          mockState.currentSession = null;
          await expect(
            HomeserverService.request({
              method: HttpMethod.PUT,
              url: 'pubky://someone/pub/data.json',
              bodyJson: { ok: true },
            }),
          ).rejects.toMatchObject({
            category: ErrorCategory.Validation,
            code: ValidationErrorCode.INVALID_INPUT,
          });
        });

        it('should return undefined for successful PUT', async () => {
          mockState.currentSession = createMockSession();

          const result = await HomeserverService.request({
            method: HttpMethod.PUT,
            url: 'pubky://user/pub/data.json',
            bodyJson: {
              data: 'test',
            },
          });

          expect(result).toBeUndefined();
        });
      });

      describe('DELETE requests', () => {
        it('should send DELETE request without body', async () => {
          mockState.currentSession = createMockSession();

          await HomeserverService.request({ method: HttpMethod.DELETE, url: 'pubky://user/pub/data.json' });

          expect(mockState.sessionStorageDelete).toHaveBeenCalledWith('/pub/data.json');
        });
      });

      describe('Error handling', () => {
        it('should throw NOT_FOUND error for 404 response', async () => {
          mockState.currentSession = createMockSession();
          mockState.sessionStorageGet.mockResolvedValue(
            new Response('Not Found', { status: 404, statusText: 'Not Found' }),
          );

          await expect(
            HomeserverService.request({ method: HttpMethod.GET, url: 'pubky://user/pub/missing.json' }),
          ).rejects.toMatchObject({
            category: ErrorCategory.Client,
            code: ClientErrorCode.NOT_FOUND,
          });
        });

        it('should throw SESSION_EXPIRED error for 401 response', async () => {
          mockState.currentSession = createMockSession();
          mockState.sessionStorageGet.mockResolvedValue(
            new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
          );

          await expect(
            HomeserverService.request({ method: HttpMethod.GET, url: 'pubky://user/pub/data.json' }),
          ).rejects.toMatchObject({
            category: ErrorCategory.Auth,
            code: AuthErrorCode.SESSION_EXPIRED,
          });
        });

        it('should throw INTERNAL_ERROR for network errors', async () => {
          mockState.currentSession = createMockSession();
          mockState.sessionStorageGet.mockRejectedValue(new Error('Network error'));

          await expect(
            HomeserverService.request({ method: HttpMethod.GET, url: 'pubky://user/pub/data.json' }),
          ).rejects.toMatchObject({
            category: ErrorCategory.Server,
            code: ServerErrorCode.INTERNAL_ERROR,
          });
        });
      });
    });

    describe('getJsonIfFound', () => {
      it('answers not found for a 404 response, logging and reporting nothing', async () => {
        mockState.currentSession = createMockSession();
        mockState.sessionStorageGet.mockResolvedValue(new Response('Not Found', { status: 404 }));

        await expect(
          HomeserverService.getJsonIfFound({ url: 'pubky://user/priv/missing.json', logUrl: '/priv/redacted/' }),
        ).resolves.toEqual({ found: false });
        expect(mockState.sessionStorageGet).toHaveBeenCalledWith('/priv/missing.json');
        expect(Logger.error).not.toHaveBeenCalled();
        expect(Logger.warn).not.toHaveBeenCalled();
      });

      it('answers not found when the client throws the 404', async () => {
        mockState.currentSession = createMockSession();
        mockState.sessionStorageGet.mockRejectedValue({
          name: 'RequestError',
          message: 'Not Found',
          data: { statusCode: 404 },
        });

        await expect(HomeserverService.getJsonIfFound({ url: 'pubky://user/priv/missing.json' })).resolves.toEqual({
          found: false,
        });
        expect(Logger.error).not.toHaveBeenCalled();
      });

      it('answers not found for a public 404', async () => {
        mockState.currentSession = null;
        mockState.publicStorageGet.mockResolvedValue(new Response('Not Found', { status: 404 }));

        await expect(HomeserverService.getJsonIfFound({ url: 'pubky://someone/pub/missing.json' })).resolves.toEqual({
          found: false,
        });
        expect(Logger.error).not.toHaveBeenCalled();
      });

      it('returns the parsed body of a stored record, a stored null included', async () => {
        mockState.currentSession = createMockSession();
        mockState.sessionStorageGet
          .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'kept' }), { status: 200 }))
          .mockResolvedValueOnce(new Response('null', { status: 200 }));

        await expect(HomeserverService.getJsonIfFound({ url: 'pubky://user/priv/a.json' })).resolves.toEqual({
          found: true,
          json: { name: 'kept' },
        });
        await expect(HomeserverService.getJsonIfFound({ url: 'pubky://user/priv/b.json' })).resolves.toEqual({
          found: true,
          json: null,
        });
      });

      it('throws every other failure like a GET', async () => {
        mockState.currentSession = createMockSession();
        mockState.sessionStorageGet
          .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
          .mockResolvedValueOnce(new Response('Boom', { status: 500 }))
          .mockRejectedValueOnce(new Error('Network error'));

        await expect(HomeserverService.getJsonIfFound({ url: 'pubky://user/priv/a.json' })).rejects.toMatchObject({
          category: ErrorCategory.Auth,
          code: AuthErrorCode.SESSION_EXPIRED,
        });
        await expect(HomeserverService.getJsonIfFound({ url: 'pubky://user/priv/a.json' })).rejects.toMatchObject({
          category: ErrorCategory.Server,
        });
        await expect(HomeserverService.getJsonIfFound({ url: 'pubky://user/priv/a.json' })).rejects.toMatchObject({
          category: ErrorCategory.Server,
          code: ServerErrorCode.INTERNAL_ERROR,
        });
      });
    });

    describe('putBlob', () => {
      it('should upload binary data successfully', async () => {
        mockState.currentSession = createMockSession();
        const blobData = new Uint8Array([1, 2, 3, 4, 5]);

        await HomeserverService.putBlob({ url: 'pubky://user/pub/avatar.png', blob: blobData });

        expect(mockState.sessionStoragePutBytes).toHaveBeenCalledWith('/pub/avatar.png', blobData);
      });

      it('should throw PAYLOAD_TOO_LARGE error for 413 response', async () => {
        mockState.currentSession = createMockSession();
        const blobData = new Uint8Array([1, 2, 3]);
        mockState.sessionStoragePutBytes.mockRejectedValue({
          name: 'RequestError',
          message: 'Payload Too Large',
          data: { statusCode: 413 },
        });

        await expect(
          HomeserverService.putBlob({ url: 'pubky://user/pub/large.bin', blob: blobData }),
        ).rejects.toMatchObject({
          category: ErrorCategory.Client,
          code: ClientErrorCode.PAYLOAD_TOO_LARGE,
        });
      });

      it('should throw SESSION_EXPIRED error for 401 response', async () => {
        mockState.currentSession = createMockSession();
        const blobData = new Uint8Array([1, 2, 3]);
        mockState.sessionStoragePutBytes.mockRejectedValue({
          name: 'AuthenticationError',
          message: 'Session expired',
          data: { statusCode: 401 },
        });

        await expect(
          HomeserverService.putBlob({ url: 'pubky://user/pub/avatar.png', blob: blobData }),
        ).rejects.toMatchObject({
          category: ErrorCategory.Auth,
          code: AuthErrorCode.SESSION_EXPIRED,
        });
      });

      // Digital deliverables live at unpublished paths (digital delivery
      // design §2): errors and logs name the redacted path only.
      it('records the redacted logUrl, never the real path, when an upload fails', async () => {
        mockState.currentSession = createMockSession();
        const realPath = 'pubky://user/pub/pubky.app/marketplace/v1/deliverables/0123456789abcdef0123456789abcdef/1';
        const logUrl = '/pub/pubky.app/marketplace/v1/deliverables/<deliverable>';
        mockState.sessionStoragePutBytes.mockRejectedValue({
          name: 'RequestError',
          message: 'Insufficient Storage',
          data: { statusCode: 507 },
        });
        const loggerError = vi.spyOn(Logger, 'error');

        const error = (await HomeserverService.putBlob({ url: realPath, blob: new Uint8Array([1]), logUrl }).catch(
          (caught: unknown) => caught,
        )) as AppError;

        expect(error.context).toMatchObject({ endpoint: logUrl, statusCode: 507 });
        expect(JSON.stringify(error.context)).not.toContain('0123456789abcdef');
        expect(JSON.stringify(loggerError.mock.calls)).not.toContain('0123456789abcdef');
        loggerError.mockRestore();
      });

      it('records the redacted logUrl when an upload has no session', async () => {
        mockState.currentSession = null;
        const error = (await HomeserverService.putBlob({
          url: 'pubky://someone/pub/pubky.app/marketplace/v1/deliverables/0123456789abcdef0123456789abcdef/1',
          blob: new Uint8Array([1]),
          logUrl: '/pub/pubky.app/marketplace/v1/deliverables/<deliverable>',
        }).catch((caught: unknown) => caught)) as AppError;

        expect(JSON.stringify(error.context)).not.toContain('0123456789abcdef');
      });

      it('records the redacted logUrl when a delete fails', async () => {
        mockState.currentSession = createMockSession();
        mockState.sessionStorageDelete.mockRejectedValue(new Error('Network error'));

        const error = (await HomeserverService.request({
          method: HttpMethod.DELETE,
          url: 'pubky://user/pub/pubky.app/marketplace/v1/deliverables/0123456789abcdef0123456789abcdef/1',
          logUrl: '/pub/pubky.app/marketplace/v1/deliverables/<deliverable>',
        }).catch((caught: unknown) => caught)) as AppError;

        expect(error.context).toMatchObject({ endpoint: '/pub/pubky.app/marketplace/v1/deliverables/<deliverable>' });
        expect(JSON.stringify(error.context)).not.toContain('0123456789abcdef');
      });

      it('should throw INVALID_INPUT when uploading blob without a session to a pubky:// address', async () => {
        mockState.currentSession = null;
        const blobData = new Uint8Array([1, 2, 3]);

        await expect(
          HomeserverService.putBlob({ url: 'pubky://someone/pub/avatar.png', blob: blobData }),
        ).rejects.toMatchObject({
          category: ErrorCategory.Validation,
          code: ValidationErrorCode.INVALID_INPUT,
        });
      });
    });

    describe('list', () => {
      it('should return array of file URLs', async () => {
        const mockFiles = ['file1.json', 'file2.json', 'file3.json'];
        mockState.publicStorageList.mockResolvedValue(mockFiles);

        const result = await HomeserverService.list({ baseDirectory: 'pubky://user/pub/posts/' });

        expect(result).toEqual(mockFiles);
      });

      it('should use session.storage.list for owned directories when session is set', async () => {
        mockState.currentSession = createMockSession();
        const mockFiles = ['pubky://user/pub/posts/file1.json', 'pubky://user/pub/posts/file2.json'];
        mockState.sessionStorageList.mockResolvedValue(mockFiles);

        const result = await HomeserverService.list({ baseDirectory: 'pubky://user/pub/posts/' });

        expect(result).toEqual(mockFiles);
        expect(mockState.sessionStorageList).toHaveBeenCalledWith(
          '/pub/posts/',
          null, // cursor
          false, // reverse
          500, // limit
          false, // shallow
        );
        expect(mockState.publicStorageList).not.toHaveBeenCalled();
      });

      it('should call list with default parameters', async () => {
        mockState.publicStorageList.mockResolvedValue([]);

        await HomeserverService.list({ baseDirectory: 'pubky://user/pub/posts/' });

        expect(mockState.publicStorageList).toHaveBeenCalledWith(
          'pubky://user/pub/posts/',
          null, // cursor
          false, // reverse
          500, // limit
          false, // shallow
        );
      });

      it('should pass pagination parameters to list', async () => {
        mockState.publicStorageList.mockResolvedValue([]);

        await HomeserverService.list({
          baseDirectory: 'pubky://user/pub/posts/',
          cursor: 'cursor123',
          reverse: true,
          limit: 100,
        });

        expect(mockState.publicStorageList).toHaveBeenCalledWith(
          'pubky://user/pub/posts/',
          'cursor123',
          true,
          100,
          false,
        );
      });

      it('should throw INTERNAL_ERROR on list failure', async () => {
        mockState.publicStorageList.mockRejectedValue(new Error('List failed'));

        await expect(HomeserverService.list({ baseDirectory: 'pubky://user/pub/posts/' })).rejects.toMatchObject({
          category: ErrorCategory.Server,
          code: ServerErrorCode.INTERNAL_ERROR,
        });
      });

      it('should return empty array when directory returns 404', async () => {
        mockState.publicStorageList.mockRejectedValue({ data: { statusCode: 404 } });

        const result = await HomeserverService.list({ baseDirectory: 'pubky://user/pub/missing/' });

        expect(result).toEqual([]);
      });

      it('records the redacted logUrl, never the listed directory, when an owned list fails', async () => {
        mockState.currentSession = createMockSession();
        const directory = 'pubky://user/priv/pubky.app/marketplace/v1/receipts/';
        const logUrl = '/priv/pubky.app/marketplace/v1/<entry>';
        mockState.sessionStorageList.mockRejectedValue(new Error('List failed'));
        const debug = vi.spyOn(Logger, 'debug');
        const warn = vi.spyOn(Logger, 'warn');

        const error = (await HomeserverService.list({ baseDirectory: directory, logUrl }).catch(
          (caught: unknown) => caught,
        )) as AppError;

        expect(error.context).toMatchObject({ endpoint: logUrl });
        expect(JSON.stringify(error.context)).not.toContain('receipts');

        mockState.sessionStorageList.mockResolvedValue([`${directory}r1`]);
        await HomeserverService.list({ baseDirectory: directory, logUrl });
        mockState.sessionStorageList.mockRejectedValue({ data: { statusCode: 404 } });
        await HomeserverService.list({ baseDirectory: directory, logUrl });
        const logged = JSON.stringify([...debug.mock.calls, ...warn.mock.calls]);
        expect(logged).toContain(logUrl);
        expect(logged).not.toContain('receipts');
      });
    });

    describe('listAll', () => {
      const baseDirectory = 'pubky://user/pub/posts/';
      const makeFiles = (count: number, offset = 0) =>
        Array.from({ length: count }, (_, i) => `${baseDirectory}file${String(offset + i).padStart(4, '0')}`);

      it('should return all files in a single page when below the page limit', async () => {
        const files = makeFiles(3);
        mockState.publicStorageList.mockResolvedValue(files);

        const result = await HomeserverService.listAll({ baseDirectory });

        expect(result).toEqual(files);
        expect(mockState.publicStorageList).toHaveBeenCalledTimes(1);
        expect(mockState.publicStorageList).toHaveBeenCalledWith(baseDirectory, null, false, 500, false);
      });

      it('should paginate with the last URL as cursor until a short page is returned', async () => {
        const page1 = makeFiles(500);
        const page2 = makeFiles(200, 500);
        mockState.publicStorageList.mockImplementation((_dir: string, cursor: string | null) =>
          Promise.resolve(cursor === null ? page1 : page2),
        );

        const result = await HomeserverService.listAll({ baseDirectory });

        expect(result).toEqual([...page1, ...page2]);
        expect(mockState.publicStorageList).toHaveBeenCalledTimes(2);
        expect(mockState.publicStorageList).toHaveBeenNthCalledWith(2, baseDirectory, page1[499], false, 500, false);
      });

      it('should stop after an empty page when the file count is an exact multiple of the page size', async () => {
        const page1 = makeFiles(500);
        mockState.publicStorageList.mockImplementation((_dir: string, cursor: string | null) =>
          Promise.resolve(cursor === null ? page1 : []),
        );

        const result = await HomeserverService.listAll({ baseDirectory });

        expect(result).toEqual(page1);
        expect(mockState.publicStorageList).toHaveBeenCalledTimes(2);
      });

      it('should propagate list failures', async () => {
        mockState.publicStorageList.mockRejectedValue(new Error('List failed'));

        await expect(HomeserverService.listAll({ baseDirectory })).rejects.toMatchObject({
          category: ErrorCategory.Server,
          code: ServerErrorCode.INTERNAL_ERROR,
        });
      });
    });

    describe('delete', () => {
      it('should call request with DELETE method', async () => {
        mockState.currentSession = createMockSession();

        await HomeserverService.delete('pubky://user/pub/file.json');

        expect(mockState.sessionStorageDelete).toHaveBeenCalledWith('/pub/file.json');
      });

      it('should throw FORBIDDEN error on delete failure with 403', async () => {
        // NOTE: For owned paths, delete uses session.storage.delete
        // handleError extracts status code from error.data.statusCode if available
        mockState.currentSession = createMockSession();
        mockState.sessionStorageDelete.mockRejectedValue({
          name: 'RequestError',
          message: 'Forbidden',
          data: { statusCode: 403 },
        });

        await expect(HomeserverService.delete('pubky://user/pub/protected.json')).rejects.toMatchObject({
          category: ErrorCategory.Auth,
          code: AuthErrorCode.FORBIDDEN,
        });
      });
    });

    describe('getBlob', () => {
      const realPath = 'pubky://someone/pub/pubky.app/marketplace/v1/deliverables/0123456789abcdef0123456789abcdef/2';
      const logUrl = '/pub/pubky.app/marketplace/v1/deliverables/<deliverable>';

      it('reads the bytes of a public path', async () => {
        mockState.publicStorageGet.mockResolvedValue(new Response(new Uint8Array([7, 8, 9]), { status: 200 }));

        const bytes = await HomeserverService.getBlob({ url: realPath, logUrl });

        expect(mockState.publicStorageGet).toHaveBeenCalledWith(realPath);
        expect([...bytes]).toEqual([7, 8, 9]);
      });

      // Digital delivery design §2: a buyer's read of a deliverable names the redacted path only.
      it('records the redacted logUrl, never the real path, when the read fails', async () => {
        mockState.publicStorageGet.mockResolvedValue(new Response('gone', { status: 404 }));
        const loggerError = vi.spyOn(Logger, 'error');

        const error = (await HomeserverService.getBlob({ url: realPath, logUrl }).catch(
          (caught: unknown) => caught,
        )) as AppError;

        expect(error.context).toMatchObject({ endpoint: logUrl, statusCode: 404 });
        expect(JSON.stringify(error.context)).not.toContain('0123456789abcdef');
        expect(JSON.stringify(loggerError.mock.calls)).not.toContain('0123456789abcdef');
        loggerError.mockRestore();
      });

      // Review P2: an oversized body is refused before it is held in memory.
      it('refuses a declared body over maxBytes without reading it', async () => {
        let pulled = 0;
        const stream = new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              pulled += 1;
              controller.enqueue(new Uint8Array(64));
              controller.close();
            },
          },
          { highWaterMark: 0 },
        );
        const body = new Response(stream, { status: 200, headers: { 'content-length': '64' } });
        const arrayBuffer = vi.spyOn(body, 'arrayBuffer');
        mockState.publicStorageGet.mockResolvedValue(body);

        const error = (await HomeserverService.getBlob({ url: realPath, logUrl, maxBytes: 19 }).catch(
          (caught: unknown) => caught,
        )) as AppError;

        expect(error).toMatchObject({
          code: ClientErrorCode.PAYLOAD_TOO_LARGE,
          context: { endpoint: logUrl, maxBytes: 19 },
        });
        expect(arrayBuffer).not.toHaveBeenCalled();
        expect(pulled).toBe(0);
      });

      it('stops reading a streamed body once it passes maxBytes', async () => {
        let pulled = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled += 1;
            controller.enqueue(new Uint8Array(10));
            if (pulled > 100) controller.close();
          },
        });
        mockState.publicStorageGet.mockResolvedValue(new Response(stream, { status: 200 }));

        await expect(HomeserverService.getBlob({ url: realPath, logUrl, maxBytes: 19 })).rejects.toMatchObject({
          code: ClientErrorCode.PAYLOAD_TOO_LARGE,
        });
        expect(pulled).toBeLessThan(10);
      });

      it('reads a body within maxBytes', async () => {
        mockState.publicStorageGet.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

        const bytes = await HomeserverService.getBlob({ url: realPath, logUrl, maxBytes: 3 });

        expect([...bytes]).toEqual([1, 2, 3]);
      });

      it('records the redacted logUrl when the transport throws', async () => {
        mockState.publicStorageGet.mockRejectedValue(new Error('Network error'));

        const error = (await HomeserverService.getBlob({ url: realPath, logUrl }).catch(
          (caught: unknown) => caught,
        )) as AppError;

        expect(JSON.stringify(error.context)).not.toContain('0123456789abcdef');
      });
    });

    describe('get', () => {
      it('should use publicStorage.get for fetching', async () => {
        const testUrl = 'pubky://user/pub/public.json';
        const mockResponse = new Response(JSON.stringify({ data: 'public' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
        mockState.publicStorageGet.mockResolvedValue(mockResponse);

        const result = await HomeserverService.get(testUrl);

        expect(mockState.publicStorageGet).toHaveBeenCalledWith(testUrl);
        expect(result).toBeInstanceOf(Response);
        const jsonData = await result.json();
        expect(jsonData).toEqual({ data: 'public' });
      });

      it('should use session.storage.get for owned paths when session is set', async () => {
        mockState.currentSession = createMockSession();
        const testUrl = 'pubky://user/pub/private.json';
        const mockResponse = new Response(JSON.stringify({ data: 'private' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
        mockState.sessionStorageGet.mockResolvedValue(mockResponse);

        const result = await HomeserverService.get(testUrl);

        expect(mockState.sessionStorageGet).toHaveBeenCalledWith('/pub/private.json');
        expect(mockState.publicStorageGet).not.toHaveBeenCalled();
        expect(result).toBeInstanceOf(Response);
        const jsonData = await result.json();
        expect(jsonData).toEqual({ data: 'private' });
      });

      it('should wrap errors from publicStorage.get as AppError', async () => {
        const testUrl = 'pubky://user/pub/data.json';
        const networkError = new Error('Network request failed');
        mockState.publicStorageGet.mockRejectedValue(networkError);

        await expect(HomeserverService.get(testUrl)).rejects.toMatchObject({
          category: ErrorCategory.Server,
          code: ServerErrorCode.INTERNAL_ERROR,
        });
      });
    });

    describe('exists', () => {
      const testUrl = 'pubky://user/pub/resource.json';

      it('should return true for an owned resource that exists', async () => {
        mockState.currentSession = createMockSession();
        mockState.sessionStorageExists.mockResolvedValue(true);

        await expect(HomeserverService.exists(testUrl)).resolves.toBe(true);

        expect(mockState.sessionStorageExists).toHaveBeenCalledWith('/pub/resource.json');
        expect(mockState.publicStorageExists).not.toHaveBeenCalled();
      });

      it('should return false without error logging when an owned resource is missing', async () => {
        mockState.currentSession = createMockSession();
        mockState.sessionStorageExists.mockResolvedValue(false);

        await expect(HomeserverService.exists(testUrl)).resolves.toBe(false);

        expect(Logger.error).not.toHaveBeenCalled();
      });

      it('should normalize unexpected owned-storage failures', async () => {
        mockState.currentSession = createMockSession();
        mockState.sessionStorageExists.mockRejectedValue(new Error('Network failure'));

        await expect(HomeserverService.exists(testUrl)).rejects.toMatchObject({
          category: ErrorCategory.Server,
          code: ServerErrorCode.INTERNAL_ERROR,
        });
      });

      it('should preserve session-expiration handling for owned-storage failures', async () => {
        mockState.currentSession = createMockSession();
        mockState.sessionStorageExists.mockRejectedValue({
          name: 'RequestError',
          message: 'Session expired',
          data: { statusCode: 401 },
        });

        await expect(HomeserverService.exists(testUrl)).rejects.toMatchObject({
          category: ErrorCategory.Auth,
          code: AuthErrorCode.SESSION_EXPIRED,
        });
      });

      it('should use publicStorage.exists when the resource is not owned', async () => {
        mockState.publicStorageExists.mockResolvedValue(true);

        await expect(HomeserverService.exists(testUrl)).resolves.toBe(true);

        expect(mockState.publicStorageExists).toHaveBeenCalledWith(testUrl);
        expect(mockState.sessionStorageExists).not.toHaveBeenCalled();
      });

      it('should return false without error logging when a public resource is missing', async () => {
        mockState.publicStorageExists.mockResolvedValue(false);

        await expect(HomeserverService.exists(testUrl)).resolves.toBe(false);

        expect(Logger.error).not.toHaveBeenCalled();
      });

      it('should normalize unexpected public-storage failures', async () => {
        mockState.publicStorageExists.mockRejectedValue(new Error('Network failure'));

        await expect(HomeserverService.exists(testUrl)).rejects.toMatchObject({
          category: ErrorCategory.Server,
          code: ServerErrorCode.INTERNAL_ERROR,
        });
      });

      it('should return true for a successful HTTP response', async () => {
        const httpUrl = 'https://example.com/resource.json';
        mockState.clientFetch.mockResolvedValue(new Response('{}', { status: 200 }));

        await expect(HomeserverService.exists(httpUrl)).resolves.toBe(true);

        expect(mockState.clientFetch).toHaveBeenCalledWith(httpUrl);
      });

      it('should return false without error logging for an HTTP 404', async () => {
        mockState.clientFetch.mockResolvedValue(new Response('', { status: 404 }));

        await expect(HomeserverService.exists('https://example.com/missing.json')).resolves.toBe(false);

        expect(Logger.error).not.toHaveBeenCalled();
      });

      it('should normalize an unexpected HTTP response', async () => {
        mockState.clientFetch.mockResolvedValue(new Response('Server error', { status: 500 }));

        await expect(HomeserverService.exists('https://example.com/broken.json')).rejects.toMatchObject({
          category: ErrorCategory.Server,
          code: ServerErrorCode.INTERNAL_ERROR,
        });
      });

      it('should preserve session-expiration handling for HTTP responses', async () => {
        mockState.clientFetch.mockResolvedValue(new Response('Session expired', { status: 401 }));

        await expect(HomeserverService.exists('https://example.com/private.json')).rejects.toMatchObject({
          category: ErrorCategory.Auth,
          code: AuthErrorCode.SESSION_EXPIRED,
        });
      });
    });
  });

  // ===========================================================================
  // EDGE CASES & ERROR HANDLING
  // ===========================================================================

  describe('Edge Cases & Error Handling', () => {
    describe('handleError (private)', () => {
      it('should re-throw AppError instances without wrapping', async () => {
        const { Err: FreshErr } = await import('@/libs/error/error.factories');
        const appError = FreshErr.auth(AuthErrorCode.UNAUTHORIZED, 'Already an AppError', {
          service: ErrorService.Homeserver,
          operation: 'test',
        });
        mockState.signup.mockRejectedValue(appError);
        mockState.signin.mockRejectedValue(new Error('Account does not exist'));

        try {
          await HomeserverService.signUp({
            keypair: createMockKeypair(),
            signupToken: 'token',
          });
          expect.fail('Should have thrown');
        } catch (error) {
          // Should be the exact same error instance (not wrapped)
          expect(error).toBe(appError);
          expect((error as AppError).category).toBe(ErrorCategory.Auth);
          expect((error as AppError).code).toBe(AuthErrorCode.UNAUTHORIZED);
          expect((error as AppError).message).toBe('Already an AppError');
        }
      });
    });

    describe('PKARR lookup failure (SDK 0.11 PkarrError)', () => {
      it('pkarr error maps to retryable network error', async () => {
        const pkarrError = { name: 'PkarrError', message: 'PKARR lookup failed: relay timeout' };
        mockState.signup.mockRejectedValue(pkarrError);
        mockState.signin.mockRejectedValue(new Error('Account does not exist'));

        const error = await HomeserverService.signUp({ keypair: createMockKeypair(), signupToken: 'token' }).catch(
          (caught: unknown) => caught,
        );

        expect(error).toMatchObject({
          category: ErrorCategory.Network,
          code: NetworkErrorCode.CONNECTION_FAILED,
        });
      });
    });

    describe('Session expiration handling', () => {
      it('should include endpoint in SESSION_EXPIRED error context', async () => {
        const testUrl = 'pubky://user/pub/data.json';
        mockState.currentSession = createMockSession();
        mockState.sessionStorageGet.mockResolvedValue(new Response('Session expired', { status: 401 }));

        try {
          await HomeserverService.request({ method: HttpMethod.GET, url: testUrl });
          expect.fail('Should have thrown');
        } catch (error) {
          // Use name check instead of instanceof due to module reset
          expect((error as Error).name).toBe('AppError');
          expect((error as AppError).context?.endpoint).toContain('user/pub/data.json');
        }
      });

      it('should use custom error message from 401 response body', async () => {
        const customMessage = 'Your session has expired, please login again';
        mockState.currentSession = createMockSession();
        mockState.sessionStorageGet.mockResolvedValue(new Response(customMessage, { status: 401 }));

        try {
          await HomeserverService.request({ method: HttpMethod.GET, url: 'pubky://user/pub/data.json' });
          expect.fail('Should have thrown');
        } catch (error) {
          // Use name check instead of instanceof due to module reset
          expect((error as Error).name).toBe('AppError');
          expect((error as AppError).message).toBe(customMessage);
        }
      });
    });

    describe('generateSignupToken (via API route)', () => {
      it('should fetch token from server-side API route', async () => {
        const expectedToken = 'generated-signup-token-123';
        mockFetch.mockResolvedValue(
          new Response(JSON.stringify({ token: expectedToken }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

        const result = await HomeserverService.generateSignupToken();

        expect(mockFetch).toHaveBeenCalledWith('/api/dev/signup-token', { method: 'GET' });
        expect(result).toBe(expectedToken);
      });

      it('should throw FORBIDDEN error for 403 response', async () => {
        mockFetch.mockResolvedValue(
          new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

        await expect(HomeserverService.generateSignupToken()).rejects.toMatchObject({
          category: ErrorCategory.Auth,
          code: AuthErrorCode.FORBIDDEN,
        });
      });

      it('should throw UNEXPECTED_ERROR when no token received', async () => {
        mockFetch.mockResolvedValue(
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

        await expect(HomeserverService.generateSignupToken()).rejects.toMatchObject({
          category: ErrorCategory.Server,
          code: ServerErrorCode.UNKNOWN_ERROR,
        });
      });

      it('should return token from JSON response', async () => {
        const expectedToken = 'token-from-json';
        mockFetch.mockResolvedValue(
          new Response(JSON.stringify({ token: expectedToken }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

        const result = await HomeserverService.generateSignupToken();

        expect(result).toBe(expectedToken);
      });
    });

    describe('subscribeUserEventStreamForPath', () => {
      it('normalizes SDK events and disposes raw WASM objects internally', async () => {
        const free = vi.fn();
        const path = vi.fn().mockReturnThis();
        const live = vi.fn().mockReturnThis();
        const subscribe = vi.fn().mockResolvedValue(
          new ReadableStream({
            start(controller) {
              controller.enqueue({ cursor: 'cursor-1', eventType: 'PUT', free });
              controller.close();
            },
          }),
        );

        mockState.eventStreamForUser.mockReturnValue({ path, live, subscribe });

        const stream = await HomeserverService.subscribeUserEventStreamForPath({
          userZ32: 'user-pubky',
          cursor: 'cursor-0',
          pathPrefix: '/pub/pubky.app/mutes/',
        });
        const reader = stream.getReader();

        const result = await reader.read();

        expect(path).toHaveBeenCalledWith('/pub/pubky.app/mutes/');
        expect(live).toHaveBeenCalled();
        expect(subscribe).toHaveBeenCalled();
        expect(result.value).toEqual({ cursor: 'cursor-1', eventType: 'PUT' });
        expect(result.value).not.toHaveProperty('free');
        expect(free).toHaveBeenCalledTimes(1);
      });
    });

    describe('URL resolution', () => {
      it('should use session storage paths for pubky URLs', async () => {
        mockState.currentSession = createMockSession();
        mockState.sessionStorageGet.mockResolvedValue(new Response('{}', { status: 200 }));

        await HomeserverService.request({ method: HttpMethod.GET, url: 'pubky://user/pub/data.json' });

        expect(mockState.sessionStorageGet).toHaveBeenCalledWith('/pub/data.json');
      });
    });
  });
});
