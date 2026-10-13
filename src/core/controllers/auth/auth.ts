import type { Session, XCallbackParams } from '@synonymdev/pubky';
import { AuthApplication, isDefinitiveSessionAuthFailure } from '@/application/auth/auth';
import type { TKeypairParams, TRestorePersistedSessionResult } from '@/application/auth/auth.types';
import { BootstrapApplication, type BootstrapProgressCallback } from '@/application/bootstrap/bootstrap';
import { CommerceApplication } from '@/application/commerce/commerce';
import { FirstContactApplication } from '@/application/messaging/first-contact';
import { MessagingApplication } from '@/application/messaging/messaging';
import { SettingsApplication } from '@/application/settings/settings';
import { postStreamQueue } from '@/application/stream/posts/muting/post-stream-queue';
import { TagApplication } from '@/application/tag/tag';
import type {
  HostSessionApplyStatus,
  HostSessionSnapshot,
  TLoginWithEncryptedFileParams,
  TLoginWithMnemonicParams,
  TSignUpParams,
} from '@/controllers/auth/auth.types';
import { broadcastSignedOut, bumpAuthEpoch, readAuthEpoch, subscribeSignedOut } from '@/controllers/auth/auth-epoch';
import { withAuthFinalizationLock } from '@/controllers/auth/auth-finalization-lock';
import {
  captureAuthIdentityFromStore,
  type CapturedAuthIdentity,
  nonEmptyPubky,
  shouldAbortIdentityPersist,
  shouldSkipDestructiveCleanup,
} from '@/controllers/auth/auth-identity-guard';
import { isGrantKeyCleanupPending } from '@/controllers/auth/grant-key-cleanup';
import { CommerceController } from '@/controllers/commerce/commerce';
import { NotificationCoordinator } from '@/coordinators/notifications/notifications';
import { StreamCoordinator } from '@/coordinators/streams/stream';
import { TtlCoordinator } from '@/coordinators/ttl/ttl';
import { clearDatabase, clearPrivateData } from '@/database/franky/franky.helpers';
import { readHostIdentity, writeHostIdentity } from '@/libs/auth/host-identity';
import { AuthErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { isAppError, isWrongEnvironmentHomeserverError, toAppError } from '@/libs/error/error.utils';
import { Identity } from '@/libs/identity/identity';
import { Logger } from '@/libs/logger/logger';
import { clearMuteSyncCursorSessionStorage } from '@/libs/mute-sync/clear-cursor-session-storage';
import { clearAllQueryClients } from '@/libs/query-client/query-client.factory';
import { requestShopHostAction } from '@/libs/shop-session/bridge';
import { sleep } from '@/libs/utils/utils';
import { suppressVibeSessionAutoRestore } from '@/libs/vibe-session/auto-restore';
import { isVibeSessionConsumerEnabled } from '@/libs/vibe-session/config';
import type { Pubky } from '@/models/models.types';
import { NotificationNormalizer } from '@/pipes/notification/notification.normalizer';
import { PubkySpecsSingleton } from '@/pipes/pipes.builder';
import { SettingsNormalizer } from '@/pipes/settings/settings.normalizer';
import { clearRouteGuardReturnTo } from '@/providers/RouteGuardProvider/RouteGuardProvider.returnPath';
import { createCanceledError, isGrantKeyRemovalError } from '@/services/homeserver/error.utils';
import type { TGenerateAuthUrlResult, THomeserverSessionResult } from '@/services/homeserver/homeserver.types';
import {
  clearPersistedAuthIdentity,
  hasPersistedAuthIdentity,
  readPersistedAuthIdentity,
  readPersistedGrantSessionRecordId,
} from '@/stores/auth/auth.persisted';
import { useAuthStore } from '@/stores/auth/auth.store';
import type { GrantSigner } from '@/stores/auth/auth.types';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { useHomeStore } from '@/stores/home/home.store';
import { useHotStore } from '@/stores/hot/hot.store';
import { useLocalFilesStore } from '@/stores/localFiles/localFiles.store';
import { useMessagingStore } from '@/stores/messaging/messaging.store';
import { useMigrationStore } from '@/stores/migration/migration.store';
import { useNotificationStore } from '@/stores/notification/notification.store';
import { useOnboardingStore } from '@/stores/onboarding/onboarding.store';
import { ONBOARDING_PERSIST_KEY } from '@/stores/persistedKeys';
import { useSearchStore } from '@/stores/search/search.store';
import { useSessionHandoffStore } from '@/stores/sessionHandoff/sessionHandoff.store';
import { useSettingsStore } from '@/stores/settings/settings.store';
import type { SettingsState } from '@/stores/settings/settings.types';
import { useSignInStore } from '@/stores/signIn/signIn.store';

export class AuthController {
  private constructor() {} // Prevent instantiation

  private static hostMode = false;
  private static hostVersion = 0;
  private static hostSnapshotKey: string | null = null;
  private static hostTransition: Promise<HostSessionApplyStatus> = Promise.resolve('signed-out');
  private static hostReadAbort = new AbortController();

  static isHostSessionMode(): boolean {
    return this.hostMode;
  }

  static setHostSessionMode(enabled: boolean): void {
    if (enabled === this.hostMode) return;
    this.hostMode = enabled;
    this.hostReadAbort.abort();
    this.hostReadAbort = new AbortController();
    this.hostVersion++;
    this.hostSnapshotKey = null;
    this.logoutGeneration++;
    this.cancelAllAuthFlows();
    BootstrapApplication.cancelModerationFollow();
    useAuthStore.getState().setSession(null);
  }

  private static assertStandaloneMode(): void {
    if (!this.hostMode) return;
    throw Err.auth(AuthErrorCode.UNAUTHORIZED, 'Continue sign-in in Pubky App.', {
      service: ErrorService.Local,
      operation: 'standaloneSignIn',
    });
  }

  static applyHostSession(snapshot: HostSessionSnapshot): Promise<HostSessionApplyStatus> {
    if (!this.hostMode) this.setHostSessionMode(true);
    const key = JSON.stringify(snapshot);
    if (key === this.hostSnapshotKey) return this.hostTransition;
    this.hostSnapshotKey = key;
    this.hostReadAbort.abort();
    this.hostReadAbort = new AbortController();
    const signal = this.hostReadAbort.signal;
    const version = ++this.hostVersion;
    this.logoutGeneration++;
    this.cancelAllAuthFlows();
    BootstrapApplication.cancelModerationFollow();
    // Fence homeserver requests immediately; private cleanup is serialized below.
    useAuthStore.getState().setSession(null);
    clearAllQueryClients();
    const current = () => this.hostMode && version === this.hostVersion;
    this.hostTransition = this.hostTransition
      .catch(() => 'temporary-error' as const)
      .then(() =>
        withAuthFinalizationLock(async () => {
          if (!current()) return 'restoring';
          let previousPubky: string | null;
          let sharedPubky: string | null;
          try {
            sharedPubky = readHostIdentity();
            previousPubky = useAuthStore.getState().currentUserPubky ?? sharedPubky;
          } catch {
            this.hostSnapshotKey = null;
            return 'temporary-error';
          }
          const identityChanged = Boolean(snapshot.pubky && previousPubky && snapshot.pubky !== previousPubky);
          if (snapshot.status === 'signed-out' || identityChanged || (snapshot.status === 'ready' && !previousPubky)) {
            this.markLocalStateDirty();
            // Another iframe may have already prepared this account while this
            // frame waited for the lock. Reset its old local view without wiping
            // the new account's database, message keys or service approvals.
            const preparedByAnotherFrame = Boolean(
              snapshot.status !== 'signed-out' && snapshot.pubky && sharedPubky === snapshot.pubky,
            );
            await this.cleanupLocalState({
              preservePublicCache: true,
              preservePrivateData: preparedByAnotherFrame,
              preserveServiceSessions: preparedByAnotherFrame || (snapshot.status !== 'signed-out' && !identityChanged),
              keepServicePubky: preparedByAnotherFrame ? snapshot.pubky : null,
            });
            if (!current()) return 'restoring';
            // Reserve the prepared identity before SDK/profile IO. This public
            // marker is only a cleanup boundary and cannot authorize a restore.
            writeHostIdentity(snapshot.status === 'signed-out' ? null : snapshot.pubky);
          }
          // An embedded consumer never persists an independently restorable pointer.
          clearPersistedAuthIdentity();
          const store = useAuthStore.getState();
          store.setIsRestoringSession(snapshot.status === 'restoring' || snapshot.status === 'ready');
          store.setSessionRestoreDeferred(
            snapshot.status === 'temporary-error' || snapshot.status === 'reauth-required',
          );
          if (snapshot.status !== 'ready') return snapshot.status;
          if (
            !snapshot.generation ||
            !snapshot.pubky ||
            !snapshot.sessionStoreId ||
            !snapshot.grantId ||
            !snapshot.clientId
          ) {
            store.setIsRestoringSession(false);
            return 'reauth-required';
          }
          try {
            const session = await this.awaitHostRead(
              AuthApplication.restoreHostSession({
                pubky: snapshot.pubky,
                sessionStoreId: snapshot.sessionStoreId,
                grantId: snapshot.grantId,
                clientId: snapshot.clientId,
              }),
              signal,
            );
            if (!session || !current()) return 'restoring';
            const pubky = Identity.z32FromSession({ session });
            const hasProfile = await this.awaitHostRead(AuthApplication.userIsSignedUp({ pubky }), signal);
            if (hasProfile === null || !current()) return 'restoring';
            store.init({
              session,
              currentUserPubky: pubky,
              hasProfile: null,
              sessionOwner: 'host',
              hostGeneration: snapshot.generation,
              grantSigner: 'host',
            });
            writeHostIdentity(pubky);
            this.markLocalStateDirty();
            const marketplaceSession = CommerceApplication.restoreMarketplaceSession(pubky);
            if (marketplaceSession) CommerceController.writeMarketplaceSessionStore(marketplaceSession);
            const inventorySession = CommerceApplication.restoreInventorySession(pubky);
            if (inventorySession) CommerceController.writeInventorySessionStore(inventorySession);
            if (hasProfile) await this.hydrateMeImAlive({ pubky, isCurrent: current });
            if (!current()) return 'restoring';
            store.setHasProfile(hasProfile);
            return 'ready';
          } catch (error) {
            if (!current()) return 'restoring';
            store.setSession(null);
            store.setSessionRestoreDeferred(true);
            this.hostSnapshotKey = null;
            // The host alone decides whether to retry, upgrade, or retire its grant.
            if (isAppError(error) && error.context?.reason === 'missing-capabilities') return 'capabilities-required';
            return isDefinitiveSessionAuthFailure(error) ||
              (isAppError(error) && error.operation === 'restoreHostSession')
              ? 'reauth-required'
              : 'temporary-error';
          } finally {
            if (current()) store.setIsRestoringSession(false);
          }
        }),
      )
      .catch(() => {
        if (!current()) return 'restoring';
        this.hostSnapshotKey = null;
        const store = useAuthStore.getState();
        store.setSession(null);
        store.setIsRestoringSession(false);
        store.setSessionRestoreDeferred(true);
        return 'temporary-error';
      });
    return this.hostTransition;
  }

  /** Read-only SDK/network work must not hold a newer account transition hostage. */
  private static awaitHostRead<T>(operation: Promise<T>, signal: AbortSignal): Promise<T | null> {
    let invalidate!: () => void;
    const canceled = new Promise<null>((resolve) => {
      invalidate = () => resolve(null);
      if (signal.aborted) invalidate();
      else signal.addEventListener('abort', invalidate, { once: true });
    });
    return Promise.race([operation, canceled]).finally(() => signal.removeEventListener('abort', invalidate));
  }

  /**
   * The Bitkit grant QR and the Pubky Passport button live beside the Ring QR
   * on /sign-in, so each grant signer has its own slot: starting one never
   * cancels another. A new flow for the same signer replaces its old one. All
   * are cancelled when any sign-in completes, on local-state cleanup, and on
   * cross-tab sign-out.
   */
  private static activeGrantFlows = new Map<GrantSigner, { token: symbol; cancel: (() => void) | null }>();

  /**
   * Bumped whenever every auth flow is cancelled. A grant approval that
   * settles after a bump lost to another sign-in (or a sign-out) and is
   * signed out instead of initialized.
   */
  private static authFlowGeneration = 0;

  /**
   * Bumped synchronously at logout start, before any await. A restore that
   * began on an earlier generation (e.g. a RouteGuard-initiated restore
   * must not install or persist that identity after logout owns finalization.
   */
  private static logoutGeneration = 0;

  /** `authEpoch` read when each grant sign-in QR started, keyed by its approved session. */
  private static grantEpochAtStart = new WeakMap<Session, number>();

  /** `authFlowGeneration` when each sign-in QR (Ring or Bitkit) started, keyed by its approved session. */
  private static sessionFlowGeneration = new WeakMap<Session, number>();
  /** The signer whose grant ceremony produced a session, saved with its grant record. */
  private static grantSignerBySession = new WeakMap<Session, GrantSigner>();

  /** Resolver of the `#s=` hand-off prompt the user has not answered yet. */
  private static pendingSessionHandoff: ((accepted: boolean) => void) | null = null;

  private static async confirmSessionHandoff(pubky: Pubky): Promise<boolean> {
    this.pendingSessionHandoff?.(false);
    return await new Promise<boolean>((resolve) => {
      this.pendingSessionHandoff = resolve;
      useSessionHandoffStore.getState().setPendingPubky(pubky);
    });
  }

  /** The user's answer to the `#s=` hand-off prompt. Only `true` signs the tab in. */
  static answerSessionHandoff(accepted: boolean): void {
    const resolve = this.pendingSessionHandoff;
    this.pendingSessionHandoff = null;
    useSessionHandoffStore.getState().setPendingPubky(null);
    resolve?.(accepted);
  }

  /**
   * Single-run guard for cleanupLocalState: concurrent Controller invocations
   * (e.g. a logout racing an in-flight restore) share one run, and once a run
   * has completed further calls are no-ops until a session init marks local
   * state dirty again.
   */
  private static cleanupState: { promise: Promise<void> | null; completed: boolean } = {
    promise: null,
    completed: false,
  };

  /**
   * Identity snapshot for the in-flight sign-in/sign-up/QR ceremony that
   * already took (or skipped) origin-scoped Dexie. Subsequent persist must
   * abort if a different account now owns that database.
   */
  private static pendingLocalStateCapture: CapturedAuthIdentity | null = null;

  /** Test-only: reset the cleanupLocalState single-run guard. */
  static resetCleanupLocalStateGuard(): void {
    this.cleanupState = { promise: null, completed: false };
    this.pendingLocalStateCapture = null;
  }

  private static captureAuthIdentity(): CapturedAuthIdentity {
    return captureAuthIdentityFromStore(useAuthStore.getState(), hasPersistedAuthIdentity());
  }

  /**
   * Releases a hook-held auth flow. When the flow is still the
   * controller-tracked active flow, the whole active flow AND ceremony guard
   * are torn down, so a retry mints a FRESH single-use URL instead of joining
   * the cancelled ceremony and re-showing its dead QR. When the flow was
   * already superseded (another start won the slot), only the hook's own
   * stale handle is freed — the live superseding flow is left untouched.
   */
  static releaseAuthFlow(cancelAuthFlow: () => void): void {
    for (const [signer, flow] of this.activeGrantFlows) {
      if (flow.cancel === cancelAuthFlow) {
        this.cancelActiveGrantFlow(signer);
        return;
      }
    }
    cancelAuthFlow();
  }

  /** Local state is dirty again once a session is initialized into it. */
  private static markLocalStateDirty(): void {
    this.cleanupState.completed = false;
  }

  private static cancelActiveGrantFlow(signer: GrantSigner) {
    const cancel = this.activeGrantFlows.get(signer)?.cancel;
    this.activeGrantFlows.delete(signer);
    cancel?.();
  }

  /** Ring, Bitkit and Passport flows alike: a completed sign-in or a sign-out ends all of them. */
  static cancelAllAuthFlows() {
    this.authFlowGeneration += 1;
    for (const signer of [...this.activeGrantFlows.keys()]) this.cancelActiveGrantFlow(signer);
  }

  /** A QR approval whose flow started before the latest cancelAllAuthFlows lost to another sign-in or a sign-out. */
  private static lostToAnotherSignIn(session: Session): boolean {
    const startedAt = this.sessionFlowGeneration.get(session);
    return startedAt !== undefined && startedAt !== this.authFlowGeneration;
  }

  /**
   * First approval wins. A losing approval is signed out without touching
   * the active identity's independently approved service credentials.
   */
  private static async discardLosingApproval(session: Session): Promise<never> {
    await AuthApplication.logout({ session }).catch(() => {
      Logger.warn('Failed to sign out an approval that lost to another sign-in');
    });
    throw createCanceledError();
  }

  /**
   * Restores a persisted session from the auth store.
   * @returns Discriminated restore outcome for callers (logout vs route restore)
   * @throws Wrong-environment homeserver errors after local cleanup so UI can show feedback
   */
  static async restorePersistedSession(): Promise<TRestorePersistedSessionResult> {
    if (this.hostMode) return { status: useAuthStore.getState().session ? 'restored' : 'deferred' };
    const authStore = useAuthStore.getState();
    // Keep local history while a legacy cookie login is replaced by a grant.
    if (authStore.sessionExport && !authStore.grantSessionRecordId) {
      authStore.setSession(null);
      authStore.setIsRestoringSession(false);
      authStore.setSessionRestoreDeferred(true);
      return { status: 'deferred' };
    }
    // Captured before any await: a concurrent different-account sign-in must
    // be compared again inside the finalization lock (not as a stale boolean).
    const captured = this.captureAuthIdentity();
    // Captured before any await so a logout that starts while the shared
    // Application restore is in flight invalidates this invocation's
    // restored-branch finalization (compared again right before `init`).
    const logoutGenerationAtStart = this.logoutGeneration;
    let flowGenerationAtStart = this.authFlowGeneration;
    // Captured before cleanup can reset the store: a restored grant session
    // keeps its BrowserSessionStore record (restore never saves).
    const restoredGrantRecordId = authStore.grantSessionRecordId;
    const restoredGrantSigner = authStore.grantSigner;
    // The Controller owns the restore loading flag for the whole flow: set once
    // before restore begins, cleared once after finalization. With a fresh-vibe
    // bridge restore (sessionExport === null) the isSessionRestorePending
    // backstop in useAuthStatus does not apply, so no intermediate owner may
    // leave a window where the flag reads false between restore start and init.
    authStore.setIsRestoringSession(true);
    let cleanedUp = false;
    try {
      const result = await AuthApplication.restorePersistedSession({
        authStore,
        confirmSessionHandoff: (pubky) => this.confirmSessionHandoff(pubky),
      });
      if (result.status === 'restored') {
        const { session } = result;
        const pubky = Identity.z32FromSession({ session });
        const persistedPubky = authStore.currentUserPubky;
        const sameIdentity = persistedPubky != null && persistedPubky === pubky;

        // Fresh vibe (no persisted identity) or a different pubky must not inherit
        // the previous account's hasProfile flag or IndexedDB/store snapshot.
        // isRestoringSession is already held by this method and survives the
        // auth-store reset inside cleanup, so useAuthStatus keeps loading.
        if (!sameIdentity) {
          await this.finalizeSignedOutUnderLock({
            captured,
            preservePublicCache: false,
          });
          cleanedUp = true;
          flowGenerationAtStart = this.authFlowGeneration;
        }

        const hasProfile = sameIdentity ? authStore.hasProfile : await AuthApplication.userIsSignedUp({ pubky });
        // A logout began while the shared restore was in flight: the logout
        // owns finalization now. Bail out as signed-out — never re-init the
        // just-logged-out identity (that would re-persist its sessionExport
        // and clear logout suppression inside `init`). Any cleanup this
        // invocation already ran is deduplicated by the single-run guard.
        if (
          this.logoutGeneration !== logoutGenerationAtStart ||
          this.authFlowGeneration !== flowGenerationAtStart ||
          this.hostMode
        ) {
          return { status: 'signed-out' };
        }
        // The identity persist takes the finalization lock: a concurrent
        // visitor tab's no-identity cleanup re-reads identity INSIDE the
        // lock, so it either observes this persist (and skips its wipe) or
        // wiped before it (nothing of this identity existed yet).
        const persisted = await this.persistIdentityUnderLock(pubky, captured, async (prepare) => {
          if (
            this.logoutGeneration !== logoutGenerationAtStart ||
            this.authFlowGeneration !== flowGenerationAtStart ||
            this.hostMode
          )
            return false;
          await prepare();
          useAuthStore.getState().init({
            session,
            currentUserPubky: pubky,
            hasProfile,
            ...(AuthApplication.isGrantSession(session) && restoredGrantRecordId
              ? { grantSessionRecordId: restoredGrantRecordId, grantSigner: restoredGrantSigner }
              : {}),
          });
        });
        if (!persisted) {
          return { status: 'signed-out' };
        }
        // The marketplace bearer session survives reloads in localStorage,
        // scoped to the account whose app session was just restored; anything
        // persisted for another account is dropped inside the restore.
        const marketplaceSession = CommerceApplication.restoreMarketplaceSession(pubky);
        if (marketplaceSession) {
          CommerceController.writeMarketplaceSessionStore(marketplaceSession);
        }
        const inventorySession = CommerceApplication.restoreInventorySession(pubky);
        if (inventorySession) {
          CommerceController.writeInventorySessionStore(inventorySession);
        }
        return { status: 'restored' };
      }
      if (result.status === 'deferred') {
        authStore.setSessionRestoreDeferred(true);
        return { status: 'deferred' };
      }
      await this.finalizeSignedOutUnderLock({
        captured,
        preservePublicCache: !captured.hadIdentity,
      });
      cleanedUp = true;
      return { status: 'signed-out' };
    } catch (error) {
      if (isGrantKeyRemovalError(error)) {
        // The grant record and its key are still stored: keep the pointer so
        // the next restore or sign-out retries the removal. Not signed-out.
        Logger.error('Grant session key could not be removed; keeping its record for a retry', { error });
        authStore.setSessionRestoreDeferred(true);
        return { status: 'deferred' };
      }
      const appError = toAppError(error, ErrorService.Local, 'restorePersistedSession');
      if (!cleanedUp) {
        await this.finalizeSignedOutUnderLock({
          captured,
          preservePublicCache: !captured.hadIdentity,
        });
      }
      if (isWrongEnvironmentHomeserverError(appError)) {
        throw appError;
      }
      return { status: 'signed-out' };
    } finally {
      useAuthStore.getState().setIsRestoringSession(false);
    }
  }

  /**
   * Gets a homeserver service instance using the secret key from the onboarding store.
   * @param params - The authentication parameters
   * @param params.keypair - The cryptographic keypair for the user
   * @returns Configured homeserver service instance
   */
  private static async signIn({ keypair }: TKeypairParams): Promise<boolean> {
    this.assertStandaloneMode();
    const generationAtStart = this.authFlowGeneration;
    const epochAtStart = readAuthEpoch();
    BootstrapApplication.cancelModerationFollow();
    // Clear query clients to ensure no stale cache from previous session
    clearAllQueryClients();
    const captured = this.captureAuthIdentity();
    if (!(await this.takeLocalStateForCapturedIdentity(captured))) {
      return false;
    }
    const session = await AuthApplication.signIn({ keypair });
    if (!session) {
      // Never log the keypair (it carries the identity secret) — the public key only.
      Logger.error('Failed to sign in. Please try again.', { pubky: keypair.publicKey.z32() });
      return false;
    }
    // Environment guard already ran inside HomeserverService.signIn (before the
    // session was created), so go straight to shared initialization.
    this.sessionFlowGeneration.set(session.session, generationAtStart);
    this.grantEpochAtStart.set(session.session, epochAtStart);
    this.grantSignerBySession.set(session.session, 'local-key');
    await this.completeAuthenticatedSession(session);
    return true;
  }

  /**
   * Bootstrap data to initialize the application snapshot.
   * @param params - Object containing session and pubky data from authentication
   * @param params.session - The user session data
   * @param params.pubky - The user's public key identifier
   */
  private static async hydrateMeImAlive({
    pubky,
    isCurrent = () => useAuthStore.getState().currentUserPubky === pubky && Boolean(useAuthStore.getState().session),
  }: {
    pubky: Pubky;
    isCurrent?: () => boolean;
  }) {
    const signInStore = useSignInStore.getState();
    const {
      meta: { url },
    } = NotificationNormalizer.to(pubky);

    // Progress callback to update signInStore from Controller layer (respecting architecture rules)
    const onProgress: BootstrapProgressCallback = (step) => {
      if (!isCurrent()) return;
      switch (step) {
        case 'bootstrapFetched':
          signInStore.setBootstrapFetched(true); // Step 3 complete (60%)
          break;
        case 'dataPersisted':
          signInStore.setDataPersisted(true); // Step 4 complete (80%)
          break;
        case 'homeserverSynced':
          signInStore.setHomeserverSynced(true); // Step 5 complete (100%)
          break;
      }
    };

    const localSettings = SettingsNormalizer.extractState(useSettingsStore.getState());

    // Sync settings from homeserver before bootstrap; errors are logged and fall back to local settings.
    const remoteSettings = await this.syncSettings(pubky, localSettings);

    // Resolve final preferences: remote settings win if available, otherwise use local
    if (!isCurrent()) return;
    const preferences = (remoteSettings ?? localSettings).notifications;
    const allowedTypes = NotificationNormalizer.toEnabledTypes(preferences);

    const notification = await BootstrapApplication.initialize({ pubky, lastReadUrl: url, allowedTypes }, onProgress);
    if (!isCurrent()) return;
    useNotificationStore.getState().setState(notification);

    // Pull the private cross-device watchlist and merge it into local state.
    // Fire-and-forget: sign-in must not block on it, and a failed round
    // leaves the outbox job pending to heal on the next marketplace visit.
    void CommerceController.syncWatchlist().catch((error) => {
      Logger.warn('Watchlist sync after bootstrap failed; it will retry on the next marketplace visit', { error });
    });

    // Apply remote settings to store (store mutation stays in Controller layer)
    if (remoteSettings) {
      useSettingsStore.getState().loadFromHomeserver(remoteSettings);
      Logger.info('Settings loaded from homeserver', { pubky });
    }
  }

  /**
   * In-flight session init, keyed by Session object identity. Every joiner of
   * one ceremony (a StrictMode double-effect, a remount) receives the same
   * awaitApproval settlement and must not run the store reset + bootstrap
   * twice: a second call for the SAME Session joins the first instead.
   */
  private static sessionInitInFlight: { session: Session; promise: Promise<void> } | null = null;

  /**
   * Initializes the authenticated session and checks if the user is signed up (profile.json in homeserver).
   *
   * Runs the staging environment guard first: the session was approved externally
   * (e.g. Pubky Ring), so this is its only checkpoint. Keypair flows skip the
   * guard here — HomeserverService.signIn already ran it before creating the
   * session, and re-asserting would duplicate the PKARR lookup and let a
   * transient second lookup abort an already-verified sign-in.
   * @param params - Object containing session data from authentication
   * @param params.session - The user session data
   */
  static async initializeAuthenticatedSession({ session }: THomeserverSessionResult) {
    const inFlight = this.sessionInitInFlight;
    if (inFlight && inFlight.session === session) {
      return await inFlight.promise;
    }
    const promise = this.runInitializeAuthenticatedSession({ session });
    this.sessionInitInFlight = { session, promise };
    // Joiners observe the real rejection through their own await; the stored
    // branch must never surface as an unhandled rejection.
    promise.catch(() => {});
    try {
      await promise;
    } finally {
      if (this.sessionInitInFlight?.promise === promise) {
        this.sessionInitInFlight = null;
      }
    }
  }

  private static async runInitializeAuthenticatedSession({ session }: THomeserverSessionResult) {
    if (this.lostToAnotherSignIn(session)) {
      return await this.discardLosingApproval(session);
    }
    try {
      try {
        const environmentCheckStartedAt = Date.now();
        await AuthApplication.assertUserHomeserverAllowed({ publicKey: session.info.publicKey });
        Logger.debug('Sign-in environment check completed', { elapsedMs: Date.now() - environmentCheckStartedAt });
      } catch (error) {
        // The just-approved session lives on the user's actual homeserver — sign it
        // out instead of leaving it dangling, whether the key was rejected or the
        // lookup failed. Best-effort: the failure must surface regardless.
        await AuthApplication.logout({ session }).catch((logoutError) => {
          Logger.warn('Failed to sign out session after environment check failure', { logoutError });
        });
        throw error;
      }
      await this.completeAuthenticatedSession({ session });
    } catch (error) {
      // A completion that lost to another sign-in was already cleaned up by
      // discardLosingApproval; the bearer at rest now belongs to the winner.
      if (this.lostToAnotherSignIn(session)) throw error;
      useSignInStore.getState().reset();
      throw error;
    }
  }

  /**
   * Session initialization shared by all sign-in flows; assumes the environment
   * guard already passed for this session.
   */
  private static async completeAuthenticatedSession({ session }: THomeserverSessionResult) {
    // Checked and claimed with no await in between: of two approvals that both
    // reach here, the first bumps the generation (cancelAllAuthFlows below)
    // and the second is discarded before it can touch any store.
    this.assertStandaloneMode();
    if (this.lostToAnotherSignIn(session)) {
      return await this.discardLosingApproval(session);
    }
    await AuthApplication.assertFullGrantSession(session);
    const signInStore = useSignInStore.getState();
    signInStore.reset(); // Reset for fresh sign-in
    signInStore.setAuthUrlResolved(true); // Step 1 complete (20%)

    const authStore = useAuthStore.getState();
    let persistAborted = false;
    let grantSaveError: unknown = null;

    try {
      this.cancelAllAuthFlows();
      // This approval won; only the approvals it just cancelled count as lost.
      this.sessionFlowGeneration.delete(session);
      const completionGeneration = this.authFlowGeneration;
      const pubky = Identity.z32FromSession({ session });

      // Identity persist takes the finalization lock so a visitor tab's
      // no-identity cleanup (which re-reads identity INSIDE the lock) either
      // observes this persist and skips its wipe, or wiped before it. The
      // network bootstrap below stays OUTSIDE the lock; the residual window
      // is closed by that same re-read — any later no-identity cleanup sees
      // the persisted identity and skips. A different account that signed in
      // after this ceremony captured local state aborts persist rather than
      // overwriting that account's Dexie rows.
      const persisted = await this.persistIdentityUnderLock(pubky, this.pendingLocalStateCapture, async (prepare) => {
        let grantSessionRecordId: string | null = null;
        if (AuthApplication.isGrantSession(session)) {
          // Inside the finalization lock: a sign-out since this QR started
          // (any tab) bumped the epoch, and the key must not be saved back.
          const epochAtStart = this.grantEpochAtStart.get(session);
          if (epochAtStart === undefined || epochAtStart !== readAuthEpoch()) {
            return false;
          }
          // Recorded before the save: a save that fails, or a tab that closes
          // mid-save, leaves an obligation the next load can discharge.
          try {
            grantSessionRecordId = await AuthApplication.saveGrantSession(session);
          } catch (error) {
            grantSaveError = error;
            return false;
          }
          if (this.hostMode || completionGeneration !== this.authFlowGeneration || epochAtStart !== readAuthEpoch()) {
            grantSaveError = createCanceledError();
            return false;
          }
          await prepare();
          if (this.hostMode || completionGeneration !== this.authFlowGeneration || epochAtStart !== readAuthEpoch()) {
            grantSaveError = createCanceledError();
            return false;
          }
          authStore.init({
            session,
            currentUserPubky: pubky,
            hasProfile: null,
            grantSessionRecordId,
            grantSigner: this.grantSignerBySession.get(session) ?? 'ring',
          });
          AuthApplication.commitGrantSession(grantSessionRecordId);
          return true;
        }
        await prepare();
        authStore.init({ session, currentUserPubky: pubky, hasProfile: null });
        return true;
      });
      if (!persisted) {
        persistAborted = true;
        await AuthApplication.logout({ session }).catch((logoutError) => {
          Logger.warn('Failed to sign out a session that lost the local-state race', { logoutError });
        });
        if (grantSaveError !== null) {
          // A failed save can leave a partial record and this flow's delegated
          // key in IndexedDB. The grant is signed out above (that needs the
          // key), so the key goes now. Sign-out uses the same order. If the
          // removal fails too, the pending marker keeps the obligation.
          await this.settlePendingGrantKeyCleanup();
          throw grantSaveError;
        }
        throw createCanceledError();
      }

      const isCurrent = () =>
        useAuthStore.getState().session === session && !useAuthStore.getState().isLoggingOut && !this.hostMode;
      const isSignedUp = await AuthApplication.userIsSignedUp({ pubky });
      if (!isCurrent()) throw createCanceledError();
      signInStore.setProfileChecked(true); // Step 2 complete (40%)

      if (isSignedUp) {
        await this.hydrateMeImAlive({ pubky, isCurrent });
      }

      // Update hasProfile after bootstrap completes - triggers redirect via useAuthStatus
      if (!isCurrent()) throw createCanceledError();
      authStore.setHasProfile(isSignedUp);
    } catch (error) {
      if (!persistAborted && useAuthStore.getState().session === session) {
        authStore.setSession(null);
        authStore.setSessionRestoreDeferred(true);
        signInStore.reset();
      }
      throw error;
    }
  }

  /**
   * Signs up a new user with the homeserver using the provided secret key and signup token.
   * @param params - Object containing secret key and signup token for registration
   * @param params.secretKey - The secret key for the user
   * @param params.signupToken - Invitation code for user registration
   */
  static async signUp({ secretKey, signupToken }: TSignUpParams) {
    this.assertStandaloneMode();
    const generationAtStart = this.authFlowGeneration;
    const epochAtStart = readAuthEpoch();
    const captured = this.captureAuthIdentity();
    if (!(await this.takeLocalStateForCapturedIdentity(captured))) throw createCanceledError();
    const keypair = Identity.keypairFromSecretKey(secretKey);
    const result = await AuthApplication.signUp({ keypair, signupToken });
    this.sessionFlowGeneration.set(result.session, generationAtStart);
    this.grantEpochAtStart.set(result.session, epochAtStart);
    this.grantSignerBySession.set(result.session, 'local-key');
    await this.completeAuthenticatedSession(result);
  }

  /**
   * Authenticates the keypair with the homeserver and saves the authenticated data if successful.
   * @param params - Object containing the mnemonic phrase for key derivation
   * @param params.mnemonic - The mnemonic phrase for key derivation
   * @returns Promise resolving to true if authentication succeeded, false otherwise
   */
  static async loginWithMnemonic({ mnemonic }: TLoginWithMnemonicParams): Promise<boolean> {
    const keypair = Identity.keypairFromMnemonic(mnemonic);
    return await this.signIn({ keypair });
  }

  /**
   * Decrypts the file to obtain the keypair, authenticates with the homeserver, and saves authenticated data if successful.
   * @param params - Object containing the encrypted file and password for decryption
   * @param params.encryptedFile - The encrypted recovery file
   * @param params.password - The password to decrypt the recovery file
   * @returns Promise resolving to true if authentication succeeded, false otherwise
   */
  static async loginWithEncryptedFile({ encryptedFile, password }: TLoginWithEncryptedFileParams): Promise<boolean> {
    const keypair = await Identity.decryptRecoveryFile({ encryptedFile, passphrase: password });
    return await this.signIn({ keypair });
  }

  /**
   * Destructive restore finalization, serialized across tabs (and against
   * same-tab sign-in completion) by the auth finalization lock
   * (`navigator.locks` name `pubky-auth-finalization-v1` is origin-scoped and
   * cross-tab; the in-process tail is only the no-Web-Locks fallback).
   *
   * The identity snapshot is re-read INSIDE the lock from `AUTH_PERSIST_KEY`
   * (cross-tab source of truth; Zustand is per-tab and is not storage-event
   * synced) and from the live store (same-tab QR). Cleanup is keyed to the
   * identity captured at restore start: a different persist-blob or live pubky
   * means that sign-in now owns origin-scoped Dexie, so this wipe no-ops. An
   * identity that was absent at capture time means a sign-in now owns the
   * private data: skip cleanup entirely and let the caller return signed-out.
   * Wiping here would erase that sign-in's private rows and the messaging
   * wrapping key, making its wrapped messaging state unrecoverable.
   *
   * `preservePublicCache` keeps the shared public browsing cache (catalog,
   * counts, TTLs): the no-identity path exists to drop orphaned PRIVATE
   * data, not public browsing residue.
   */
  private static async finalizeSignedOutUnderLock({
    captured,
    preservePublicCache,
  }: {
    captured: CapturedAuthIdentity;
    preservePublicCache: boolean;
  }): Promise<void> {
    await withAuthFinalizationLock(async () => {
      if (shouldSkipDestructiveCleanup(captured, useAuthStore.getState(), readPersistedAuthIdentity())) {
        // A skipped logout must not pin the winning identity in the
        // logging-out state: `init` preserves `isLoggingOut`, and skip
        // does not run `reset`. This `set()` is not persisted when
        // `AUTH_PERSIST_KEY` already holds a different pubky (owner fence).
        useAuthStore.getState().setIsLoggingOut(false);
        return;
      }
      await this.cleanupLocalState({ preservePublicCache });
    });
  }

  /**
   * Capture is outside the lock; clear + owner check run inside it. Returns
   * false (and does not clear) when a different identity now owns Dexie.
   */
  private static async takeLocalStateForCapturedIdentity(captured: CapturedAuthIdentity): Promise<boolean> {
    return await withAuthFinalizationLock(async () => {
      if (shouldSkipDestructiveCleanup(captured, useAuthStore.getState(), readPersistedAuthIdentity())) {
        return false;
      }
      this.pendingLocalStateCapture = captured;
      return true;
    });
  }

  /**
   * Persist `newPubky` under the same lock that serializes cleanup. No-ops
   * (returns false) when `AUTH_PERSIST_KEY` or the live store already holds a
   * third identity.
   */
  private static async persistIdentityUnderLock(
    newPubky: string,
    captured: CapturedAuthIdentity | null,
    persist: (prepare: () => Promise<void>) => void | boolean | Promise<void | boolean>,
  ): Promise<boolean> {
    return await withAuthFinalizationLock(async () => {
      const currentPubky = nonEmptyPubky(useAuthStore.getState().currentUserPubky);
      const persistedPubky = readPersistedAuthIdentity().pubky;
      if (shouldAbortIdentityPersist(captured, newPubky, currentPubky, persistedPubky)) {
        this.pendingLocalStateCapture = null;
        return false;
      }
      const prepare = async () => {
        if (captured?.pubky && captured.pubky !== newPubky) {
          await clearDatabase();
          useMigrationStore.getState().reset();
        }
        // Identity replacement is committed only after the new grant is saved.
        if (persistedPubky && persistedPubky !== newPubky) clearPersistedAuthIdentity();
      };
      if ((await persist(prepare)) === false) {
        this.pendingLocalStateCapture = null;
        return false;
      }
      // A sign-in replacing another account skips the sign-out cleanup, so
      // the account that left must not keep a bearer at rest here.
      if ([captured?.pubky ?? null, currentPubky, persistedPubky].some((pubky) => pubky && pubky !== newPubky)) {
        CommerceController.clearMarketplaceSessionsOfOtherAccounts(newPubky);
        MessagingApplication.clearMessagingSessionsOfOtherAccounts(newPubky);
        FirstContactApplication.clearOtherAccounts(newPubky);
      }
      this.markLocalStateDirty();
      this.pendingLocalStateCapture = null;
      return true;
    });
  }

  /**
   * Centralizes all local state cleanup: resets every Zustand store, clears Shop
   * IndexedDB, query cache, singletons, in-memory stream pagination queues, persisted localStorage keys,
   * and mute-sync `sessionStorage` cursors.
   * Used by both logout() and restorePersistedSession() on failure.
   *
   * With `preservePublicCache`, the SAME sequence runs but the database step
   * clears only private tables (`clearPrivateData`), keeping the shared
   * public catalog/browse cache — the no-identity restore path, where
   * orphaned private state must go but the marketplace grid's public rows
   * (and SSR→Dexie hydration) must survive. No step in the sequence touches
   * public-cache Dexie tables other than the database step itself.
   */
  private static async cleanupLocalState({
    preservePublicCache = false,
    preserveMessagingHistory = false,
    preserveServiceSessions = false,
    preservePrivateData = false,
    keepServicePubky = null,
  }: {
    preservePublicCache?: boolean;
    preserveMessagingHistory?: boolean;
    preserveServiceSessions?: boolean;
    preservePrivateData?: boolean;
    keepServicePubky?: Pubky | null;
  } = {}): Promise<void> {
    if (this.cleanupState.promise) {
      return await this.cleanupState.promise;
    }
    if (this.cleanupState.completed) {
      return;
    }
    this.cleanupState.promise = this.runCleanupLocalState({
      preservePublicCache,
      preserveMessagingHistory,
      preserveServiceSessions,
      preservePrivateData,
      keepServicePubky,
    }).finally(() => {
      this.cleanupState.promise = null;
    });
    await this.cleanupState.promise;
    this.cleanupState.completed = true;
  }

  private static async runCleanupLocalState({
    preservePublicCache,
    preserveMessagingHistory,
    preserveServiceSessions,
    preservePrivateData,
    keepServicePubky,
  }: {
    preservePublicCache: boolean;
    preserveMessagingHistory: boolean;
    preserveServiceSessions: boolean;
    preservePrivateData: boolean;
    keepServicePubky: Pubky | null;
  }) {
    BootstrapApplication.cancelModerationFollow();
    // Capture pubky before resetting auth store; used to scope marker cleanup.
    const pubky = useAuthStore.getState().currentUserPubky;
    if (pubky) {
      TagApplication.clearViewerMarkers(pubky);
    }

    // Mute-list SSE cursors live in sessionStorage; clear before the next account might reuse the same tab.
    clearMuteSyncCursorSessionStorage();
    // A stored post-sign-in return path belongs to the signed-out identity.
    clearRouteGuardReturnTo();

    // Reset singletons
    PubkySpecsSingleton.reset();
    // No marketplace bearer may stay at rest for the user who is leaving.
    if (keepServicePubky) CommerceController.clearMarketplaceSessionsOfOtherAccounts(keepServicePubky);
    else if (!preserveServiceSessions) CommerceController.clearMarketplaceSessionForSignOut();
    // Keep the newly active account's persisted messaging approval on another
    // frame's repeat cleanup, while dropping this frame's old live handles.
    if (keepServicePubky) MessagingApplication.clearMessagingSessionsOfOtherAccounts(keepServicePubky);
    else MessagingApplication.clearMessagingSession();
    // The mute list, known contacts and message counters belong to the signed-out identity.
    FirstContactApplication.clear();
    useMessagingStore.getState().clearMessagingEnabled();
    TtlCoordinator.resetInstance();
    StreamCoordinator.resetInstance();
    NotificationCoordinator.resetInstance();

    // Clear in-memory feed stream queues
    postStreamQueue.clear();

    this.cancelAllAuthFlows();

    // Cancel and clear all query clients (nexus, homegate, exchangerate, and any future ones)
    clearAllQueryClients();

    // Reset all Zustand stores.
    useOnboardingStore.getState().reset();
    // reset() rewrites the onboarding persist blob with nulled secrets; remove
    // the key outright so no onboarding residue (secret key, mnemonic, invite
    // code) survives at rest on a shared device.
    try {
      globalThis.localStorage?.removeItem(ONBOARDING_PERSIST_KEY);
    } catch {
      // Storage unavailable (private mode) — nothing could have persisted.
    }
    useAuthStore.getState().reset();
    useSignInStore.getState().reset();
    useLocalFilesStore.getState().reset();
    useCommerceStore.getState().reset();
    useHomeStore.getState().reset();
    useHotStore.getState().reset();
    useSearchStore.getState().reset();
    useNotificationStore.getState().reset();
    useSettingsStore.getState().reset();

    // The only step that differs between a full sign-out wipe and the
    // no-identity restore path: the latter keeps the public browse cache.
    if (!preservePrivateData) {
      if (preservePublicCache) {
        await clearPrivateData({ preserveMessagingHistory });
      } else {
        await clearDatabase({ preserveMessagingHistory });
      }
    }
    // Skip post-migration resync — full cleanup resets all state
    useMigrationStore.getState().reset();
  }

  /**
   * Generates an authentication URL for external authentication flows.
   * @returns Promise resolving to the generated authentication URL
   */
  static async getAuthUrl(): Promise<TGenerateAuthUrlResult> {
    return this.beginGrantCeremony(() => AuthApplication.generateGrantAuthUrl(), 'ring');
  }

  /**
   * Bitkit has its own grant QR slot beside Ring. The approved homeserver
   * grant is saved to BrowserSessionStore before it becomes active.
   */
  static async getGrantAuthUrl(): Promise<TGenerateAuthUrlResult> {
    return await this.beginGrantCeremony(() => AuthApplication.generateGrantAuthUrl(), 'bitkit');
  }

  /**
   * Pubky Passport sign-in ("Continue with Google"): the same Shop grant as
   * Bitkit, approved in the Passport popup. `xCallback` names the Shop's
   * Passport return page. Completion is the Bitkit grant ceremony; the
   * session is recorded as Passport-approved so its purchase grant is
   * requested from Passport too.
   */
  static async getPassportGrantAuthUrl(xCallback?: XCallbackParams): Promise<TGenerateAuthUrlResult> {
    return await this.beginGrantCeremony(() => AuthApplication.generateGrantAuthUrl(xCallback), 'passport');
  }

  private static async beginGrantCeremony(
    generate: () => Promise<TGenerateAuthUrlResult>,
    signer: GrantSigner,
  ): Promise<TGenerateAuthUrlResult> {
    this.assertStandaloneMode();
    // Retry only retired Shop records and abandoned Shop flow keys.
    await this.settlePendingGrantKeyCleanup();
    const epochAtStart = readAuthEpoch();
    BootstrapApplication.cancelModerationFollow();
    const captured = this.captureAuthIdentity();
    if (!(await this.takeLocalStateForCapturedIdentity(captured))) {
      throw createCanceledError();
    }
    const token = Symbol('grant-flow');
    this.cancelActiveGrantFlow(signer);
    this.activeGrantFlows.set(signer, { token, cancel: null });
    const generationAtStart = this.authFlowGeneration;
    const { authorizationUrl, awaitApproval, cancelAuthFlow } = await generate();

    const slot = this.activeGrantFlows.get(signer);
    if (!slot || slot.token !== token) {
      cancelAuthFlow();
      return { authorizationUrl, awaitApproval, cancelAuthFlow };
    }
    slot.cancel = cancelAuthFlow;

    const wrappedAwaitApproval = awaitApproval
      .finally(() => {
        if (this.activeGrantFlows.get(signer)?.token === token) {
          this.activeGrantFlows.delete(signer);
        }
        cancelAuthFlow();
      })
      .then(async (session) => {
        this.sessionFlowGeneration.set(session, generationAtStart);
        if (this.lostToAnotherSignIn(session)) {
          return await this.discardLosingApproval(session);
        }
        try {
          await AuthApplication.assertFullGrantSession(session);
        } catch (error) {
          await AuthApplication.logout({ session }).catch(() => {
            Logger.warn('Failed to retire an approval with insufficient homeserver permissions');
          });
          throw error;
        }
        this.grantEpochAtStart.set(session, epochAtStart);
        this.grantSignerBySession.set(session, signer);
        return session;
      });

    return { authorizationUrl, awaitApproval: wrappedAwaitApproval, cancelAuthFlow };
  }

  static isGrantSignInAvailable(): boolean {
    return AuthApplication.isGrantSignInAvailable();
  }

  static async getStepUpAuthUrl({
    signer = 'ring',
    xCallback,
  }: { signer?: 'ring' | 'bitkit' | 'passport'; xCallback?: XCallbackParams } = {}): Promise<TGenerateAuthUrlResult> {
    this.assertStandaloneMode();
    return this.beginGrantCeremony(() => AuthApplication.generateGrantAuthUrl(xCallback), signer);
  }

  /**
   * Identity gate for an externally-approved session on the step-up path: the
   * approval must widen the SIGNED-IN identity, never silently switch
   * accounts. On mismatch the wrong-identity session is signed back out and
   * the call rejects.
   *
   * A resting marketplace bearer is dropped only when it belongs to an
   * identity OTHER than the signed-in one — a bearer must never stay at rest
   * for an identity this device is not signed in as. The signed-in user's own
   * bearer is never touched: this gate runs inside the step-up ceremony
   * BEFORE the marketplace POST (so no wrong-identity bearer can have been
   * minted yet), where the only bearer at rest is the signed-in user's own
   * still-valid approval, and a mistaken scan must not destroy it. The same
   * guard is correct at the second call site — completeStepUpReauth for the
   * hook-driven completion, which runs AFTER the ceremony outcome (i.e. after
   * any marketplace mint): a bearer resting there for a different pubky than
   * the current identity is still dropped.
   */
  private static async assertStepUpSessionMatchesSignedInUser({ session }: THomeserverSessionResult): Promise<void> {
    const authStore = useAuthStore.getState();
    const approvedPubky = Identity.z32FromSession({ session });
    if (authStore.currentUserPubky && approvedPubky === authStore.currentUserPubky) return;
    const restingBearerPubky = useCommerceStore.getState().marketplaceSession?.pubky ?? null;
    if (restingBearerPubky !== authStore.currentUserPubky) {
      CommerceController.clearMarketplaceSession();
    }
    await AuthApplication.logout({ session }).catch((logoutError) => {
      Logger.warn('Failed to sign out a step-up session approved for a different identity', { logoutError });
    });
    throw Err.auth(
      AuthErrorCode.UNAUTHORIZED,
      'The approval was for a different identity. Reconnect only widens the permissions of the signed-in account.',
      {
        service: ErrorService.Homeserver,
        operation: 'completeStepUpReauth',
        context: { expectedPubky: authStore.currentUserPubky, approvedPubky },
      },
    );
  }

  /** Persist an approved same-account grant before swapping the active session. */
  static async completeStepUpReauth(
    { session }: THomeserverSessionResult,
    { releaseAuthFlow = true }: { releaseAuthFlow?: boolean } = {},
  ): Promise<void> {
    this.assertStandaloneMode();
    const current = useAuthStore.getState();
    const previousSession = current.session;
    const previousRecordId = current.grantSessionRecordId;
    const epoch = this.grantEpochAtStart.get(session);
    await this.assertStepUpSessionMatchesSignedInUser({ session });
    await AuthApplication.assertFullGrantSession(session);
    await AuthApplication.assertUserHomeserverAllowed({ publicKey: session.info.publicKey });
    await withAuthFinalizationLock(async () => {
      if (this.hostMode || useAuthStore.getState().session !== previousSession || epoch !== readAuthEpoch()) {
        await this.discardLosingApproval(session);
      }
      const recordId = await AuthApplication.saveGrantSession(session);
      if (this.hostMode || useAuthStore.getState().session !== previousSession || epoch !== readAuthEpoch()) {
        await AuthApplication.removeGrantSession(recordId);
        throw createCanceledError();
      }
      current.init({
        session,
        currentUserPubky: current.currentUserPubky,
        hasProfile: current.hasProfile,
        grantSessionRecordId: recordId,
        grantSigner: this.grantSignerBySession.get(session) ?? 'ring',
      });
      AuthApplication.commitGrantSession(recordId);
      if (previousRecordId && previousRecordId !== recordId) {
        await AuthApplication.removeGrantSession(previousRecordId);
      }
    });
    if (releaseAuthFlow) this.cancelAllAuthFlows();
  }

  /**
   * Generates a signup grant URL for Pubky Ring authorization.
   * @param inviteCode - The invite code for signup
   * @returns Promise resolving to the generated signup authentication URL
   */
  static async getSignupAuthUrl(inviteCode: string): Promise<TGenerateAuthUrlResult> {
    return this.beginGrantCeremony(() => AuthApplication.generateSignupAuthUrl(inviteCode), 'ring');
  }

  /**
   * Logs out the current user from both the homeserver and local application state.
   */
  static async logout() {
    if (this.hostMode) {
      requestShopHostAction('request-logout');
      return;
    }
    // Bump before any await so an in-flight restore (sharing the Application
    // singleton promise) can tell its restored-branch result is stale.
    this.logoutGeneration += 1;
    this.cancelAllAuthFlows();
    // An unanswered `#s=` prompt holds the shared restore this logout joins.
    this.answerSessionHandoff(false);
    // Set before any await so RouteGuard cannot re-bridge between cleanup and this flag.
    suppressVibeSessionAutoRestore();
    BootstrapApplication.cancelModerationFollow();
    // Captured before any await: a concurrent different-account sign-in must
    // be compared again inside the finalization lock so this logout cannot
    // wipe that account's origin-scoped Dexie.
    const captured = this.captureAuthIdentity();
    let authStore = useAuthStore.getState();
    const capturedRecordId = authStore.grantSessionRecordId;

    // Set logging out flag immediately to prevent flash of weird states in UI
    authStore.setIsLoggingOut(true);
    authStore.setSessionRestoreDeferred(false);

    let session = authStore.session;
    let signedOut = false;

    try {
      // Fresh loads can still have a persisted session export before the live session is restored.
      // Reuse the restore flow so /logout performs a real homeserver sign-out before local cleanup.
      if (!session && (authStore.sessionExport || authStore.grantSessionRecordId || isVibeSessionConsumerEnabled())) {
        let restoreResult: TRestorePersistedSessionResult;
        try {
          restoreResult = await this.restorePersistedSession();
        } catch (error) {
          // restorePersistedSession already cleaned up local state; a wrong-environment
          // rejection needs no toast here — the user asked to log out anyway.
          Logger.warn('Persisted session restore during logout failed; local state already cleaned up', { error });
          await this.removeSignedOutSessionsUnderLock(captured.pubky, capturedRecordId);
          signedOut = true;
          return;
        }
        if (restoreResult.status === 'signed-out') {
          await this.removeSignedOutSessionsUnderLock(captured.pubky, capturedRecordId);
          signedOut = true;
          return;
        }
        if (restoreResult.status === 'deferred') {
          Logger.warn('Homeserver logout failed, clearing local state anyway', {
            error: 'Session restore deferred; homeserver sign-out could not run',
          });
          await this.removeSignedOutSessionsUnderLock(captured.pubky, capturedRecordId);
          await this.finalizeSignedOutUnderLock({ captured, preservePublicCache: false });
          signedOut = true;
          return;
        }
        authStore = useAuthStore.getState();
        session = authStore.session;
      }

      if (session) {
        try {
          await AuthApplication.logout({ session });
        } catch (error) {
          Logger.warn('Homeserver logout failed, clearing local state anyway', { error });
        }
      }

      // After the homeserver sign-out (it needs the grant key) and before the
      // record pointer is cleared: a key that cannot be removed keeps the
      // pointer and fails the logout instead of reporting signed-out.
      await this.removeSignedOutSessionsUnderLock(captured.pubky, capturedRecordId);
      // Serialized with restore finalization and sign-in identity persists.
      // Cleanup is keyed to the identity captured at logout start: a
      // different live pubky means that sign-in now owns origin-scoped Dexie.
      await this.finalizeSignedOutUnderLock({ captured, preservePublicCache: false });
      signedOut = true;
    } finally {
      if (signedOut) {
        broadcastSignedOut();
      } else {
        useAuthStore.getState().setIsLoggingOut(false);
      }
      // The internal restore's init() clears the auto-restore suppression
      // set above. If the homeserver sign-out then failed, the marker must
      // not stay cleared: a later reload in consumer mode would
      // bridge-restore the session the user just logged out of. Guarded so
      // it is a no-op when consumer mode is off (no bridge leg exists).
      if (isVibeSessionConsumerEnabled()) {
        suppressVibeSessionAutoRestore();
      }
    }
  }

  /** Retire exact Shop records under the same lock as session finalization. */
  private static async removeSignedOutSessionsUnderLock(
    pubky: string | null,
    capturedRecordId: string | null,
  ): Promise<void> {
    await withAuthFinalizationLock(async () => {
      bumpAuthEpoch();
      const authState = useAuthStore.getState();
      await AuthApplication.clearGrantSessions({
        recordIds: [
          ...new Set(
            [
              capturedRecordId,
              authState.currentUserPubky === pubky ? authState.grantSessionRecordId : null,
              readPersistedAuthIdentity().pubky === pubky ? readPersistedGrantSessionRecordId() : null,
            ].filter((id): id is string => Boolean(id)),
          ),
        ],
        requireAvailable: Boolean(
          authState.grantSessionRecordId ||
          readPersistedGrantSessionRecordId() ||
          AuthApplication.isGrantSession(authState.session) ||
          isGrantKeyCleanupPending(),
        ),
      });
      if (pubky && readPersistedAuthIdentity().pubky === pubky) clearPersistedAuthIdentity();
    });
  }

  /** Retry targeted Shop cleanup obligations, retaining every failed marker. */
  static async settlePendingGrantKeyCleanup(): Promise<boolean> {
    if (this.hostMode) return true;
    try {
      return await withAuthFinalizationLock(async () => {
        if (this.hostMode) return true;
        await AuthApplication.clearGrantSessions({ requireAvailable: true });
        return !isGrantKeyCleanupPending();
      });
    } catch (error) {
      Logger.error('Grant keys left by a failed save are still stored; the cleanup is retried later', { error });
      return false;
    }
  }

  /**
   * Another tab signed out. A tab still holding a grant session in memory
   * signs it out and drops local state; cookie sessions are left alone.
   */
  static subscribeCrossTabSignOut(): () => void {
    return subscribeSignedOut(() => void this.handleCrossTabSignOut());
  }

  static async handleCrossTabSignOut(): Promise<void> {
    if (this.hostMode) return;
    this.logoutGeneration++;
    this.cancelAllAuthFlows();
    BootstrapApplication.cancelModerationFollow();
    const { session, grantSessionRecordId } = useAuthStore.getState();
    if (!AuthApplication.isGrantSession(session) || !session) return;
    const captured = this.captureAuthIdentity();
    useAuthStore.getState().setSession(null);
    await AuthApplication.logout({ session }).catch((error) => {
      Logger.warn('Cross-tab grant sign-out could not reach the homeserver', { error });
    });
    if (grantSessionRecordId) {
      try {
        // Only this tab's record: a newer sign-in in another tab keeps its key.
        await AuthApplication.removeGrantSession(grantSessionRecordId);
      } catch (error) {
        useAuthStore.getState().setSessionRestoreDeferred(true);
        Logger.error("Cross-tab sign-out could not remove this tab's grant key; retaining its cleanup reference", {
          error,
        });
        return;
      }
    }
    await this.finalizeSignedOutUnderLock({ captured, preservePublicCache: false });
  }

  /**
   * Initializes the application bootstrap after profile creation.
   * Waits for Nexus to index the user's profile.json, then bootstraps notifications and data.
   */
  static async bootstrapWithDelay() {
    const authStore = useAuthStore.getState();
    const pubky = authStore.selectCurrentUserPubky();
    const session = authStore.session;
    const generation = this.logoutGeneration;
    const isCurrent = () =>
      generation === this.logoutGeneration && useAuthStore.getState().session === session && Boolean(session);
    // Wait 5 seconds before bootstrap to let Nexus index the user
    Logger.info(`Waiting 5 seconds to index ${pubky} profile.json in Nexus before bootstrap...`);
    await sleep(5000);
    if (!isCurrent()) return;
    await this.hydrateMeImAlive({ pubky, isCurrent });
    if (!isCurrent()) return;
    authStore.setHasProfile(true);
  }

  /**
   * Syncs user settings with the homeserver.
   * Returns remote settings if newer, null otherwise.
   * All failures are treated as non-blocking and fall back to local settings.
   */
  private static async syncSettings(pubky: Pubky, localSettings: SettingsState): Promise<SettingsState | null> {
    try {
      return await SettingsApplication.initializeSettings(pubky, localSettings);
    } catch (error) {
      Logger.error('Failed to initialize settings during bootstrap', { error, pubky });
      return null;
    }
  }

  /**
   * Generates a signup token for user registration. This is just for testing environments
   * @returns Promise resolving to the generated signup token
   */
  static async generateSignupToken() {
    return await AuthApplication.generateSignupToken();
  }

  /**
   * Verifies an invite code (signup token) against the homeserver before applying it.
   * @param inviteCode - The invite code to verify
   * @returns `'valid'`, `'used'`, or `'invalid'` depending on the homeserver response
   */
  static async verifySignupToken(inviteCode: string) {
    return await AuthApplication.verifySignupToken(inviteCode);
  }
}
