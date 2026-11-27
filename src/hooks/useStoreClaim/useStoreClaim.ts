'use client';

import { useEffect, useRef, useState } from 'react';
import { isStoreModeInsecureContext } from '@/config/store-mode';
import { AuthController } from '@/controllers/auth/auth';
import { CommerceController } from '@/controllers/commerce/commerce';
import { StoreClaimController } from '@/controllers/store-claim/store-claim';
import { useUserDetails } from '@/hooks/useUserDetails/useUserDetails';
import { isAppError } from '@/libs/error/error';
import { ErrorCategory } from '@/libs/error/error.types';
import { getRetryAfter, hasHttpStatus } from '@/libs/error/error.utils';
import { Logger } from '@/libs/logger/logger';
import { groupPubky } from '@/libs/store-claim/format-pubky';
import {
  clearStoreClaimCode,
  isValidStoreClaimCode,
  normalizeStoreClaimCode,
  readStoreClaimCode,
  saveStoreClaimCode,
} from '@/libs/store-claim/store-claim-code';
import { markStoreClaimNavigation, navigateToClaimedStudio } from '@/libs/store-claim/store-claim-navigation';
import { useAuthStore } from '@/stores/auth/auth.store';

export type StoreClaimNotice = {
  message: string;
  retryAfterSeconds?: number;
  refusal?: boolean;
  capability?: boolean;
  retry?: 'mint' | 'claim';
};

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryMessage(seconds: number | undefined): string {
  return seconds === undefined
    ? 'Try again shortly.'
    : `Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;
}

function grantRefusal(reason: string): StoreClaimNotice {
  Logger.error('Shop claim sign-in was refused', { reason });
  return {
    message: 'This shop is not set up to sign in. Use a different identity or ask whoever runs it to check the setup.',
    refusal: true,
  };
}

function mintFailure(error: unknown): StoreClaimNotice {
  if (hasHttpStatus(error, 429)) {
    const retryAfterSeconds = isAppError(error) ? getRetryAfter(error) : undefined;
    return {
      message: `The order service is busy. ${retryMessage(retryAfterSeconds)}`,
      retryAfterSeconds,
      retry: 'mint',
    };
  }
  if (
    hasHttpStatus(error, 503) ||
    (isAppError(error) && (error.category === ErrorCategory.Network || error.category === ErrorCategory.Timeout))
  ) {
    const retryAfterSeconds = isAppError(error) ? getRetryAfter(error) : undefined;
    return {
      message: `Your homeserver could not be reached. ${retryMessage(retryAfterSeconds)}`,
      retryAfterSeconds,
      retry: 'mint',
    };
  }
  return grantRefusal(isAppError(error) ? error.message : 'unknown');
}

export function useStoreClaim() {
  const pubky = useAuthStore((state) => state.currentUserPubky);
  const hasSession = useAuthStore((state) => Boolean(state.session));
  const { userDetails } = useUserDetails(pubky);
  const [code, setCode] = useState(() => normalizeStoreClaimCode(readStoreClaimCode()));
  const [notice, setNotice] = useState<StoreClaimNotice | null>(null);
  const [minting, setMinting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mintAttempt, setMintAttempt] = useState(0);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [pollFinished, setPollFinished] = useState(false);
  const successRef = useRef(false);

  const insecureContext = isStoreModeInsecureContext();
  const validCode = isValidStoreClaimCode(code);

  useEffect(() => {
    if (retryAt === null) return;
    const timer = window.setTimeout(() => setRetryAt(null), Math.max(0, retryAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [retryAt]);

  useEffect(() => {
    successRef.current = claimed;
  }, [claimed]);

  useEffect(
    () => () => {
      if (successRef.current) clearStoreClaimCode();
    },
    [],
  );

  useEffect(() => {
    if (!pubky || !hasSession || insecureContext) return;
    let active = true;
    setMinting(true);
    setNotice(null);
    CommerceController.ensureMarketplaceSessionFromGrant({ retryAfterFailure: true, throwOnFailure: true })
      .then((session) => {
        if (active && !session) setNotice(grantRefusal('grant_session_unavailable'));
      })
      .catch((error: unknown) => {
        if (!active) return;
        const failure = mintFailure(error);
        setNotice(failure);
        if (failure.retryAfterSeconds !== undefined) {
          setRetryAt(Date.now() + failure.retryAfterSeconds * 1_000);
        }
      })
      .finally(() => {
        if (active) setMinting(false);
      });
    return () => {
      active = false;
    };
  }, [pubky, hasSession, insecureContext, mintAttempt]);

  const updateCode = (value: string) => {
    const normalized = normalizeStoreClaimCode(value);
    setCode(normalized);
    setNotice((current) => (current?.refusal || current?.retry === 'mint' ? current : null));
    if (isValidStoreClaimCode(normalized)) saveStoreClaimCode(normalized);
  };

  const retryMint = () => {
    setNotice(null);
    setRetryAt(null);
    setMintAttempt((attempt) => attempt + 1);
  };

  const useDifferentIdentity = async () => {
    clearStoreClaimCode();
    setCode('');
    setNotice(null);
    await AuthController.logout();
  };

  const finish = async () => {
    clearStoreClaimCode();
    setClaimed(true);
    setPollFinished(false);
    await StoreClaimController.fetchStoreState(true).catch(() => null);
    let claimedAnswers = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await wait(1_000);
      const state = await StoreClaimController.fetchStoreState().catch(() => null);
      claimedAnswers = state?.kind === 'claimed' && state.seller === pubky ? claimedAnswers + 1 : 0;
      if (claimedAnswers >= 2) {
        markStoreClaimNavigation();
        navigateToClaimedStudio();
        return;
      }
    }
    setPollFinished(true);
  };

  const submit = async () => {
    if (!pubky || !validCode || retryAt !== null) return;
    setSubmitting(true);
    setNotice(null);
    try {
      let freshMint = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await StoreClaimController.claim(code, pubky);
        if (result.kind === 'success') {
          await finish();
          return;
        }
        if (result.kind === 'invalid-code') {
          setNotice({ message: 'That setup code is not right. Check it and try again.' });
          return;
        }
        if (result.kind === 'stale-session') {
          setNotice({ message: 'For safety, sign in again to confirm.' });
          await AuthController.logout();
          return;
        }
        if (result.kind === 'session-capability') {
          setNotice({
            message: 'This sign-in cannot claim the shop. Sign in again with Pubky Ring.',
            capability: true,
          });
          return;
        }
        if (result.kind === 'session-source') {
          if (freshMint) {
            Logger.error('Shop claim sign-in was refused', { reason: 'claim_session_source' });
            setNotice({ message: 'This shop is not set up to sign in.', refusal: true });
            return;
          }
          freshMint = true;
          CommerceController.clearMarketplaceSession();
          const session = await CommerceController.ensureMarketplaceSessionFromGrant({
            retryAfterFailure: true,
            throwOnFailure: true,
            forceFresh: true,
          });
          if (!session) {
            setNotice(grantRefusal('grant_session_unavailable'));
            return;
          }
          continue;
        }
        if (result.kind === 'already-claimed') {
          clearStoreClaimCode();
          const state = await StoreClaimController.fetchStoreState().catch(() => null);
          if (state?.kind === 'claimed' && state.seller === pubky) {
            await finish();
            return;
          }
          const seller = state?.kind === 'claimed' ? state.seller : result.seller;
          setNotice({
            message: `This shop has already been claimed by ${seller ? groupPubky(seller) : 'another identity'}. If that was not you, ask whoever runs this shop to release the claim (./solo claim-release, or redeploy with a fresh database if nothing has been sold).`,
          });
          return;
        }
        setNotice({
          message: `The order service could not complete the claim. ${retryMessage(result.retryAfterSeconds)}`,
          retryAfterSeconds: result.retryAfterSeconds,
          retry: 'claim',
        });
        if (result.retryAfterSeconds !== undefined) {
          setRetryAt(Date.now() + result.retryAfterSeconds * 1_000);
        }
        return;
      }
    } catch (error) {
      if (freshMintFailure(error)) {
        const failure = mintFailure(error);
        setNotice(failure);
        if (failure.retryAfterSeconds !== undefined) setRetryAt(Date.now() + failure.retryAfterSeconds * 1_000);
      } else {
        setNotice({
          message: 'The order service could not be reached. Try again with the same setup code.',
          retry: 'claim',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return {
    code,
    updateCode,
    validCode,
    pubky: hasSession ? pubky : null,
    profileName: userDetails?.name ?? null,
    profileImage: userDetails?.image ?? null,
    insecureContext,
    notice,
    busy: minting || submitting,
    claimed,
    pollFinished,
    retryDisabled: retryAt !== null,
    submit,
    retryMint,
    useDifferentIdentity,
    continueToStudio: () => {
      markStoreClaimNavigation();
      navigateToClaimedStudio();
    },
  };
}

function freshMintFailure(error: unknown): boolean {
  return isAppError(error) && error.operation === 'marketplaceGrantSession';
}
