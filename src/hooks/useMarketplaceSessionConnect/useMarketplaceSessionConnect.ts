'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CommerceController } from '@/controllers/commerce/commerce';
import { readGrantSigner } from '@/hooks/useGrantSigner/useGrantSigner';
import {
  marketplaceApprovalSigner,
  marketplaceSignerChoice,
} from '@/hooks/useMarketplaceApprovalSigner/useMarketplaceApprovalSigner';
import {
  MARKETPLACE_FAILURE_MESSAGES,
  marketplaceBootstrapFailureMessage,
  marketplaceFailureMessage,
} from '@/libs/commerce/failure-messages';
import { isAppError } from '@/libs/error/error';
import { ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { Logger } from '@/libs/logger/logger';
import { toSignerDeepLink } from '@/libs/navigation/bitkit-ios-url';
import { navigateTop } from '@/libs/navigation/navigate-top';
import {
  isPassportAttemptError,
  PassportAttemptError,
  type PassportAttemptFailure,
  startPassportAttempt,
} from '@/libs/passport/passport-popup';
import {
  getMarketplaceGrantFlowEnabled,
  getMarketplaceGrantSessionEnabled,
  getPassportOrigin,
  getPassportSignInEnabled,
} from '@/libs/runtime-config/runtime-config';
import { copyToClipboard } from '@/libs/utils/utils';
import { beginMarketplaceBootstrapFlow } from '@/services/marketplace/marketplace-bootstrap-client';
import { beginMarketplaceGrantFlow, type MarketplaceGrantFlow } from '@/services/marketplace/marketplace-grant-client';
import { MarketplaceSessionService } from '@/services/marketplace/marketplace-session';
import { useAuthStore } from '@/stores/auth/auth.store';
import type {
  MarketplaceSessionConnectStatus,
  UseMarketplaceSessionConnectOptions,
  UseMarketplaceSessionConnectReturn,
} from './useMarketplaceSessionConnect.types';

/** The signed-in grant supplies only the bootstrap proof, never a homeserver cookie. */
function signedInPubky(): string | null {
  const session = useAuthStore.getState().session;
  if (!session?.grant) return null;
  return session.info.publicKey.z32();
}

/** Copy for a Passport purchase approval that ended without a result. Null returns to idle silently. */
export const PASSPORT_GRANT_FAILURE_COPY: Record<PassportAttemptFailure, string | null> = {
  blocked: 'Your browser blocked the Pubky Passport window. Allow pop-ups for this site and try again.',
  busy: 'A Pubky Passport window is already open. Finish or close it, then try again.',
  cancelled: null,
  closed: null,
  failed: 'Pubky Passport could not approve the request. Try again.',
  timeout: null,
};

export function useMarketplaceSessionConnect(
  options: UseMarketplaceSessionConnectOptions = {},
): UseMarketplaceSessionConnectReturn {
  const authSession = useAuthStore((state) => state.session);
  const [status, setStatus] = useState<MarketplaceSessionConnectStatus>('idle');
  const [authorizationUrl, setAuthorizationUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOpeningRing, setIsOpeningRing] = useState(false);
  // First-paint copy must match the flow `start()` will pick: grant reconnect
  // only when a marketplace bearer already exists.
  const [requestsGrantReconnect, setRequestsGrantReconnect] = useState(
    () => getMarketplaceGrantFlowEnabled() && Boolean(MarketplaceSessionService.getActiveSession()),
  );
  const [requestsGrantBootstrap, setRequestsGrantBootstrap] = useState(
    () => getMarketplaceGrantFlowEnabled() && signedInPubky() !== null && !MarketplaceSessionService.getActiveSession(),
  );
  // A Passport approval opens a popup, which needs a click: `start()` only
  // arms it and `startPassport()` runs it.
  const preferredSigner = options.signer ?? marketplaceSignerChoice(readGrantSigner(useAuthStore.getState()));
  const selectedSigner = preferredSigner === 'passport' && !getPassportSignInEnabled() ? null : preferredSigner;
  const requiresSignIn = !authSession?.grant;
  const requestsPassport =
    getMarketplaceGrantFlowEnabled() && selectedSigner === 'passport' && getPassportSignInEnabled();
  const approvalSigner = marketplaceApprovalSigner(selectedSigner);
  const requiresSignerChoice = selectedSigner === null;
  /** The Passport approval `start()` prepared, waiting for the user's click. */
  const passportRunRef = useRef<(() => void) | null>(null);
  const activeGrantFlowRef = useRef<MarketplaceGrantFlow | null>(null);
  const generationRef = useRef(0);
  // Every approval shares one flow cookie per browser, and a cancel response clears it. A flow is
  // created only after the previous one's creation and cancel have settled, or it loses its binding.
  const flowCookieChainRef = useRef<Promise<void>>(Promise.resolve());
  const onConnectedRef = useRef(options.onConnected);
  const visibilityHandlerRef = useRef<(() => void) | null>(null);

  // Keep the latest callback without making `start` depend on its identity.
  useEffect(() => {
    onConnectedRef.current = options.onConnected;
  });

  const removeVisibilityHandler = useCallback(() => {
    if (visibilityHandlerRef.current) {
      document.removeEventListener('visibilitychange', visibilityHandlerRef.current);
      visibilityHandlerRef.current = null;
    }
  }, []);

  const detachActiveFlow = useCallback(() => {
    generationRef.current += 1;
    passportRunRef.current = null;
    const grantFlow = activeGrantFlowRef.current;
    activeGrantFlowRef.current = null;
    if (grantFlow) {
      flowCookieChainRef.current = flowCookieChainRef.current.then(() => grantFlow.cancel()).catch(() => undefined);
    }
  }, []);

  /** Holds a Passport approval until the user clicks; the dialog shows the Passport button meanwhile. */
  const armPassport = useCallback((run: () => void) => {
    passportRunRef.current = run;
    setAuthorizationUrl('');
    setStatus('idle');
  }, []);

  const grantFlowEnabled = getMarketplaceGrantFlowEnabled();
  const requestsFullGrant = false;

  const start = useCallback(() => {
    detachActiveFlow();
    removeVisibilityHandler();
    setIsOpeningRing(false);
    setErrorMessage(null);

    const generation = generationRef.current;

    const expectedSession = authSession;
    const expectedPubky = signedInPubky();
    const isCurrentIdentity = () =>
      useAuthStore.getState().session === expectedSession && signedInPubky() === expectedPubky;

    const startApproval = () => {
      if (!grantFlowEnabled || !expectedPubky) {
        setAuthorizationUrl('');
        setRequestsGrantReconnect(false);
        setRequestsGrantBootstrap(false);
        setErrorMessage(
          !expectedPubky
            ? 'Sign in again to connect the marketplace.'
            : 'Market approvals are unavailable on this deployment.',
        );
        setStatus('error');
        return;
      }
      if (!selectedSigner) {
        setAuthorizationUrl('');
        setStatus('idle');
        return;
      }

      const runGrantFlow = (
        begin: () => Promise<MarketplaceGrantFlow>,
        failureMessage: (code: string) => string,
        onSessionMissing?: () => void,
        viaPassport = false,
      ) => {
        setAuthorizationUrl('');
        setStatus('creating');
        let grantFlow: MarketplaceGrantFlow | null = null;
        const attach = async () => {
          const previous = flowCookieChainRef.current;
          let settle = () => {};
          flowCookieChainRef.current = new Promise<void>((resolve) => {
            settle = resolve;
          });
          try {
            await previous;
            const isStale = () => generationRef.current !== generation || !isCurrentIdentity();
            if (isStale()) throw new PassportAttemptError('cancelled');
            const flow = await begin();
            if (isStale()) {
              await flow.cancel();
              throw new PassportAttemptError('cancelled');
            }
            grantFlow = flow;
            activeGrantFlowRef.current = flow;
            setAuthorizationUrl(flow.authorizationUrl);
            setStatus('awaiting');
            return flow;
          } finally {
            settle();
          }
        };
        const settled = viaPassport
          ? startPassportAttempt(
              async () => {
                const flow = await attach();
                return { authorizationUrl: flow.authorizationUrl, result: flow.awaitResult(), cancel: flow.cancel };
              },
              { passportOrigin: getPassportOrigin() },
            )
          : attach().then((flow) => flow.awaitResult());
        void settled
          .then(async (result) => {
            if (
              generationRef.current !== generation ||
              !isCurrentIdentity() ||
              activeGrantFlowRef.current !== grantFlow
            )
              return;
            activeGrantFlowRef.current = null;
            setAuthorizationUrl('');
            if (result.status === 'connected') {
              if (!result.token || !result.pubky || result.capabilities === undefined || !result.expires_at) {
                throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'grant_invalid_response', {
                  service: ErrorService.Marketplace,
                  operation: 'marketplaceApproval',
                });
              }
              if (!expectedPubky) {
                throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'grant_invalid_response', {
                  service: ErrorService.Marketplace,
                  operation: 'marketplaceApproval',
                });
              }
              if (result.pubky !== expectedPubky) {
                setStatus('mismatch');
                return;
              }
              let session;
              try {
                session = MarketplaceSessionService.establishClaimedGrantSession(
                  {
                    token: result.token,
                    pubky: result.pubky,
                    capabilities: result.capabilities,
                    expiresAt: result.expires_at,
                  },
                  expectedPubky,
                );
              } catch (error) {
                if (!isAppError(error) || error.category !== ErrorCategory.Validation) throw error;
                setErrorMessage(error.message);
                setStatus('error');
                return;
              }
              CommerceController.writeMarketplaceSessionStore(session);
              setStatus('connected');
              onConnectedRef.current?.(session);
              return;
            }
            if (result.status === 'mismatch') setStatus('mismatch');
            else if (result.status === 'expired') setStatus('expired');
            else if (result.status === 'cancelled') setStatus('cancelled');
            else {
              setErrorMessage(failureMessage('approval_invalid'));
              setStatus('error');
            }
          })
          .catch((error: unknown) => {
            if (generationRef.current !== generation || !isCurrentIdentity()) return;
            activeGrantFlowRef.current = null;
            setAuthorizationUrl('');
            if (isPassportAttemptError(error)) {
              if (error.reason === 'timeout') {
                setStatus('expired');
                return;
              }
              const message = PASSPORT_GRANT_FAILURE_COPY[error.reason];
              if (!message) {
                setStatus(error.reason === 'cancelled' ? 'cancelled' : 'idle');
                return;
              }
              setErrorMessage(message);
              setStatus('error');
              return;
            }
            const code = error instanceof Error ? error.message : '';
            if ((code === 'shop_session_missing' || code === 'shop_session_expired') && onSessionMissing) {
              Logger.warn('Marketplace grant reconnect needs a session; starting a new approval', { code });
              onSessionMissing();
              return;
            }
            if (!isAppError(error)) Logger.error('Marketplace grant flow failed', { error });
            setErrorMessage(failureMessage(code));
            setStatus('error');
          });
      };

      const viaPassport = selectedSigner === 'passport';
      if (viaPassport && !getPassportSignInEnabled()) {
        // Passport is switched off: no approval of any kind starts for this sign-in.
        setAuthorizationUrl('');
        setStatus('idle');
        return;
      }

      // With the grant flow on, every signed-in purchase approval is a
      // `signin_grant` link, which Bitkit and Pubky Ring 2.0+ both approve.
      // The browser writes a single-use proof using its active grant.
      const bootstrapPubky = signedInPubky();
      const runBootstrap = (pubky: string) => {
        setRequestsGrantReconnect(false);
        setRequestsGrantBootstrap(true);
        runGrantFlow(
          () => beginMarketplaceBootstrapFlow({ pubky }),
          (code) => marketplaceBootstrapFailureMessage(code, marketplaceApprovalSigner(selectedSigner)),
          undefined,
          viaPassport,
        );
      };
      if (grantFlowEnabled && bootstrapPubky && !MarketplaceSessionService.getActiveSession()) {
        setRequestsGrantReconnect(false);
        setRequestsGrantBootstrap(true);
        if (viaPassport) {
          armPassport(() => runBootstrap(bootstrapPubky));
          return;
        }
        runBootstrap(bootstrapPubky);
        return;
      }

      // Reconnect grant cannot mint a first session: BFF createFlow requires a
      // paired cookie. When the BFF has none, the bootstrap mints the session
      // instead of opening a grant that 401s locally as "expired". A Passport
      // reconnect needs a fresh click for the bootstrap popup, so it ends with
      // the failure copy instead.
      if (grantFlowEnabled && MarketplaceSessionService.getActiveSession()) {
        setRequestsGrantBootstrap(false);
        setRequestsGrantReconnect(true);
        const onSessionMissing = viaPassport
          ? undefined
          : bootstrapPubky
            ? () => runBootstrap(bootstrapPubky)
            : undefined;
        const runReconnect = () =>
          runGrantFlow(
            beginMarketplaceGrantFlow,
            (code) => marketplaceFailureMessage(code, MARKETPLACE_FAILURE_MESSAGES.sessionStart),
            onSessionMissing,
            viaPassport,
          );
        if (viaPassport) {
          armPassport(runReconnect);
          return;
        }
        runReconnect();
        return;
      }

      setStatus('error');
      setErrorMessage('Sign in again to connect the marketplace.');
    };

    // The sign-in grant can mint the session itself; the approval is only the fallback.
    if (getMarketplaceGrantSessionEnabled() && expectedPubky && !MarketplaceSessionService.getActiveSession()) {
      setAuthorizationUrl('');
      setStatus('creating');
      void CommerceController.ensureMarketplaceSessionFromGrant({ retryAfterFailure: true })
        .catch(() => null)
        .then((session) => {
          if (generationRef.current !== generation || !isCurrentIdentity()) return;
          if (!session) {
            startApproval();
            return;
          }
          setStatus('connected');
          onConnectedRef.current?.(session);
        });
      return;
    }
    startApproval();
  }, [armPassport, authSession, detachActiveFlow, grantFlowEnabled, removeVisibilityHandler, selectedSigner]);

  /**
   * Runs the armed Pubky Passport approval. Call it from the click handler
   * itself: the popup must open before any await.
   */
  const startPassport = useCallback(() => {
    const run = passportRunRef.current;
    if (!run) return;
    passportRunRef.current = null;
    setErrorMessage(null);
    run();
  }, []);

  const cancel = useCallback(() => {
    detachActiveFlow();
    removeVisibilityHandler();
    setIsOpeningRing(false);
    setAuthorizationUrl('');
    setErrorMessage(null);
    setStatus('idle');
  }, [detachActiveFlow, removeVisibilityHandler]);

  const copyAuthUrl = useCallback(async () => {
    if (!authorizationUrl) return;
    await copyToClipboard({ text: authorizationUrl });
  }, [authorizationUrl]);

  const openInRing = useCallback(() => {
    if (!authorizationUrl) return;
    removeVisibilityHandler();
    setIsOpeningRing(true);
    const onVisibilityChange = () => {
      if (document.hidden) {
        removeVisibilityHandler();
        setIsOpeningRing(false);
      }
    };
    visibilityHandlerRef.current = onVisibilityChange;
    document.addEventListener('visibilitychange', onVisibilityChange, { once: true });
    navigateTop(toSignerDeepLink(authorizationUrl, selectedSigner));
  }, [authorizationUrl, removeVisibilityHandler, selectedSigner]);

  useEffect(() => {
    // Account switches and replacement sessions retire pending service approvals.
    cancel();
  }, [authSession, cancel]);

  useEffect(() => {
    return () => {
      // Unmount cancels outright: unlike sign-in, nothing global consumes the
      // approval — without a mounted dialog the session would connect
      // invisibly, and the single-use flow is cheap to restart.
      detachActiveFlow();
      removeVisibilityHandler();
    };
  }, [detachActiveFlow, removeVisibilityHandler]);

  return {
    status,
    authorizationUrl,
    errorMessage,
    requestsFullGrant,
    requestsGrantReconnect,
    requestsGrantBootstrap,
    requestsPassport,
    approvalSigner,
    requiresSignerChoice,
    requiresSignIn,
    start,
    startPassport,
    cancel,
    copyAuthUrl,
    openInRing,
    isOpeningRing,
  };
}
