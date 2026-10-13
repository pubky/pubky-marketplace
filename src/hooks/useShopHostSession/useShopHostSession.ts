'use client';

import { useEffect, useRef, useState } from 'react';
import { AuthController } from '@/controllers/auth/auth';
import { getEmbeddedFlag, getFrameAncestors } from '@/libs/runtime-config/runtime-config';
import {
  getShopHostWindow,
  parseShopHostSession,
  requestShopHostAction,
  type ShopHostSnapshot,
  shopWrapperReturnPath,
} from '@/libs/shop-session/bridge';
import { useAuthStore } from '@/stores/auth/auth.store';

export type ShopHostStatus = ShopHostSnapshot['status'] | 'connecting' | 'capabilities-required';

/** Establish ownership before mounting anything that can restore a standalone Shop session. */
export function useShopHostSession() {
  // Preserve public SSR when this deployment cannot host a session bridge. Runtime
  // settings are identical on server/client; browser frame detection happens only below.
  const [configured, setConfigured] = useState(() => !getEmbeddedFlag() && getFrameAncestors().length === 0);
  const [hosted, setHosted] = useState(false);
  const [status, setStatus] = useState<ShopHostStatus>('connecting');
  const [attempt, setAttempt] = useState(0);
  const latestMessage = useRef(0);
  const lastSnapshotKey = useRef<string | null>(null);
  const showSignInDialog = useAuthStore((state) => state.showSignInDialog);

  useEffect(() => {
    const returnPath = shopWrapperReturnPath();
    if (returnPath) {
      window.location.replace(returnPath);
      return;
    }
    const enabled = Boolean(getShopHostWindow());
    AuthController.setHostSessionMode(enabled);
    setHosted(enabled);
    setConfigured(true);
    if (!enabled) return;

    setStatus('connecting');
    lastSnapshotKey.current = null;
    let disposed = false;
    let received = false;
    const receive = (event: MessageEvent) => {
      const snapshot = parseShopHostSession(event);
      if (!snapshot) return;
      received = true;
      clearInterval(retry);
      const key = JSON.stringify(snapshot);
      // App store updates unrelated to auth must not remount Shop or cancel a purchase approval.
      if (lastSnapshotKey.current === key) return;
      lastSnapshotKey.current = key;
      const sequence = ++latestMessage.current;
      // Logout can wait for serialized bootstrap/cleanup. Do not remount guest
      // consumers against the previous account's private state before it settles.
      setStatus(snapshot.status === 'ready' || snapshot.status === 'signed-out' ? 'restoring' : snapshot.status);
      void AuthController.applyHostSession(snapshot).then(
        (result) => {
          if (!disposed && sequence === latestMessage.current) setStatus(result);
        },
        () => {
          if (!disposed && sequence === latestMessage.current) {
            lastSnapshotKey.current = null;
            setStatus('temporary-error');
          }
        },
      );
    };
    window.addEventListener('message', receive);
    // Parent and child effects can initialize in either order. Retry only the public handshake.
    const retry = setInterval(() => requestShopHostAction('ready'), 500);
    const timeout = setTimeout(() => {
      clearInterval(retry);
      if (!received) setStatus('temporary-error');
    }, 10_000);
    requestShopHostAction('ready');
    return () => {
      disposed = true;
      latestMessage.current += 1;
      clearInterval(retry);
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
      // Do not turn a detached consumer into a standalone owner during React effect cleanup.
    };
  }, [attempt]);

  useEffect(() => {
    if (!hosted || !showSignInDialog) return;
    useAuthStore.getState().setShowSignInDialog(false);
    requestShopHostAction('request-login');
  }, [hosted, showSignInDialog]);

  return { configured, hosted, status, retry: () => setAttempt((value) => value + 1) };
}
