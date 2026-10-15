import {
  Address,
  AuthFlowKind,
  Capabilities,
  Client,
  type EncryptionKeys,
  GrantAuthFlow,
  Keypair,
  Pubky,
  PublicKey,
  resolvePubky,
  Session,
  Signer,
  type XCallbackParams,
} from '@synonymdev/pubky';
import type { TKeypairParams } from '@/application/auth/auth.types';
import { CAPABILITIES, getShopGrantClientId, isPrivKeysRequested, KEYED_CAPABILITIES } from '@/config/app';
import { withBasePath } from '@/config/base-path';
import {
  getDefaultHttpRelay,
  getDeployEnv,
  getHomeserver,
  getHomeserverUrl,
  getPkarrRelays,
  getTestnet,
  isStagingHomeserverDeploy,
} from '@/config/network';
import { readAuthEpoch } from '@/controllers/auth/auth-epoch';
import { capabilitiesMatchFullGrant } from '@/libs/auth/capabilities';
import { GRANT_STORAGE_UNAVAILABLE_MESSAGE } from '@/libs/auth/sign-in-error-copy';
import { AppError } from '@/libs/error/error';
import { AuthErrorCode, DatabaseErrorCode, ServerErrorCode, ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { httpResponseToError } from '@/libs/error/error.http';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { isAppError, isAuthError } from '@/libs/error/error.utils';
import { HttpMethod, HttpStatusCode } from '@/libs/http/http.types';
import { AUTH_IO_TIMEOUT_MS, withIoDeadline } from '@/libs/http/io-deadline';
import { signRootAuthToken } from '@/libs/identity/auth-token';
import { Identity } from '@/libs/identity/identity';
import { Logger } from '@/libs/logger/logger';
import type { Pubky as TPubkyModel } from '@/models/models.types';
import type {
  TGenerateAuthTokenFlowResult,
  TGenerateAuthUrlResult,
  TGrantAuthUrlOptions,
  THomeserverRestoreSessionParams,
  THomeserverSessionResult,
  THomeserverSignUpParams,
  TSignupTokenVerificationStatus,
} from '@/services/homeserver/homeserver.types';
import { useAuthStore } from '@/stores/auth/auth.store';
import { extractStatusCode, grantKeyRemovalFailed, handleError } from './error.utils';
import type {
  TGenerateSignupAuthUrlParams,
  TGetBlobParams,
  THomeserverFetchParams,
  THomeserverGetJsonIfFoundParams,
  THomeserverInboxCredentials,
  THomeserverJsonIfFound,
  THomeserverListAllParams,
  THomeserverListParams,
  THomeserverPublicKeyParams,
  THomeserverRequestParams,
  THomeserverResourceEvent,
  THomeserverUserEvent,
  TOwnedSessionPath,
  TPutBlobParams,
} from './homeserver.types';
import {
  assertOk,
  AUTH_POLL_MAX_RESUMES,
  AUTH_RELAY_RETENTION_MS,
  capabilitiesGrantWrite,
  createCancelableAuthApproval,
  getOwnedResponse,
  getResponseOrNullWhenMissing,
  isHttpUrl,
  isTransientPollError,
  parseResponseOrUndefined,
  PUBKY_PREFIX,
  readResponseBytes,
  resolveOwnedSessionPath,
  toSdkPath,
  waitUntilVisible,
} from './homeserver.utils';
import {
  assertOwnedGrantStorageAvailable,
  forgetOwnedGrant,
  holdOwnedGrant,
  type OwnedGrantFlow,
  type OwnedGrantKey,
  pendingOwnedGrants,
  releaseOwnedGrantLease,
  rememberOwnedGrant,
  removeOwnedDelegatedKey,
  removeOwnedGrantKey,
  retireOwnedGrant,
  saveOwnedGrantFlow,
  withAbandonedOwnedGrant,
} from './owned-grant-storage';
import { retryHomeserverWrite } from './write-retry';

// Every Shop homeserver sign-in uses CAPABILITIES from @/config/app.
const PUB_PATH_PREFIX = '/pub/' as const;
const PRIV_PATH_PREFIX = '/priv/' as const;
/** Paths the current session owns outright: its own public and private trees. */
const OWNED_PATH_PREFIXES = [PUB_PATH_PREFIX, PRIV_PATH_PREFIX] as const;
/** The private subtree cross-device watchlist sync writes to. */
export const PRIVATE_APP_DATA_PATH = '/priv/pubky.app/' as const;
/** Default limit for list operations */
const LIST_DEFAULT_LIMIT = 500;
/** Attempts to hydrate the session right after a direct homeserver signup. */
const SIGNUP_SESSION_RESTORE_ATTEMPTS = 3;
/** Base delay between signup session restore attempts (multiplied by attempt number). */
const SIGNUP_SESSION_RESTORE_DELAY_MS = 1500;

function boundedHomeserverIo<T>(work: () => Promise<T>, operation: string): Promise<T> {
  return withIoDeadline(work, { service: ErrorService.Homeserver, operation, timeoutMs: AUTH_IO_TIMEOUT_MS });
}

type HomeserverSdkUserEvent = THomeserverUserEvent & {
  resource?: { owner: { z32(): string }; path: string };
  free(): void;
};

/** What a grant session exposes for custom proofs from SDK 0.16 on; absent on older SDKs and cookie sessions. */
type GrantSessionWithCustomPop = {
  createCustomPop?: (data: unknown) => Promise<{ grant: string; pop: string }>;
};

export class HomeserverService {
  private constructor() {}

  private static pubkySdk: Pubky | null = null;
  private static pendingGrantKeys = new WeakMap<Session, OwnedGrantKey>();
  private static savedGrantKeys = new Map<string, OwnedGrantKey>();
  private static pendingRecordBySession = new WeakMap<Session, string>();
  private static savedSessions = new Map<string, Session>();

  /**
   * Gets the Pubky SDK singleton.
   */
  private static getPubkySdk(): Pubky {
    if (!this.pubkySdk) {
      if (getTestnet()) {
        this.pubkySdk = Pubky.testnet();
      } else {
        const client = new Client({ pkarr: { relays: getPkarrRelays() } });
        this.pubkySdk = Pubky.withClient(client);
      }
    }
    return this.pubkySdk;
  }

  private static resolveOwnedSessionPath(url: string): TOwnedSessionPath | null {
    const session = useAuthStore.getState().selectSession();
    return resolveOwnedSessionPath({ url, session, ownedPathPrefixes: OWNED_PATH_PREFIXES });
  }

  private static assertWriteSessionCurrent(
    expectedSession: Session,
    expectedEpoch: number,
    url: string,
    method: HttpMethod,
  ): void {
    const authState = useAuthStore.getState();
    if (!authState.isLoggingOut && authState.selectSession() === expectedSession && readAuthEpoch() === expectedEpoch) {
      return;
    }
    throw Err.auth(AuthErrorCode.SESSION_EXPIRED, 'Session ended before the homeserver write completed.', {
      service: ErrorService.Homeserver,
      operation: 'write',
      context: { endpoint: url, method },
    });
  }

  /** Whether an authenticated session object currently exists (restored sessions included). */
  static hasActiveSession(): boolean {
    return useAuthStore.getState().selectSession() !== null;
  }

  /**
   * Whether the CURRENT session's granted capabilities allow writing `path`.
   *
   * Reads `session.info.capabilities` — the homeserver's own statement of what
   * this session may do — so callers can gate features on facts instead of
   * probing for 403s. Legacy Ring sessions approved before the grant widened
   * to include `/priv/pubky.app/:rw` return `false` for private paths until
   * the user re-approves.
   *
   * Returns `false` when no session exists.
   */
  static canCurrentSessionWrite(path: string): boolean {
    const session = useAuthStore.getState().selectSession();
    const capabilities = session?.info?.capabilities;
    if (!capabilities) return false;
    return capabilitiesGrantWrite(capabilities, path);
  }

  /**
   * Whether the current grant covers every Shop storage permission.
   */
  static currentSessionHasFullGrant(): boolean {
    const session = useAuthStore.getState().selectSession();
    const capabilities = session?.info?.capabilities;
    if (!capabilities) return false;
    return this.isGrantSession(session) && capabilitiesMatchFullGrant(capabilities);
  }

  /** Cookie redemption is retired; old callers must request a grant approval. */
  static async signInWithFullGrantAuthToken(_authTokenBytes: Uint8Array): Promise<Session> {
    throw Err.auth(AuthErrorCode.UNAUTHORIZED, 'Sign in again to approve a Shop grant.', {
      service: ErrorService.Homeserver,
      operation: 'signInWithFullGrantAuthToken',
    });
  }

  /**
   * Gets a signer for the homeserver
   * @param keypair - The keypair to get a signer for
   * @returns The signer
   */
  private static getSigner(keypair: Keypair): Signer {
    const pubkySdk = this.getPubkySdk();
    return pubkySdk.signer(keypair);
  }

  /**
   * Resolves the key's homeserver from its PKARR record.
   * @returns The homeserver public key, or `null` when the record is provably absent
   * @throws When the lookup itself failed (relay/network error) — absence NOT proven
   */
  private static async resolveHomeserverRecord({ publicKey }: THomeserverPublicKeyParams) {
    try {
      const pubkySdk = this.getPubkySdk();
      const homeserver = await pubkySdk.getHomeserverOf(publicKey);
      return homeserver ?? null;
    } catch (error) {
      return handleError({
        error,
        additionalContext: { publicKey: publicKey?.z32?.() },
      });
    }
  }

  /**
   * Resolve PKARR homeserver; on staging, require it matches this deploy's homeserver.
   *
   * An absent record is rejected the same way as a mismatched one: absence cannot
   * prove the key belongs here, both outcomes are deterministic (retrying the
   * lookup cannot change them), and fail-open would re-enable the prod-key
   * force-republish this guard exists to prevent (#2126). This also means a key
   * whose just-published record has not yet propagated to our relays is rejected
   * until it propagates. Only a lookup that itself failed (relay/network error)
   * throws a retryable server error instead.
   */
  static async assertUserHomeserverAllowed({ publicKey }: THomeserverPublicKeyParams): Promise<void> {
    if (!isStagingHomeserverDeploy()) {
      return;
    }

    const homeserver = await this.resolveHomeserverRecord({ publicKey });
    const configuredHomeserver = getHomeserver();
    const resolvedHomeserver = homeserver ? homeserver.z32() : null;
    if (resolvedHomeserver !== configuredHomeserver) {
      const context = {
        configuredHomeserver,
        resolvedHomeserver,
        publicKey: publicKey.z32(),
      };
      // An expected user mistake (prod key on a staging deploy), not a system
      // fault — constructed directly rather than via the Err factory so every
      // occurrence does not emit an error log plus a Sentry error event.
      Logger.info(`Rejected sign-in: key is not linked to this ${getDeployEnv()} homeserver`, context);
      throw new AppError({
        category: ErrorCategory.Auth,
        code: AuthErrorCode.WRONG_ENVIRONMENT_HOMESERVER,
        message: `This key is not linked to this ${getDeployEnv()} deploy homeserver.`,
        service: ErrorService.Homeserver,
        operation: 'assertUserHomeserverAllowed',
        context,
      });
    }
  }

  /**
   * Signs up a new user in the homeserver
   * @param keypair - The keypair to sign up with
   * @param signupToken - The signup token to use
   * @returns The session
   */
  static async signUp({ keypair, signupToken }: THomeserverSignUpParams): Promise<THomeserverSessionResult> {
    if (isStagingHomeserverDeploy()) {
      return await this.signUpViaHomeserverUrl({ keypair, signupToken });
    }

    try {
      const homeserverPublicKey = PublicKey.from(getHomeserver());
      const signer = this.getSigner(keypair);
      try {
        await signer.signup(homeserverPublicKey, signupToken);
      } catch (signupError) {
        // A previous attempt may have consumed the invite before grant storage
        // completed. The same recovery key can resume that existing account.
        try {
          return { session: await signer.signin(getShopGrantClientId()) };
        } catch {
          throw signupError;
        }
      }
      const session = await signer.signin(getShopGrantClientId());

      Logger.debug('Signup successful', { publicKey: keypair.publicKey.z32() });

      return { session };
    } catch (error) {
      return handleError({
        error,
        additionalContext: { signupTokenProvided: Boolean(signupToken) },
        statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR,
        alwaysUseHomeserverError: true,
      });
    }
  }

  /** Create the staging account directly, publish PKDNS, then issue a grant. No cookie is accepted. */
  private static async signUpViaHomeserverUrl({
    keypair,
    signupToken,
  }: THomeserverSignUpParams): Promise<THomeserverSessionResult> {
    const url = `${getHomeserverUrl()}/signup?signup_token=${encodeURIComponent(signupToken)}`;
    const errorParams = { service: ErrorService.Homeserver, operation: 'signUpViaHomeserverUrl' };

    let response: Response;
    try {
      response = await this.getPubkySdk().client.fetch(url, {
        method: HttpMethod.POST,
        // The token owns its exact-length buffer; passed as ArrayBuffer because
        // this tsconfig's BodyInit does not accept Uint8Array<ArrayBufferLike>.
        body: signRootAuthToken(keypair.secret()).buffer as ArrayBuffer,
        credentials: 'omit',
      });
    } catch (error) {
      // The homeserver was never reached, so the invite was not consumed — retryable.
      throw Err.server(ServerErrorCode.SERVICE_UNAVAILABLE, 'Could not reach the homeserver to sign up.', {
        ...errorParams,
        cause: error,
      });
    }

    if (!response.ok) {
      const recovered = await this.trySignInExistingAccount(keypair);
      if (recovered) {
        Logger.info('Signup token already consumed but account exists; recovered via sign-in');
        return recovered;
      }
      throw Err.auth(AuthErrorCode.INVALID_TOKEN, 'The homeserver rejected the invite code.', {
        ...errorParams,
        context: { statusCode: response.status },
      });
    }

    await response.arrayBuffer();
    Logger.debug('Direct homeserver signup succeeded', { publicKey: keypair.publicKey.z32() });

    // From here on the invite is spent: only throw RETRYABLE errors (see doc comment).
    try {
      await this.getSigner(keypair).pkdns.publishHomeserverForce(PublicKey.from(getHomeserver()));
    } catch (error) {
      throw Err.server(ServerErrorCode.SERVICE_UNAVAILABLE, 'Signed up, but publishing your key record failed.', {
        ...errorParams,
        cause: error,
      });
    }

    const session = await this.restoreSignupSession(keypair, errorParams);
    return { session };
  }

  /** Retry grant creation while the signup PKDNS record propagates; never restore a cookie. */
  private static async restoreSignupSession(
    keypair: Keypair,
    errorParams: { service: ErrorService; operation: string },
  ): Promise<Session> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= SIGNUP_SESSION_RESTORE_ATTEMPTS; attempt++) {
      try {
        return await this.getSigner(keypair).signin(getShopGrantClientId());
      } catch (error) {
        lastError = error;
        Logger.warn('Signup session restore attempt failed', { attempt, error });
        if (attempt < SIGNUP_SESSION_RESTORE_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, SIGNUP_SESSION_RESTORE_DELAY_MS * attempt));
        }
      }
    }

    // The invite is already spent, so a retried signup would be rejected:
    // recover the session from the account this signup just created.
    const recovered = await this.trySignInExistingAccount(keypair);
    if (recovered) {
      Logger.info('Signup session restore failed; recovered via sign-in');
      return recovered.session;
    }

    throw Err.server(ServerErrorCode.SERVICE_UNAVAILABLE, 'Signed up, but could not establish your session yet.', {
      ...errorParams,
      cause: lastError,
    });
  }

  /**
   * Recovery for a signup POST rejected because the invite was already consumed
   * by a previous attempt that died mid-flight: if this keypair's account exists,
   * publish its record and sign in. Returns `null` when the account does not
   * exist (i.e. the invite was genuinely invalid). Publishing before knowing the
   * account exists is harmless — a fresh onboarding keypair with no account just
   * leaves an inert record pointing here.
   */
  private static async trySignInExistingAccount(keypair: Keypair): Promise<THomeserverSessionResult | null> {
    try {
      const signer = this.getSigner(keypair);
      await signer.pkdns.publishHomeserverForce(PublicKey.from(getHomeserver()));
      const session = await signer.signin(getShopGrantClientId());
      return { session };
    } catch (error) {
      Logger.debug('No existing account to recover during signup', { error });
      return null;
    }
  }

  /**
   * Verifies a signup token (invite code) against the homeserver.
   *
   * Performs a GET to the homeserver's `/signup_tokens/<token>` endpoint. This is a
   * homeserver-root endpoint that cannot be reached via the homeserver pubkey (its PKARR
   * record has no resolvable HTTPS endpoint), so the explicit {@link getHomeserverUrl} is used.
   *
   * A definitive homeserver response distinguishes valid, used, and unknown tokens, whereas
   * a failure to reach the homeserver is surfaced as a thrown error so callers can tell
   * verification outcomes apart from "couldn't verify right now".
   *
   * @param signupToken - The signup token / invite code to verify
   * @returns `'valid'` when the token exists and is unused, `'used'` when already redeemed,
   *   `'invalid'` when the homeserver does not recognise the token (404).
   * @throws When the homeserver could not be reached (network error, timeout, DNS/PKARR failure)
   *   or returns an unexpected status.
   */
  static async verifySignupToken(signupToken: string): Promise<TSignupTokenVerificationStatus> {
    const url = `${getHomeserverUrl()}/signup_tokens/${encodeURIComponent(signupToken)}`;
    try {
      const response = await this.getPubkySdk().client.fetch(url, { method: HttpMethod.GET });
      Logger.debug('Signup token verification response', { status: response.status });

      if (response.status === HttpStatusCode.NOT_FOUND) {
        return 'invalid';
      }

      if (!response.ok) {
        throw new Error(`Signup token verification failed with status ${response.status}`);
      }

      const text = await response.text();
      let data: { status?: string };
      try {
        data = JSON.parse(text) as { status?: string };
      } catch {
        Logger.warn('Signup token verification returned a non-JSON body', { status: response.status });
        return 'invalid';
      }
      if (data.status === 'valid') {
        return 'valid';
      }
      if (data.status === 'used') {
        return 'used';
      }

      Logger.warn('Unexpected signup token verification payload', { status: data.status });
      return 'invalid';
    } catch (error) {
      Logger.warn('Signup token verification could not reach the homeserver');
      throw error;
    }
  }

  /**
   * Signs in a user to the homeserver.
   *
   * If signin fails due to missing homeserver records, this method will attempt to republish
   * the homeserver and return `undefined` to signal the caller should retry the signin.
   *
   * @param keypair - The keypair to sign in with
   * @returns The session result, or `undefined` if homeserver was republished and caller should retry
   */
  static async signIn({ keypair }: TKeypairParams): Promise<THomeserverSessionResult | undefined> {
    const signer = this.getSigner(keypair);

    if (isStagingHomeserverDeploy()) {
      // Fail closed on staging: an inconclusive PKARR lookup must never migrate an
      // unverified key to the configured staging homeserver.
      await this.assertUserHomeserverAllowed({ publicKey: keypair.publicKey });
    } else {
      // Lookup-failure hardening: self-heal (republish) only a PROVABLY ABSENT
      // record (e.g. expired from the DHT). A failed lookup throws instead —
      // republishing on a transient error could overwrite an existing record
      // that points at another homeserver. NOTE: the signin-failure branch
      // below still republishes a PRESENT record (long-standing stale-record
      // migration self-heal); narrowing that is a separate product decision.
      const homeserverRecord = await this.resolveHomeserverRecord({ publicKey: keypair.publicKey });
      if (homeserverRecord === null) {
        return await this.republishConfiguredHomeserver({
          signer,
          keypair,
          originalError: 'homeserver record absent from PKARR',
        });
      }
    }

    try {
      const session = await signer.signin(getShopGrantClientId());
      return { session };
    } catch (signinError) {
      return await this.republishConfiguredHomeserver({ signer, keypair, originalError: signinError });
    }
  }

  private static async republishConfiguredHomeserver({
    signer,
    keypair,
    originalError,
  }: {
    signer: Signer;
    keypair: Keypair;
    originalError: unknown;
  }): Promise<undefined> {
    try {
      const homeserverPublicKey = PublicKey.from(getHomeserver());
      await signer.pkdns.publishHomeserverForce(homeserverPublicKey);
      Logger.debug('Republish homeserver successful', { pubky: Identity.pubkyFromKeypair(keypair) });
      return undefined;
    } catch (republishError) {
      return handleError({
        error: republishError,
        additionalContext: { pubky: Identity.pubkyFromKeypair(keypair), originalSigninError: String(originalError) },
        statusCode: HttpStatusCode.UNAUTHORIZED,
      });
    }
  }

  /**
   * Generates an authentication URL for the homeserver
   * @param caps - The capabilities to use
   * @returns The authentication URL and approval promise
   */
  static async generateAuthUrl(caps?: Capabilities): Promise<TGenerateAuthUrlResult> {
    if (caps && caps !== CAPABILITIES) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'Shop sign-in requires the Shop grant permissions.', {
        service: ErrorService.Homeserver,
        operation: 'generateAuthUrl',
      });
    }
    return this.generateGrantAuthUrl();
  }

  /**
   * Starts an authentication-only Pubky auth flow whose approval yields an `AuthToken` —
   * a signed, time-bound proof of key ownership — instead of a homeserver session.
   *
   * Used to authenticate the user to external Pubky-verified services (e.g. the
   * Marketplace Transaction Service, which verifies the token bytes with `pubky-common`).
   * The capability set is empty on purpose: the token proves identity only and grants
   * no homeserver access.
   *
   * @returns The authorization URL to show the signer, a lazy `awaitToken`, and a cancel
   */
  /**
   * @param capabilities Optional capability string shown verbatim on the
   * signer. Empty (the default) requests a plain sign-in token; a scoped
   * string (e.g. the Paykit claim scope) yields a token carrying exactly
   * those capabilities, which some verifiers require and check exactly.
   */
  static generateAuthTokenFlow(capabilities: Capabilities = ''): TGenerateAuthTokenFlowResult {
    try {
      const pubkySdk = this.getPubkySdk();
      const flow = pubkySdk.startCookieAuthFlow(capabilities, AuthFlowKind.signin(), getDefaultHttpRelay());
      const authorizationUrl = flow.authorizationUrl;
      let live = flow;
      let freed = false;
      const waiting = new AbortController();
      const startedAt = Date.now();
      const free = () => {
        if (freed) return;
        freed = true;
        waiting.abort();
        try {
          live.free();
        } catch {
          // Ignore double-free or already-finalized WASM objects.
        }
      };
      const awaitToken = async () => {
        try {
          for (let resumes = 0; ; ) {
            try {
              return await live.awaitToken();
            } catch (error) {
              // The SDK gives up on a flow once the page's network drops in the background (the user is
              // approving in Pubky Ring), and it never polls that flow again. Reconnect to the same relay
              // channel when the page is visible again: an approval made meanwhile is still there.
              if (freed || !isTransientPollError(error) || ++resumes > AUTH_POLL_MAX_RESUMES) throw error;
              await waitUntilVisible(waiting.signal);
              // Past the relay's retention the approval is gone: end the flow instead of waiting on an empty channel.
              if (freed || Date.now() - startedAt > AUTH_RELAY_RETENTION_MS) throw error;
              live = pubkySdk.resumeCookieAuthFlow(authorizationUrl);
            }
          }
        } finally {
          free();
        }
      };
      return { authorizationUrl, awaitToken, cancelAuthFlow: free };
    } catch (error) {
      return handleError({ error, additionalContext: { relay: getDefaultHttpRelay() } });
    }
  }

  /**
   * Whether this browser can persist a grant sign-in (secure context, WebCrypto, IndexedDB and
   * Web Locks). Without it the Shop cannot safely complete an external signer flow. WebCrypto
   * Ed25519 is not required: {@link startGrantAuthFlow} falls back to an SDK-held key.
   */
  static isGrantSignInAvailable(): boolean {
    try {
      return GrantAuthFlow.isDelegationAvailable && typeof globalThis.navigator?.locks?.request === 'function';
    } catch {
      return false;
    }
  }

  /**
   * Starts a grant sign-in (`pubkyauth://signin_grant`) for Ring, Bitkit or Passport. The
   * proof-of-possession key is a non-extractable WebCrypto key in IndexedDB.
   * Browsers without WebCrypto Ed25519 (e.g. Chrome < 137) get an SDK-held key
   * instead, which `browserSessionStore` saves in IndexedDB as bearer-equivalent
   * material.
   *
   * @param xCallback Optional return destinations carried in the URL (Pubky
   * Passport's callback page). They are navigation hints only: the session
   * still arrives through the encrypted relay.
   * @param options.withPrivKeys Whether to also ask for the `e` action on the
   * Shop's private tree (a signed approval that can carry scoped encryption
   * keys). Defaults to {@link isPrivKeysRequested} for `options.signer`;
   * `false` is the separate sign-in without keys that signers or homeservers
   * without `e` need.
   */
  static async generateGrantAuthUrl(
    xCallback?: XCallbackParams,
    options: TGrantAuthUrlOptions = {},
  ): Promise<TGenerateAuthUrlResult> {
    return await this.startGrantAuthFlow(
      () => AuthFlowKind.signin(),
      'generateGrantAuthUrl',
      xCallback,
      options.withPrivKeys ?? isPrivKeysRequested(options.signer),
    );
  }

  private static async startGrantAuthFlow(
    kind: () => AuthFlowKind,
    operation: string,
    xCallback: XCallbackParams | undefined,
    withPrivKeys: boolean,
  ): Promise<TGenerateAuthUrlResult> {
    try {
      if (!this.isGrantSignInAvailable() || !(await this.getPubkySdk().browserSessionStore.isAvailable())) {
        throw Err.database(DatabaseErrorCode.INIT_FAILED, GRANT_STORAGE_UNAVAILABLE_MESSAGE, {
          service: ErrorService.Homeserver,
          operation,
        });
      }
      assertOwnedGrantStorageAvailable();
      const pubkySdk = this.getPubkySdk();
      // Keeps a non-extractable WebCrypto key where WebCrypto has Ed25519; elsewhere
      // (e.g. Chrome < 137) the SDK falls back to its own key.
      const flow = await pubkySdk.startGrantAuthFlow(withPrivKeys ? KEYED_CAPABILITIES : CAPABILITIES, kind(), {
        clientId: getShopGrantClientId(),
        approvalFormat: withPrivKeys ? 'signedApprovalV1' : 'bareGrant',
        relay: getDefaultHttpRelay(),
        ...(xCallback ? { xCallback } : {}),
      });
      let owned: OwnedGrantFlow;
      try {
        owned = saveOwnedGrantFlow(flow);
      } catch (error) {
        flow.free();
        throw error;
      }
      const key: OwnedGrantKey =
        owned.storage === 'delegated' ? { storage: 'delegated', keyId: owned.keyId } : { storage: 'localSecret' };
      // Only a delegated key outlives the tab on its own; a localSecret key is
      // persisted solely through its session record, tracked by saveGrantSession.
      if (key.storage === 'delegated') {
        try {
          await holdOwnedGrant('key', key.keyId);
          rememberOwnedGrant('key', key.keyId, Date.now() + AUTH_RELAY_RETENTION_MS);
        } catch (error) {
          flow.free();
          await removeOwnedGrantKey(key).catch(() => {});
          releaseOwnedGrantLease('key', key.keyId);
          throw error;
        }
      }
      let approved = false;
      const cleanupKey = async () => {
        if (key.storage !== 'delegated') return;
        retireOwnedGrant('key', key.keyId);
        await removeOwnedGrantKey(key);
        forgetOwnedGrant('key', key.keyId);
      };
      const approval = createCancelableAuthApproval(flow, {
        resume: () =>
          owned.storage === 'delegated'
            ? GrantAuthFlow.resumeDelegated(owned.saved)
            : pubkySdk.resumeGrantAuthFlow(owned.saved),
        onCanceledSession: async (session) => {
          await session.signout().catch(() => {});
          await cleanupKey();
        },
      });
      const awaitApproval = approval.awaitApproval.then((session) => {
        approved = true;
        this.pendingGrantKeys.set(session, key);
        return session;
      });
      // The controller attaches after the URL is returned; early cancellation is handled here too.
      awaitApproval.catch(() => {});
      return {
        authorizationUrl: flow.authorizationUrl,
        awaitApproval,
        cancelAuthFlow: () => {
          approval.cancel();
          if (!approved)
            void cleanupKey().catch((error) => {
              Logger.warn('Shop pending grant key cleanup will be retried', { error });
            });
        },
      };
    } catch (error) {
      return handleError({ error, additionalContext: { operation } });
    }
  }

  /**
   * The scoped encryption keys a grant session was approved with, or null for
   * a cookie session, a bare grant, and an approval whose signer declined
   * `e`. The caller owns the copy and must `free()` it. They exist only for a
   * session approved through a signed approval (see {@link generateGrantAuthUrl}).
   */
  static getSessionEncryptionKeys(session: Session | null | undefined): EncryptionKeys | null {
    const grant = session?.grant;
    if (!grant) return null;
    try {
      const keys = grant.encryptionKeys;
      if (!keys) return null;
      if (keys.scopes.length === 0) {
        keys.free();
        return null;
      }
      return keys;
    } finally {
      grant.free();
    }
  }

  /**
   * {@link getSessionEncryptionKeys} for the signed-in session, and only when
   * that session belongs to `ownerPubky`. The caller must `free()` the copy.
   */
  static getCurrentSessionEncryptionKeys(ownerPubky: string): EncryptionKeys | null {
    const session = useAuthStore.getState().selectSession();
    if (!session || session.info.publicKey.z32() !== ownerPubky) return null;
    return this.getSessionEncryptionKeys(session);
  }

  /** Whether a session carries a homeserver grant. */
  static isGrantSession(session: Session | null | undefined): boolean {
    return Boolean(session && session.grant !== undefined);
  }

  static isCurrentSessionGrant(): boolean {
    return this.isGrantSession(useAuthStore.getState().selectSession());
  }

  /** Persists a completed grant session in IndexedDB and returns its record id. */
  static async saveGrantSession(session: Session): Promise<string> {
    if (!session.grant)
      throw Err.auth(AuthErrorCode.UNAUTHORIZED, 'A Shop grant is required.', {
        service: ErrorService.Homeserver,
        operation: 'saveGrantSession',
      });
    const info = await session.grant.sessionInfo();
    if (info.clientId !== getShopGrantClientId())
      throw Err.auth(AuthErrorCode.UNAUTHORIZED, 'This grant belongs to another app.', {
        service: ErrorService.Homeserver,
        operation: 'saveGrantSession',
      });
    const id = `${info.publicKey.z32()}:${info.grantId}`;
    await holdOwnedGrant('record', id);
    this.pendingRecordBySession.set(session, id);
    try {
      rememberOwnedGrant('record', id, Date.now() + AUTH_RELAY_RETENTION_MS);
      const stored = await this.getPubkySdk().browserSessionStore.save(session);
      if (stored.id !== id)
        throw Err.database(DatabaseErrorCode.WRITE_FAILED, 'Unexpected grant record identity.', {
          service: ErrorService.Homeserver,
          operation: 'saveGrantSession',
        });
      this.savedSessions.set(id, session);
      const key = this.pendingGrantKeys.get(session);
      if (key) this.savedGrantKeys.set(id, key);
      return stored.id;
    } catch (error) {
      retireOwnedGrant('record', id);
      return handleError({ error, additionalContext: { operation: 'saveGrantSession' } });
    }
  }

  /** Acknowledge only after the controller has committed its restorable pointer. */
  static commitGrantSession(recordId: string): void {
    const key = this.savedGrantKeys.get(recordId);
    if (key) {
      if (key.storage === 'delegated') forgetOwnedGrant('key', key.keyId);
      this.savedGrantKeys.delete(recordId);
    }
    forgetOwnedGrant('record', recordId);
    const session = this.savedSessions.get(recordId);
    if (session) {
      this.pendingRecordBySession.delete(session);
      this.pendingGrantKeys.delete(session);
      this.savedSessions.delete(recordId);
    }
  }

  /** Durable intent recorded before a replacement overwrites the old Shop pointer. */
  static queueGrantRetirement(recordId: string): void {
    rememberOwnedGrant('retirement', recordId);
  }

  /** Revoke a superseded Shop grant while its proof key still exists, then remove it. */
  private static async retireGrantSession(recordId: string): Promise<void> {
    let session: Session;
    try {
      session = await this.restoreGrantSession(recordId);
    } catch (error) {
      // A missing/revoked grant cannot be signed out. Storage/network failures
      // are inconclusive and must retain both its key and retry obligation.
      if (!(isAppError(error) && isAuthError(error))) throw error;
      await this.removeGrantSession(recordId);
      forgetOwnedGrant('retirement', recordId);
      forgetOwnedGrant('record', recordId);
      return;
    }
    const grant = session.grant;
    const info = grant ? await boundedHomeserverIo(() => grant.sessionInfo(), 'retireGrantSession') : undefined;
    if (!info || info.clientId !== getShopGrantClientId() || `${info.publicKey.z32()}:${info.grantId}` !== recordId) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'Only an owned Shop grant may be retired.', {
        service: ErrorService.Homeserver,
        operation: 'retireGrantSession',
      });
    }
    // Unlike an explicit user logout, automatic retirement keeps its key if
    // remote revocation cannot be confirmed, so a later retry can finish it.
    await boundedHomeserverIo(() => session.signout(), 'signout');
    await this.removeGrantSession(recordId);
    forgetOwnedGrant('retirement', recordId);
    forgetOwnedGrant('record', recordId);
  }

  /** Restores a grant session saved by {@link saveGrantSession}. Never saves. */
  static async restoreGrantSession(recordId: string): Promise<Session> {
    try {
      return await boundedHomeserverIo(
        () => this.getPubkySdk().browserSessionStore.restore(recordId),
        'restoreGrantSession',
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'ClientStateError' &&
        (error.message === `Stored Pubky session not found: ${recordId}` ||
          error.message === 'Unsupported stored session version.' ||
          error.message === 'Browser session is no longer valid.' ||
          error.message === 'Browser session was signed out.' ||
          /^Delegated grant key not found: .+$/.test(error.message))
      ) {
        throw Err.auth(AuthErrorCode.SESSION_EXPIRED, 'This grant needs a new approval.', {
          service: ErrorService.Homeserver,
          operation: 'restoreGrantSession',
          context: { reason: 'missing-local-grant' },
        });
      }
      return handleError({ error, additionalContext: { operation: 'restoreGrantSession' } });
    }
  }

  /**
   * Drops one stored grant session record and its delegated key, then reads
   * the store back. Rejects while the record is still listed, so a caller
   * never drops its pointer to key material that is still on disk.
   */
  static async removeGrantSession(recordId: string): Promise<void> {
    const store = this.getPubkySdk().browserSessionStore;
    let removeError: unknown;
    try {
      if (!(await boundedHomeserverIo(() => store.isAvailable(), 'removeGrantSession')))
        throw grantKeyRemovalFailed('removeGrantSession', undefined);
      await boundedHomeserverIo(() => store.remove(recordId), 'removeGrantSession');
    } catch (error) {
      removeError = error;
    }
    let remaining: string[];
    try {
      // remove() may silently no-op and list() may return [] when IndexedDB
      // is unavailable. Keep the reference unless availability is confirmed.
      if (!(await boundedHomeserverIo(() => store.isAvailable(), 'removeGrantSession'))) throw removeError;
      remaining = (await boundedHomeserverIo(() => store.list(), 'removeGrantSession')).map((record) => record.id);
      if (!(await boundedHomeserverIo(() => store.isAvailable(), 'removeGrantSession')))
        throw grantKeyRemovalFailed('removeGrantSession', undefined);
    } catch (error) {
      throw grantKeyRemovalFailed('removeGrantSession', error);
    }
    if (remaining.includes(recordId)) throw grantKeyRemovalFailed('removeGrantSession', removeError);
    if (removeError) Logger.warn('Grant session remove reported an error, but the record is gone', { removeError });
  }

  /** Remove explicit Shop-owned records and retired Shop flow keys; never clear the origin. */
  static async clearGrantSessions({
    recordIds = [],
    protectedRecordIds = [],
  }: { requireAvailable?: boolean; recordIds?: string[]; protectedRecordIds?: string[] } = {}): Promise<void> {
    // Each obligation is independent: a temporary failure must not starve
    // unrelated cleanup, nor erase the failed obligation or its proof key.
    let failure: unknown;
    const attempt = async (clean: () => Promise<void>) => {
      try {
        await clean();
      } catch (error) {
        failure ??= error;
      }
    };
    for (const id of new Set(recordIds)) {
      if (protectedRecordIds.includes(id)) continue;
      await attempt(async () => {
        rememberOwnedGrant('record', id);
        await this.removeGrantSession(id);
        forgetOwnedGrant('record', id);
        forgetOwnedGrant('retirement', id);
      });
    }
    const pending = pendingOwnedGrants();
    const retiring = new Set(pending.filter((entry) => entry.kind === 'retirement').map((entry) => entry.id));
    for (const entry of pending) {
      if (entry.kind === 'record' && retiring.has(entry.id)) continue;
      if (entry.kind !== 'key' && protectedRecordIds.includes(entry.id)) continue;
      await attempt(() =>
        withAbandonedOwnedGrant(entry, async () => {
          if (entry.kind === 'retirement') await this.retireGrantSession(entry.id);
          else if (entry.kind === 'record') {
            await this.removeGrantSession(entry.id);
            forgetOwnedGrant('record', entry.id);
          } else {
            await removeOwnedDelegatedKey(entry.id);
            forgetOwnedGrant('key', entry.id);
          }
        }),
      );
    }
    if (failure) throw failure;
  }

  /**
   * Generates the SDK signup grant URL for the configured homeserver.
   * @param inviteCode InviteCode to the homeserver
   * @param caps - The capabilities to use
   * @returns The authentication URL and approval promise
   */
  static async generateSignupAuthUrl({
    inviteCode,
    caps: _caps,
  }: TGenerateSignupAuthUrlParams): Promise<TGenerateAuthUrlResult> {
    return this.startGrantAuthFlow(
      () => AuthFlowKind.signup(PublicKey.from(getHomeserver()), inviteCode),
      'generateSignupAuthUrl',
      undefined,
      false,
    );
  }

  /**
   * Logs out a user from the homeserver
   * @param session - The authenticated Session to sign out
   * @returns Void
   */
  static async logout({ session }: THomeserverSessionResult) {
    try {
      await boundedHomeserverIo(() => session.signout(), 'signout');
    } catch (error) {
      return handleError({ error, additionalContext: { url: 'signout' } });
    } finally {
      const recordId = this.pendingRecordBySession.get(session);
      if (recordId) {
        retireOwnedGrant('record', recordId);
        await this.removeGrantSession(recordId);
        forgetOwnedGrant('record', recordId);
        this.pendingRecordBySession.delete(session);
        this.savedGrantKeys.delete(recordId);
        this.savedSessions.delete(recordId);
      }
      const key = this.pendingGrantKeys.get(session);
      if (key) {
        if (key.storage === 'delegated') retireOwnedGrant('key', key.keyId);
        await removeOwnedGrantKey(key);
        if (key.storage === 'delegated') forgetOwnedGrant('key', key.keyId);
        this.pendingGrantKeys.delete(session);
      }
    }
  }

  private static async fetch({ url, options, logUrl }: THomeserverFetchParams): Promise<Response> {
    try {
      const pubkySdk = this.getPubkySdk();
      const httpBridge = pubkySdk.client;
      // Resolve pubky identifiers to transport URLs before fetching
      const resolvedUrl = url.startsWith(PUBKY_PREFIX) ? resolvePubky(url) : url;
      const response = await httpBridge.fetch(resolvedUrl, {
        method: options?.method,
        body: options?.body as BodyInit | undefined,
        credentials: 'omit',
      });

      // A redacted request logs its status only: the response carries the URL.
      Logger.debug('Response from homeserver', logUrl === undefined ? { response } : { status: response.status });

      return response;
    } catch (error) {
      return handleError({ error, additionalContext: { url: logUrl ?? url, method: options?.method } });
    }
  }

  /**
   * Performs a request against the homeserver.
   *
   * Sends a JSON payload when provided and throws if the response is not OK.
   * Note: Under the hood this uses `fetch` with `credentials: 'omit'`.
   *
   * @param {HttpMethod} method - HTTP method to use (e.g. PUT, POST, DELETE).
   * @param {string} url - Pubky URL.
   * @param {Record<string, unknown>} [bodyJson] - JSON body to serialize and send.
   */
  static async request<T>({ method, url, bodyJson, logUrl, singleAttempt }: THomeserverRequestParams): Promise<T> {
    const contextUrl = logUrl ?? url;
    const owned = this.resolveOwnedSessionPath(url);
    const attempts = singleAttempt ? { maxRetries: 0 } : {};
    // Snapshot once so every retry replays byte-for-byte equivalent JSON even
    // if a caller mutates its object while this bounded operation is waiting.
    const serializedBody = bodyJson === undefined ? undefined : JSON.stringify(bodyJson);
    const ownedBody = serializedBody === undefined ? {} : (JSON.parse(serializedBody) as Record<string, unknown>);

    // Handle owned session paths
    if (owned) {
      const { session, path } = owned;
      const authEpoch = readAuthEpoch();
      const beforeAttempt = () => this.assertWriteSessionCurrent(session, authEpoch, contextUrl, method);

      switch (method) {
        case HttpMethod.GET: {
          return await boundedHomeserverIo(async () => {
            const response = await getOwnedResponse({ session, path, url: contextUrl });
            return (await parseResponseOrUndefined<T>({ response })) as T;
          }, 'request');
        }
        case HttpMethod.PUT:
          await retryHomeserverWrite(
            HttpMethod.PUT,
            () => boundedHomeserverIo(() => session.storage.putJson(toSdkPath(path), ownedBody), 'request'),
            {
              beforeAttempt,
              ...attempts,
            },
          ).catch((error) => handleError({ error, additionalContext: { url: contextUrl, method } }));
          return undefined as T;
        case HttpMethod.DELETE:
          await retryHomeserverWrite(
            HttpMethod.DELETE,
            () => boundedHomeserverIo(() => session.storage.delete(toSdkPath(path)), 'request'),
            {
              beforeAttempt,
              ...attempts,
            },
          ).catch((error) => handleError({ error, additionalContext: { url: contextUrl, method } }));
          return undefined as T;
      }
    }

    // Non-owned: only GET allowed on non-HTTP URLs
    if (method !== HttpMethod.GET && !isHttpUrl(url)) {
      throw Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        `Authenticated writes must target an owned ${PUB_PATH_PREFIX}* or ${PRIV_PATH_PREFIX}* path for the current session.`,
        {
          service: ErrorService.Homeserver,
          operation: 'request',
          context: { url: contextUrl, method, statusCode: HttpStatusCode.BAD_REQUEST },
        },
      );
    }

    // Handle public requests
    const pubkySdk = this.getPubkySdk();
    const fetchRequest = () =>
      boundedHomeserverIo(
        () =>
          method === HttpMethod.GET
            ? isHttpUrl(url)
              ? pubkySdk.client.fetch(url)
              : pubkySdk.publicStorage.get(url as Address)
            : this.fetch({ url, logUrl, options: { method, body: serializedBody } }),
        'request',
      );

    const response =
      method === HttpMethod.PUT || method === HttpMethod.DELETE
        ? await retryHomeserverWrite(method, fetchRequest, attempts).catch((error) =>
            handleError({ error, additionalContext: { url: contextUrl, method } }),
          )
        : await fetchRequest().catch((error) => handleError({ error, additionalContext: { url: contextUrl, method } }));

    await assertOk({ response, url: contextUrl, operation: 'request' });

    return method === HttpMethod.GET
      ? ((await boundedHomeserverIo(() => parseResponseOrUndefined<T>({ response }), 'requestBody')) as T)
      : (undefined as T);
  }

  /**
   * A GET of a record that may not exist yet, read like {@link request}: a
   * 404 resolves `{ found: false }` and is neither logged nor reported as an
   * error. Every other failure throws as it does there.
   */
  static async getJsonIfFound<T>({
    url,
    logUrl,
    tolerateUnreachable = false,
    maxBytes,
  }: THomeserverGetJsonIfFoundParams): Promise<THomeserverJsonIfFound<T>> {
    const contextUrl = logUrl ?? url;
    const owned = this.resolveOwnedSessionPath(url);
    const load = owned
      ? () => owned.session.storage.get(toSdkPath(owned.path))
      : () => {
          const pubkySdk = this.getPubkySdk();
          return isHttpUrl(url) ? pubkySdk.client.fetch(url) : pubkySdk.publicStorage.get(url as Address);
        };
    let response: Response | null;
    if (tolerateUnreachable) {
      try {
        response = await getResponseOrNullWhenMissing(load, contextUrl, 'getJsonIfFound');
      } catch (error) {
        Logger.warn('Homeserver record unreachable; treating it as absent for now', { url: contextUrl, error });
        return { found: false, unreachable: true };
      }
    } else {
      response = await getResponseOrNullWhenMissing(load, contextUrl, 'getJsonIfFound');
    }
    if (response === null) return { found: false };
    if (maxBytes === undefined) return { found: true, json: await parseResponseOrUndefined<T>({ response }) };
    // Another user's file: refuse anything over the cap before reading it, so a
    // peer cannot make this browser download and parse an arbitrarily large body.
    const declared = Number(response.headers.get('content-length') ?? Number.NaN);
    if (Number.isFinite(declared) && declared > maxBytes) {
      Logger.warn('Homeserver record larger than the cap; skipped', { url: contextUrl, declared, maxBytes });
      return { found: false, tooLarge: true };
    }
    const bytes = await readResponseBytes(response, maxBytes, contextUrl);
    return { found: true, json: JSON.parse(new TextDecoder().decode(bytes)) as T };
  }

  /**
   * Uploads binary data to the homeserver using PUT.
   *
   * Intended for blob contents (e.g., avatars). Throws if the response is not OK.
   * Note: Uses `fetch` with `credentials: 'omit'`.
   *
   * @param {string} url - Pubky URL.
   * @param {Uint8Array} blob - Raw bytes of the blob to upload.
   */
  static async putBlob({ url, blob, logUrl }: TPutBlobParams) {
    const contextUrl = logUrl ?? url;
    // Uint8Array is mutable; retries must replay the exact original payload.
    const retryBody = blob.slice();
    const owned = this.resolveOwnedSessionPath(url);
    if (owned) {
      const authEpoch = readAuthEpoch();
      try {
        await retryHomeserverWrite(
          HttpMethod.PUT,
          () => owned.session.storage.putBytes(toSdkPath(owned.path), retryBody.slice()),
          {
            beforeAttempt: () => this.assertWriteSessionCurrent(owned.session, authEpoch, contextUrl, HttpMethod.PUT),
          },
        );
        return;
      } catch (error) {
        return handleError({ error, additionalContext: { url: contextUrl, method: HttpMethod.PUT } });
      }
    }

    if (!isHttpUrl(url)) {
      throw Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        `Blob uploads must target an owned ${PUB_PATH_PREFIX}* path for the current session.`,
        {
          service: ErrorService.Homeserver,
          operation: 'putBlob',
          context: { url: contextUrl, statusCode: HttpStatusCode.BAD_REQUEST },
        },
      );
    }

    const response = await retryHomeserverWrite(HttpMethod.PUT, () =>
      this.fetch({ url, logUrl, options: { method: HttpMethod.PUT, body: retryBody.slice() } }),
    );
    await assertOk({ response, url: contextUrl, operation: 'putBlob' });
  }

  /**
   * Reads binary data from the homeserver: an owned path through the
   * session, any other `pubky://` path as a public read. Throws if the
   * response is not OK; error context carries `logUrl` when given.
   */
  static async getBlob({ url, logUrl, maxBytes }: TGetBlobParams): Promise<Uint8Array<ArrayBuffer>> {
    const contextUrl = logUrl ?? url;
    const owned = this.resolveOwnedSessionPath(url);
    if (owned) {
      const response = await getOwnedResponse({ session: owned.session, path: owned.path, url: contextUrl });
      return await readResponseBytes(response, maxBytes, contextUrl);
    }
    const pubkySdk = this.getPubkySdk();
    const response = await (
      isHttpUrl(url) ? pubkySdk.client.fetch(url) : pubkySdk.publicStorage.get(url as Address)
    ).catch((error) => handleError({ error, additionalContext: { url: contextUrl, method: HttpMethod.GET } }));
    await assertOk({ response, url: contextUrl, operation: 'getBlob' });
    return await readResponseBytes(response, maxBytes, contextUrl);
  }

  /**
   * Lists files in a directory from the homeserver.
   *
   * Supports pagination with cursor and optional filtering.
   *
   * @param {string} baseDirectory - Base directory path to list files from.
   * @param {string} [cursor] - Optional cursor for pagination.
   * @param {boolean} [reverse=false] - Whether to list in reverse order.
   * @param {number} [limit=500] - Maximum number of files to return.
   * @returns {Promise<string[]>} Array of file URLs.
   */
  static async list({
    baseDirectory,
    cursor,
    reverse = false,
    limit = LIST_DEFAULT_LIMIT,
    logUrl,
  }: THomeserverListParams): Promise<string[]> {
    const pubkySdk = this.getPubkySdk();
    const contextUrl = logUrl ?? baseDirectory;
    try {
      const owned = this.resolveOwnedSessionPath(baseDirectory);
      if (owned) {
        const dirPath = owned.path.endsWith('/') ? owned.path : (`${owned.path}/` as TOwnedSessionPath['path']);
        const files = await boundedHomeserverIo(
          () => owned.session.storage.list(toSdkPath(dirPath), cursor ?? null, reverse, limit, false),
          'list',
        );
        Logger.debug('List successful', { baseDirectory: contextUrl, filesCount: files.length });
        return files;
      }

      const files = await boundedHomeserverIo(
        () => pubkySdk.publicStorage.list(baseDirectory as Address, cursor ?? null, reverse, limit, false),
        'list',
      );
      Logger.debug('List successful', { baseDirectory: contextUrl, filesCount: files.length });
      return files;
    } catch (error) {
      // 404 here is not an error: missing directory means empty list. Bypass handleError to avoid Sentry capture.
      if (extractStatusCode(error) === HttpStatusCode.NOT_FOUND) {
        Logger.debug('[homeserver:list]', { outcome: 'fallback', reason: 'not_found', baseDirectory: contextUrl });
        return [];
      }
      return handleError({ error, additionalContext: { url: contextUrl, baseDirectory: contextUrl } });
    }
  }

  /**
   * Lists ALL files under a base directory by paginating with a cursor until exhausted.
   *
   * A single `list` call is page-limited and must use a finite limit: non-finite values
   * (e.g. Infinity) coerce to 0 at the SDK's WASM boundary and silently return an empty
   * page. Paginating with the SDK cursor ("start after this URL") is the only reliable
   * way to enumerate an entire directory.
   *
   * @param {string} baseDirectory - Base directory path to list all files from.
   * @returns {Promise<string[]>} Array of every file URL under the directory.
   */
  static async listAll({ baseDirectory }: THomeserverListAllParams): Promise<string[]> {
    const files: string[] = [];
    let cursor: string | undefined;

    for (;;) {
      const batch = await this.list({ baseDirectory, cursor, limit: LIST_DEFAULT_LIMIT });
      files.push(...batch);

      if (batch.length < LIST_DEFAULT_LIMIT) {
        return files;
      }

      cursor = batch[batch.length - 1];
    }
  }

  /**
   * Deletes a file from the homeserver.
   *
   * @param {string} url - Pubky URL of the file to delete.
   */
  static async delete(url: string) {
    await this.request({ method: HttpMethod.DELETE, url });
    Logger.debug('Delete successful', { url });
  }

  /**
   * Fetches a resource from the homeserver.
   *
   * @param {string} url - Pubky URL to fetch.
   * @returns {Promise<Response>} The fetch response.
   */
  static async get(url: string): Promise<Response> {
    const pubkySdk = this.getPubkySdk();
    try {
      if (isHttpUrl(url)) {
        return await pubkySdk.client.fetch(url);
      }

      const owned = this.resolveOwnedSessionPath(url);
      if (owned) {
        return await getOwnedResponse({ session: owned.session, path: owned.path, url });
      }

      return await pubkySdk.publicStorage.get(url as Address);
    } catch (error) {
      return handleError({ error, additionalContext: { url, method: HttpMethod.GET } });
    }
  }

  /**
   * Checks whether a homeserver resource exists without treating an expected 404 as an error.
   * Storage SDK probes return a boolean; plain HTTP URLs retain explicit response handling.
   */
  static async exists(url: string): Promise<boolean> {
    const pubkySdk = this.getPubkySdk();

    try {
      if (isHttpUrl(url)) {
        const response = await pubkySdk.client.fetch(url);
        if (response.status === HttpStatusCode.NOT_FOUND) return false;
        await assertOk({ response, url, operation: 'exists' });
        return true;
      }

      const owned = this.resolveOwnedSessionPath(url);
      return owned
        ? await owned.session.storage.exists(toSdkPath(owned.path))
        : await pubkySdk.publicStorage.exists(url as Address);
    } catch (error) {
      return handleError({
        error,
        additionalContext: { url, method: HttpMethod.GET, operation: 'exists' },
      });
    }
  }

  /**
   * Restore an authenticated Session from a previous `session.export()` snapshot.
   */
  static async restoreSession(_params: THomeserverRestoreSessionParams): Promise<Session> {
    throw Err.auth(AuthErrorCode.UNAUTHORIZED, 'This older sign-in needs a new grant approval.', {
      service: ErrorService.Homeserver,
      operation: 'restoreSession',
    });
  }

  /**
   * Generates a signup token for dev/test environments.
   * Calls the server-side API route to keep admin credentials secure.
   *
   * @security Admin credentials are never exposed to the client.
   * The actual token generation happens server-side via /api/dev/signup-token.
   */
  static async generateSignupToken() {
    // Allow in development or when Cypress is running (for E2E tests in production builds)
    const isCypressRunning = typeof window !== 'undefined' && 'Cypress' in window;
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction && !isCypressRunning) {
      throw Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        'generateSignupToken is only available in non-production environments.',
        {
          service: ErrorService.Homeserver,
          operation: 'generateSignupToken',
          context: { isProduction, isCypressRunning },
        },
      );
    }

    // Call server-side API route to generate token (keeps admin credentials secure)
    const tokenUrl = withBasePath('/api/dev/signup-token');
    const response = await fetch(tokenUrl, {
      method: 'GET',
    });

    if (!response.ok) {
      throw httpResponseToError(response, ErrorService.Homeserver, 'generateSignupToken', tokenUrl);
    }

    const data = await response.json();
    if (!data.token) {
      throw Err.server(ServerErrorCode.UNKNOWN_ERROR, 'No token received from server', {
        service: ErrorService.Homeserver,
        operation: 'generateSignupToken',
      });
    }

    return data.token;
  }

  /**
   * Subscribe to homeserver `/events-stream` for a user's pub directory subtree (SDK SSE wrapper).
   * Used for mute-list sync; callers own {@link ReadableStreamDefaultReader} lifecycle.
   */
  static async subscribeUserEventStreamForPath(params: {
    userZ32: TPubkyModel;
    cursor: string | null;
    pathPrefix: string;
  }): Promise<ReadableStream<THomeserverUserEvent>> {
    try {
      const pubkySdk = this.getPubkySdk();
      const pk = PublicKey.from(params.userZ32);
      const stream = (await pubkySdk
        .eventStreamForUser(pk, params.cursor)
        .path(params.pathPrefix)
        .live()
        .subscribe()) as ReadableStream<HomeserverSdkUserEvent>;

      return this.normalizeUserEventStream(stream);
    } catch (error) {
      return handleError({
        error,
        additionalContext: { pathPrefix: params.pathPrefix },
      });
    }
  }

  /**
   * Subscribe to one homeserver's `/events-stream` for several of its users at
   * once (max 50), filtered to the given path prefixes (a trailing `/` means a
   * subtree). Public paths need no session. Callers own the reader lifecycle.
   */
  static async subscribeHomeserverEventStream(params: {
    homeserver: TPubkyModel;
    users: Array<[TPubkyModel, string | null]>;
    pathPrefixes: string[];
  }): Promise<ReadableStream<THomeserverResourceEvent>> {
    try {
      const pubkySdk = this.getPubkySdk();
      let builder = pubkySdk.eventStreamFor(PublicKey.from(params.homeserver)).addUsers(params.users);
      for (const prefix of params.pathPrefixes) {
        builder = builder.path(prefix);
      }
      const stream = (await builder.live().subscribe()) as ReadableStream<HomeserverSdkUserEvent>;
      return this.normalizeUserEventStream(stream);
    } catch (error) {
      return handleError({
        error,
        additionalContext: { homeserver: params.homeserver, users: params.users.length },
      });
    }
  }

  /** The homeserver that hosts `pubky`, from its PKARR record; `null` when there is none. */
  static async resolveHomeserverOf(pubky: TPubkyModel): Promise<TPubkyModel | null> {
    const homeserver = await this.resolveHomeserverRecord({ publicKey: PublicKey.from(pubky) });
    return homeserver ? homeserver.z32() : null;
  }

  /**
   * Credentials for an external service that verifies grant proofs offline
   * (the inbox): the session's grant plus a custom proof over `data`.
   * `null` for cookie sessions and SDKs without custom proofs, which the
   * caller reports as "needs a grant sign-in".
   */
  static async createInboxCredentials(data: unknown): Promise<THomeserverInboxCredentials | null> {
    const session = useAuthStore.getState().selectSession();
    const grant = (session?.grant ?? undefined) as GrantSessionWithCustomPop | undefined;
    if (!grant || typeof grant.createCustomPop !== 'function') return null;
    try {
      return await grant.createCustomPop(data);
    } catch (error) {
      return handleError({ error, additionalContext: { operation: 'createInboxCredentials' } });
    }
  }

  private static normalizeUserEventStream(
    stream: ReadableStream<HomeserverSdkUserEvent>,
  ): ReadableStream<THomeserverResourceEvent> {
    const reader = stream.getReader();

    return new ReadableStream<THomeserverResourceEvent>({
      async pull(controller) {
        const { done, value } = await reader.read();

        if (done) {
          controller.close();
          return;
        }

        try {
          // Read the resource before `free()`: the WASM object is gone afterwards.
          const owner = value.resource?.owner.z32() ?? '';
          const path = value.resource?.path ?? '';
          controller.enqueue({
            cursor: value.cursor,
            eventType: value.eventType,
            owner,
            path,
          });
        } finally {
          try {
            value.free();
          } catch {
            // Ignore WASM dispose errors.
          }
        }
      },
      async cancel(reason) {
        await reader.cancel(reason).catch(() => {});
      },
    });
  }
}
