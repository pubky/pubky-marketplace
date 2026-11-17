import type { Session, XCallbackParams } from '@synonymdev/pubky';
import { userUriBuilder } from 'pubky-app-specs';
import type { TKeypairParams, TRestoreSessionParams, TRestoreSessionResult } from '@/application/auth/auth.types';
import { getShopGrantClientId } from '@/config/app';
import { capabilitiesMatchFullGrant } from '@/libs/auth/capabilities';
import { FULL_GRANT_REQUIRED_MESSAGE } from '@/libs/auth/sign-in-error-copy';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { isAppError, isAuthError, isWrongEnvironmentHomeserverError, toAppError } from '@/libs/error/error.utils';
import { Logger } from '@/libs/logger/logger';
import { sleep } from '@/libs/utils/utils';
import { isPubkyExpiredError } from '@/libs/vibe-session/expired';
import { discardFragmentSessionExport } from '@/libs/vibe-session/fragment';
import type { Pubky } from '@/models/models.types';
import { HomeserverService } from '@/services/homeserver/homeserver';
import type {
  TGenerateAuthUrlResult,
  TGrantAuthUrlOptions,
  THomeserverPublicKeyParams,
  THomeserverSessionResult,
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
        'Recovery key is unavailable. Try restoring your account again.',
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
  static async generateGrantAuthUrl(
    xCallback?: XCallbackParams,
    options?: TGrantAuthUrlOptions,
  ): Promise<TGenerateAuthUrlResult> {
    return options === undefined
      ? await HomeserverService.generateGrantAuthUrl(xCallback)
      : await HomeserverService.generateGrantAuthUrl(xCallback, options);
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
   * Logs out a user from the system.
   *
   * @param params - The logout parameters
   * @param params.session - The authenticated Session
   * @returns Void
   */
  static async logout(data: THomeserverSessionResult) {
    await HomeserverService.logout(data);
  }

  /** Staging guard: reject keys whose PKARR homeserver does not match this deploy. */
  static async assertUserHomeserverAllowed({ publicKey }: THomeserverPublicKeyParams): Promise<void> {
    await HomeserverService.assertUserHomeserverAllowed({ publicKey });
  }

  /** Check whether an existing account has the profile document required for Shop access and indexing. */
  static async userIsSignedUp({ pubky }: { pubky: Pubky }): Promise<boolean> {
    try {
      const profile = await HomeserverService.getJsonIfFound({ url: userUriBuilder(pubky) });
      return profile.found;
    } catch (error) {
      throw isAppError(error) ? error : toAppError(error, ErrorService.Homeserver, 'userIsSignedUp');
    }
  }
}
