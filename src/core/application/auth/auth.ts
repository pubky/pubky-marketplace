import type { Session, XCallbackParams } from '@synonymdev/pubky';
import { userUriBuilder } from 'pubky-app-specs';
import type { TKeypairParams, TRestoreSessionParams, TRestoreSessionResult } from '@/application/auth/auth.types';
import { getShopGrantClientId } from '@/config/app';
import { capabilitiesMatchFullGrant } from '@/libs/auth/capabilities';
import { FULL_GRANT_REQUIRED_MESSAGE } from '@/libs/auth/sign-in-error-copy';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import {
  isAppError,
  isAuthError,
  isNotFound,
  isWrongEnvironmentHomeserverError,
  toAppError,
} from '@/libs/error/error.utils';
import { HttpMethod } from '@/libs/http/http.types';
import { Logger } from '@/libs/logger/logger';
import { sleep } from '@/libs/utils/utils';
import { isPubkyExpiredError } from '@/libs/vibe-session/expired';
import { discardFragmentSessionExport } from '@/libs/vibe-session/fragment';
import type { Pubky } from '@/models/models.types';
import { HomeserverService } from '@/services/homeserver/homeserver';
import type {
  TGenerateAuthUrlResult,
  THomeserverPublicKeyParams,
  THomeserverSessionResult,
  THomeserverSignUpParams,
} from '@/services/homeserver/homeserver.types';

export function isDefinitiveSessionAuthFailure(error: unknown): boolean {
  if (isWrongEnvironmentHomeserverError(error)) {
    return false;
  }
  if (isAppError(error) && isAuthError(error)) {
    return true;
  }
  return isPubkyExpiredError(error);
}

export class AuthApplication {
  private constructor() {} // Prevent instantiation

  /** Restore only the selected SDK grant record; inconclusive failures retain it. */
  static async restorePersistedSession({ authStore }: TRestoreSessionParams): TRestoreSessionResult {
    const recordId = authStore.grantSessionRecordId;
    // Legacy cookie metadata and fragment/bridge exports never authorize a restore.
    discardFragmentSessionExport();
    if (!recordId) return { status: 'signed-out' };
    return this.restoreGrantSession(recordId, authStore.currentUserPubky);
  }

  private static async restoreGrantSession(recordId: string, expectedPubky: string | null): TRestoreSessionResult {
    try {
      const session = await HomeserverService.restoreGrantSession(recordId);
      if (!session.grant || !capabilitiesMatchFullGrant(session.info.capabilities)) {
        // A narrower grant needs an explicit scope upgrade, not credential destruction.
        return { status: 'deferred' };
      }
      const info = await session.grant.sessionInfo();
      if (info.clientId !== getShopGrantClientId() || (expectedPubky && info.publicKey.z32() !== expectedPubky)) {
        return { status: 'deferred' };
      }
      await HomeserverService.assertUserHomeserverAllowed({ publicKey: session.info.publicKey });
      return { status: 'restored', session };
    } catch (error) {
      // Unknown, storage, and network errors are not proof credentials expired.
      if (!isDefinitiveSessionAuthFailure(error)) return { status: 'deferred' };
      await this.removeGrantSession(recordId);
      return { status: 'signed-out' };
    }
  }

  /** Restore exactly the App-selected record. This consumer never mutates its lifetime. */
  static async restoreHostSession(reference: {
    pubky: string;
    sessionStoreId: string;
    clientId: string;
    grantId: string;
  }): Promise<Session> {
    const session = await HomeserverService.restoreGrantSession(reference.sessionStoreId);
    const info = await session.grant?.sessionInfo();
    if (
      !info ||
      session.info.publicKey.z32() !== reference.pubky ||
      info.publicKey.z32() !== reference.pubky ||
      info.clientId !== reference.clientId ||
      info.grantId !== reference.grantId
    ) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'The App session reference is no longer valid.', {
        service: ErrorService.Homeserver,
        operation: 'restoreHostSession',
        context: { reason: 'invalid-reference' },
      });
    }
    if (!capabilitiesMatchFullGrant(info.capabilities)) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'The App session needs permission to open Shop.', {
        service: ErrorService.Homeserver,
        operation: 'restoreHostSession',
        context: { reason: 'missing-capabilities' },
      });
    }
    await HomeserverService.assertUserHomeserverAllowed({ publicKey: session.info.publicKey });
    return session;
  }

  /**
   * Signs up a new user in the homeserver with the provided keypair and authentication credentials.
   *
   * @param params - The authentication parameters containing user credentials
   * @param params.keypair - The cryptographic keypair for the user
   * @param params.signupToken - Invitation code for user registration
   * @param params.secretKey - Secret key for homeserver service
   * @returns Session and pubky of the signed up user
   */
  static async signUp({ keypair, signupToken }: THomeserverSignUpParams): Promise<THomeserverSessionResult> {
    return await HomeserverService.signUp({ keypair, signupToken });
  }

  /**
   * Verifies a signup token (invite code) against the homeserver.
   *
   * @param signupToken - The signup token / invite code to verify
   * @returns `'valid'`, `'used'`, or `'invalid'` depending on the homeserver response
   */
  static async verifySignupToken(signupToken: string) {
    return await HomeserverService.verifySignupToken(signupToken);
  }

  /**
   * Authenticates the user against the homeserver using their cryptographic keypair.
   *
   * @param params - The authentication parameters
   * @param params.keypair - The cryptographic keypair for the user authentication
   * @param params.secretKey - Secret key for homeserver service
   * @returns Session and pubky of the authenticated user
   */
  static async signIn({ keypair }: TKeypairParams): Promise<THomeserverSessionResult | undefined> {
    if (!keypair) {
      throw Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        'Keypair not found in onboarding store. Please regenerate your keys and try again.',
        {
          service: ErrorService.Local,
          operation: 'signIn',
        },
      );
    }
    return await HomeserverService.signIn({ keypair });
  }

  /**
   * Generates an authentication URL for Pubky Ring App
   *
   * @returns Authentication URL and approval promise
   */
  static async generateAuthUrl(): Promise<TGenerateAuthUrlResult> {
    return await HomeserverService.generateAuthUrl();
  }

  /** Grant sign-in URL (`pubkyauth://signin_grant`) for signers such as Bitkit and Pubky Passport. */
  static async generateGrantAuthUrl(xCallback?: XCallbackParams): Promise<TGenerateAuthUrlResult> {
    return await HomeserverService.generateGrantAuthUrl(xCallback);
  }

  static isGrantSignInAvailable(): boolean {
    return HomeserverService.isGrantSignInAvailable();
  }

  static isGrantSession(session: Session | null | undefined): boolean {
    return HomeserverService.isGrantSession(session);
  }

  /**
   * Require the three Shop core capabilities; optional Chat scopes do not gate Shop entry.
   * Chat checks its own versioned scopes and requests re-approval when needed.
   * Standalone approvals missing a core capability are signed out and refused.
   */
  static async assertFullGrantSession(session: Session): Promise<void> {
    if (session.grant && capabilitiesMatchFullGrant(session.info.capabilities)) return;
    await HomeserverService.logout({ session }).catch((logoutError) => {
      Logger.warn('Failed to sign out a narrow grant session', { logoutError });
    });
    throw Err.validation(ValidationErrorCode.INVALID_INPUT, FULL_GRANT_REQUIRED_MESSAGE, {
      service: ErrorService.Homeserver,
      operation: 'assertFullGrantSession',
    });
  }

  static async saveGrantSession(session: Session): Promise<string> {
    return await HomeserverService.saveGrantSession(session);
  }

  static commitGrantSession(recordId: string): void {
    HomeserverService.commitGrantSession(recordId);
  }

  static queueGrantRetirement(recordId: string): void {
    HomeserverService.queueGrantRetirement(recordId);
  }

  /** Removes one stored grant session and its key; rejects while it is still stored. */
  static async removeGrantSession(recordId: string): Promise<void> {
    await this.withGrantKeyRemovalRetry(() => HomeserverService.removeGrantSession(recordId));
  }

  /** Retires exact Shop obligations, retaining failures and protecting active references. */
  static async clearGrantSessions(
    options: {
      requireAvailable?: boolean;
      recordIds?: string[];
      protectedRecordIds?: string[];
    } = {},
  ): Promise<void> {
    await this.withGrantKeyRemovalRetry(() => HomeserverService.clearGrantSessions(options));
  }

  private static readonly GRANT_KEY_REMOVAL_RETRY_DELAYS_MS = [100, 400];

  private static async withGrantKeyRemovalRetry(remove: () => Promise<void>): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await remove();
        return;
      } catch (error) {
        const delay = this.GRANT_KEY_REMOVAL_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) throw error;
        Logger.warn('Grant key removal failed; retrying', { attempt: attempt + 1 });
        await sleep(delay);
      }
    }
  }

  /**
   * Generates a signup authentication URL for Pubky Ring App.
   * Decorates a standard auth URL with homeserver address and invite code metadata.
   *
   * @param inviteCode - The invite code for signup
   * @returns Authentication URL and approval promise
   */
  static async generateSignupAuthUrl(inviteCode: string): Promise<TGenerateAuthUrlResult> {
    return await HomeserverService.generateSignupAuthUrl({ inviteCode });
  }

  /**
   * Logs out a user from the system.
   *
   * @param params - The logout parameters
   * @param params.session - The authenticated Session
   * @returns Void
   */
  static async logout(data: THomeserverSessionResult) {
    await HomeserverService.logout(data);
  }

  /**
   * Generates a signup token for user registration.
   * @returns Promise resolving to the generated signup token
   */
  static async generateSignupToken() {
    return await HomeserverService.generateSignupToken();
  }

  /** Staging guard: reject keys whose PKARR homeserver does not match this deploy. */
  static async assertUserHomeserverAllowed({ publicKey }: THomeserverPublicKeyParams): Promise<void> {
    await HomeserverService.assertUserHomeserverAllowed({ publicKey });
  }

  /**
   * In the application, there are two signups to do.
   * 1. First the user has to register the user key in the homeserver, throw the inviation code
   * 2. Then the user has to create a profile.json file in the homeserver. That file acts as a proof that the user has signed up.
   * This is a critical step because after that it will start indexing all user related data
   *
   * @param params - Parameters containing the user's public key
   * @param params.pubky - The user's public key identifier
   * @returns Promise resolving to the user profile or undefined if not found
   */
  static async userIsSignedUp({ pubky }: { pubky: Pubky }): Promise<boolean> {
    try {
      await HomeserverService.request({ method: HttpMethod.GET, url: userUriBuilder(pubky) });
      return true;
    } catch (error) {
      const appError = isAppError(error) ? error : toAppError(error, ErrorService.Homeserver, 'userIsSignedUp');
      if (isNotFound(appError)) return false;
      throw appError;
    }
  }
}
