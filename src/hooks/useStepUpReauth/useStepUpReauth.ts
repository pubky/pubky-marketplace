'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthController } from '@/controllers/auth/auth';
import { useGrantSigner } from '@/hooks/useGrantSigner/useGrantSigner';
import {
  marketplaceApprovalSigner,
  marketplaceSignerChoice,
} from '@/hooks/useMarketplaceApprovalSigner/useMarketplaceApprovalSigner';
import { getErrorMessage } from '@/libs/error/error.utils';
import { Logger } from '@/libs/logger/logger';
import { navigateTop } from '@/libs/navigation/navigate-top';
import {
  isPassportAttemptError,
  PassportAttemptError,
  passportCallbacks,
  startPassportAttempt,
} from '@/libs/passport/passport-popup';
import { getPassportOrigin } from '@/libs/runtime-config/runtime-config';
import { requestShopHostAction } from '@/libs/shop-session/bridge';
import { copyToClipboard } from '@/libs/utils/utils';
import { AUTH_FLOW_CANCELED_ERROR_NAME } from '@/services/homeserver/error.utils';
import type { TGenerateAuthUrlResult } from '@/services/homeserver/homeserver.types';
import type { StepUpReauthStatus, UseStepUpReauthOptions, UseStepUpReauthReturn } from './useStepUpReauth.types';

type ActiveFlow = TGenerateAuthUrlResult;

/**
 * Drives the step-up re-approval that widens a narrow (bridged or legacy)
 * session grant to the app's full `CAPABILITIES`
 * (docs/ecommerce/step-up-approval.md, Option C). Shared by every
 * scope-gated affordance (watchlist sync, portable receipts).
 *
 * NEVER auto-started: `start()` runs only from the explicit reconnect CTA —
 * a bridged restore, browsing, publishing, and checkout must not trigger a
 * widened-grant approval on their own.
 *
 * Mirrors useMarketplaceSessionConnect's lifecycle: a fresh single-use
 * `pubkyauth://` URL per attempt, cancellation detected by identity (a
 * rejection from a detached flow is control flow, not a failure), and the
 * flow is freed on unmount. On approval the controller swaps the auth-store
 * session for the widened one, so watchlist sync, receipts, and messaging
 * other homeserver writes become capable without a reload.
 */
export function useStepUpReauth(options: UseStepUpReauthOptions = {}): UseStepUpReauthReturn {
  const grantSigner = useGrantSigner();
  const signer = options.signer ?? marketplaceSignerChoice(grantSigner) ?? (grantSigner === null ? 'ring' : null);
  const requestsPassport = signer === 'passport';
  const passportRunRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<StepUpReauthStatus>('idle');
  const [authorizationUrl, setAuthorizationUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOpeningRing, setIsOpeningRing] = useState(false);
  const activeFlowRef = useRef<ActiveFlow | null>(null);
  const startGenerationRef = useRef(0);
  const onReauthenticatedRef = useRef(options.onReauthenticated);
  const visibilityHandlerRef = useRef<(() => void) | null>(null);

  // Keep the latest callback without making `start` depend on its identity.
  useEffect(() => {
    onReauthenticatedRef.current = options.onReauthenticated;
  });

  const removeVisibilityHandler = useCallback(() => {
    if (visibilityHandlerRef.current) {
      document.removeEventListener('visibilitychange', visibilityHandlerRef.current);
      visibilityHandlerRef.current = null;
    }
  }, []);

  const detachActiveFlow = useCallback(() => {
    passportRunRef.current = null;
    const flow = activeFlowRef.current;
    activeFlowRef.current = null;
    // Route through the controller: when this flow is still the tracked
    // active flow, the ceremony guard is torn down with it, so a retry mints
    // a FRESH single-use URL instead of joining the cancelled ceremony and
    // re-showing its dead QR. When another flow already superseded this one,
    // only this stale handle is freed.
    if (flow) AuthController.releaseAuthFlow(flow.cancelAuthFlow);
  }, []);

  const start = useCallback(() => {
    detachActiveFlow();
    removeVisibilityHandler();
    setIsOpeningRing(false);
    setErrorMessage(null);
    setAuthorizationUrl('');
    const generation = ++startGenerationRef.current;
    if (requestShopHostAction('request-capabilities')) {
      setStatus('awaiting-host');
      return;
    }
    setStatus('starting');

    if (!signer) {
      setStatus('idle');
      return;
    }

    const run = () => {
      setStatus('starting');
      const create = async () => {
        const flow = await AuthController.getStepUpAuthUrl({
          signer,
          ...(requestsPassport ? { xCallback: passportCallbacks(window.location.origin) } : {}),
        });
        if (startGenerationRef.current !== generation) {
          AuthController.releaseAuthFlow(flow.cancelAuthFlow);
          return null;
        }
        activeFlowRef.current = flow;
        setAuthorizationUrl(flow.authorizationUrl);
        setStatus('awaiting');
        return flow;
      };
      const approval = requestsPassport
        ? startPassportAttempt(
            async () => {
              const flow = await create();
              if (!flow) throw new PassportAttemptError('cancelled');
              return {
                authorizationUrl: flow.authorizationUrl,
                result: flow.awaitApproval,
                cancel: () => AuthController.releaseAuthFlow(flow.cancelAuthFlow),
              };
            },
            { passportOrigin: getPassportOrigin() },
          )
        : create().then((flow) => flow?.awaitApproval);
      void approval
        .then(async (session) => {
          if (!session || startGenerationRef.current !== generation) return;
          await AuthController.completeStepUpReauth({ session });
          if (startGenerationRef.current !== generation) return;
          activeFlowRef.current = null;
          setAuthorizationUrl('');
          setStatus('reauthenticated');
          try {
            await onReauthenticatedRef.current?.();
          } catch (error) {
            Logger.warn('Post-re-authentication refresh failed', { error });
          }
        })
        .catch((error: unknown) => {
          if (startGenerationRef.current !== generation) return;
          activeFlowRef.current = null;
          setAuthorizationUrl('');
          if (
            (typeof error === 'object' &&
              error !== null &&
              'name' in error &&
              error.name === AUTH_FLOW_CANCELED_ERROR_NAME) ||
            (isPassportAttemptError(error) && ['cancelled', 'closed', 'busy'].includes(error.reason))
          ) {
            setStatus('idle');
            return;
          }
          setErrorMessage(
            isPassportAttemptError(error) && error.reason === 'blocked'
              ? 'Your browser blocked the Pubky Passport window. Allow pop-ups for this site and try again.'
              : getErrorMessage(error),
          );
          setStatus('error');
        });
    };
    if (requestsPassport) {
      passportRunRef.current = run;
      setStatus('idle');
      return;
    }
    run();
  }, [detachActiveFlow, removeVisibilityHandler, signer, requestsPassport]);

  const startPassport = () => {
    const run = passportRunRef.current;
    passportRunRef.current = null;
    run?.();
  };

  const cancel = useCallback(() => {
    startGenerationRef.current += 1;
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
    navigateTop(authorizationUrl);
  }, [authorizationUrl, removeVisibilityHandler]);

  useEffect(() => {
    return () => {
      // Unmount cancels outright (same tradeoff as the marketplace session
      // connect): without a mounted affordance the widening would complete
      // invisibly, and the single-use flow is cheap to restart.
      startGenerationRef.current += 1;
      detachActiveFlow();
      removeVisibilityHandler();
    };
  }, [detachActiveFlow, removeVisibilityHandler]);

  return {
    status,
    authorizationUrl,
    errorMessage,
    start,
    startPassport,
    requestsPassport,
    requiresSignerChoice: signer === null,
    signerName: marketplaceApprovalSigner(signer),
    cancel,
    copyAuthUrl,
    openInRing,
    isOpeningRing,
  };
}
