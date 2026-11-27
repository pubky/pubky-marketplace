import { cache } from 'react';
import {
  escapeForInlineScript,
  getStoreMode,
  getStoreSeller as getConfiguredStoreSeller,
} from '@/libs/runtime-config/runtime-config';

export type StoreState =
  | { kind: 'off' }
  | { kind: 'unclaimed'; claimMode: true }
  | { kind: 'unavailable'; claimMode: true }
  | { kind: 'claimed'; seller: string; source: 'pinned' | 'claim'; claimMode: boolean };

export const STORE_STATE_WINDOW_KEY = '__PUBKY_STORE__';

declare global {
  interface Window {
    [STORE_STATE_WINDOW_KEY]?: unknown;
  }
}

const PUBKY_PATTERN = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/;
const getRenderState = cache((): { value?: StoreState } => ({}));
let testState: StoreState | undefined;

/** Called by the root layout within the server render that resolved the state. */
export function setStoreStateForRender(state: StoreState): void {
  getRenderState().value = state;
}

export function setStoreStateForTests(state: StoreState | undefined): void {
  testState = state;
}

function readInjectedState(): StoreState {
  const unavailable: StoreState = { kind: 'unavailable', claimMode: true };
  const value = window[STORE_STATE_WINDOW_KEY];
  if (typeof value !== 'object' || value === null || !('kind' in value)) return unavailable;
  const injected = value as {
    kind?: unknown;
    seller?: unknown;
    source?: unknown;
    claimMode?: unknown;
  };
  if (injected.kind === 'unclaimed' || injected.kind === 'unavailable') {
    return injected.claimMode === true &&
      (injected.seller === null || injected.seller === undefined) &&
      (injected.source === null || injected.source === undefined)
      ? { kind: injected.kind, claimMode: true }
      : unavailable;
  }
  if (
    injected.kind === 'claimed' &&
    typeof injected.seller === 'string' &&
    PUBKY_PATTERN.test(injected.seller) &&
    injected.source === 'claim' &&
    injected.claimMode === true
  ) {
    return { kind: 'claimed', seller: injected.seller, source: 'claim', claimMode: true };
  }
  return unavailable;
}

/** The state for this server render, or the state the layout injected in the browser. */
export function getStoreState(): StoreState {
  if (testState !== undefined) return testState;
  const configuredSeller = getConfiguredStoreSeller();
  if (configuredSeller !== undefined) {
    return { kind: 'claimed', seller: configuredSeller, source: 'pinned', claimMode: false };
  }
  if (getStoreMode() !== 'single_seller') return { kind: 'off' };
  if (typeof window !== 'undefined') return readInjectedState();
  return getRenderState().value ?? { kind: 'unavailable', claimMode: true };
}

export function serializeStoreState(state: StoreState): string {
  const value = {
    kind: state.kind,
    seller: state.kind === 'claimed' ? state.seller : null,
    source: state.kind === 'claimed' ? state.source : null,
    claimMode: state.kind === 'off' ? false : state.claimMode,
  };
  const escaped = escapeForInlineScript(JSON.stringify(value));
  return `window.${STORE_STATE_WINDOW_KEY}=Object.freeze(${escaped});`;
}

export function getStoreSeller(): string | null {
  const state = getStoreState();
  return state.kind === 'claimed' ? state.seller : null;
}

export function isStoreMode(): boolean {
  return getStoreState().kind !== 'off';
}

/**
 * Whether this page is a store opened outside a secure context (plain `http://` on a host other
 * than localhost). Grant sign-in needs WebCrypto and Web Locks, which browsers offer only in a
 * secure context, so the store shows how to open it over HTTPS instead. Always false on the server.
 */
export function isStoreModeInsecureContext(): boolean {
  return isStoreMode() && typeof window !== 'undefined' && !window.isSecureContext;
}
