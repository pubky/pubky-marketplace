'use client';

import { useEffect, useRef, useState } from 'react';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { BuyerPaykitWallet } from '@/libs/commerce/paykit-wallet';
import { Logger } from '@/libs/logger/logger';

/**
 * Whether the buyer can receive a Bitcoin payment request:
 * - `idle`: not checked (no buyer, or Bitcoin is not in play);
 * - `checking`: the initial or explicitly requested public Paykit read is in flight;
 * - `payable`: the buyer publishes a Paykit receiver that takes payment
 *   requests (a Paykit wallet such as Bitkit);
 * - `not_payable`: they publish none, so a Bitcoin Pay cannot succeed;
 * - `unsupported`: their wallet is Bitkit 2.6+, which the Shop's Paykit
 *   server cannot send a payment request to yet;
 * - `unverified`: the Paykit registry read failed, so Bitkit 2.6+ cannot be
 *   ruled out; Bitcoin Pay waits for a `recheck` that succeeds;
 * - `unknown`: the receiver-marker read failed after the registry ruled out
 *   Bitkit 2.6+; Pay is not blocked and the service answers.
 */
export type BuyerPaykitWalletState = 'idle' | 'checking' | BuyerPaykitWallet | 'unknown';

export function useBuyerPaykitWallet(buyerPubky: string | null, enabled: boolean, watch = false) {
  const [result, setResult] = useState<{ key: string; buyerPubky: string; state: BuyerPaykitWalletState } | null>(null);
  const [attempt, setAttempt] = useState({ id: 0, background: false });
  const key = enabled && buyerPubky ? `${buyerPubky}:${attempt.id}` : null;
  const inFlight = useRef<object | null>(null);

  useEffect(() => {
    // Deselection clears the verdict, so selecting Bitcoin again starts a fresh check.
    if (!key || !buyerPubky) {
      setResult(null);
      return;
    }
    setResult((previous) => (attempt.background && previous?.buyerPubky === buyerPubky ? previous : null));
    let active = true;
    const request = {};
    inFlight.current = request;
    void (async () => {
      try {
        const wallet = await CommerceController.fetchBuyerPaykitWallet(buyerPubky);
        if (active) setResult({ key, buyerPubky, state: wallet });
      } catch (error) {
        Logger.warn('Could not read the buyer Paykit wallet', { error });
        if (active) {
          setResult((previous) => ({
            key,
            buyerPubky,
            // A failed background read does not discard an established verdict.
            state: attempt.background && previous?.buyerPubky === buyerPubky ? previous.state : 'unknown',
          }));
        }
      } finally {
        if (inFlight.current === request) inFlight.current = null;
      }
    })();
    return () => {
      active = false;
      if (inFlight.current === request) inFlight.current = null;
    };
  }, [key, buyerPubky, attempt.background]);

  const state: BuyerPaykitWalletState = !key
    ? 'idle'
    : result?.buyerPubky === buyerPubky && (result.key === key || attempt.background)
      ? result.state
      : 'checking';

  useEffect(() => {
    if (!watch || !key || result?.key !== key || state === 'payable' || state === 'unsupported') return;
    let requested = false;
    const check = () => {
      if (document.visibilityState === 'hidden' || requested || inFlight.current) return;
      requested = true;
      setAttempt((current) => ({ id: current.id + 1, background: true }));
    };
    // Recheck after returning from Bitkit, or while waiting for its public wallet setup.
    const timer = window.setTimeout(check, 5000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [watch, key, state, result?.key]);

  return {
    state,
    recheck: () => {
      if (key && state !== 'checking' && !inFlight.current)
        setAttempt((current) => ({ id: current.id + 1, background: false }));
    },
  };
}
