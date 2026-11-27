import { afterEach, describe, expect, it } from 'vitest';
import { PUBKY_RUNTIME_ENV_NAMES } from '@/libs/runtime-config/runtime-config.schema';
import { setStoreMode, setStoreSeller } from '@/test-utils/store-mode';
import {
  allowsThirdPartyAnalytics,
  getStoreSeller,
  getStoreState,
  isStoreMode,
  isStoreModeInsecureContext,
  serializeStoreState,
  setStoreStateForTests,
  STORE_STATE_WINDOW_KEY,
} from './store-mode';

const STORE_SELLER = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u';

function setSecureContext(secure: boolean): void {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: secure });
}

function setClaimMode(): void {
  setStoreMode('single_seller');
  process.env[PUBKY_RUNTIME_ENV_NAMES.marketplaceGrantSessionEnabled] = 'true';
  process.env[PUBKY_RUNTIME_ENV_NAMES.marketplaceUrl] = 'https://marketplace.example.com';
}

describe('store mode', () => {
  afterEach(() => {
    setStoreSeller(undefined);
    setStoreMode(undefined);
    setStoreStateForTests(undefined);
    delete process.env[PUBKY_RUNTIME_ENV_NAMES.marketplaceGrantSessionEnabled];
    delete process.env[PUBKY_RUNTIME_ENV_NAMES.marketplaceUrl];
    delete window[STORE_STATE_WINDOW_KEY];
    setSecureContext(true);
  });

  it('is off by default', () => {
    expect(getStoreState()).toEqual({ kind: 'off' });
    expect(getStoreSeller()).toBeNull();
    expect(isStoreMode()).toBe(false);
  });

  it('is claimed and pinned with the store seller set', () => {
    setStoreSeller(STORE_SELLER);
    expect(getStoreState()).toEqual({
      kind: 'claimed',
      seller: STORE_SELLER,
      source: 'pinned',
      claimMode: false,
    });
    expect(getStoreSeller()).toBe(STORE_SELLER);
    expect(isStoreMode()).toBe(true);
  });

  it.each([undefined, null, {}, { kind: 'off' }, { kind: 'unknown', claimMode: true }])(
    'maps missing or malformed injected state %j to unavailable',
    (value) => {
      setClaimMode();
      window[STORE_STATE_WINDOW_KEY] = value;
      expect(getStoreState()).toEqual({ kind: 'unavailable', claimMode: true });
      expect(getStoreSeller()).toBeNull();
      expect(isStoreMode()).toBe(true);
    },
  );

  it.each([
    { kind: 'claimed', seller: null, source: 'claim', claimMode: true },
    { kind: 'claimed', seller: STORE_SELLER, source: 'pinned', claimMode: false },
    { kind: 'unclaimed', seller: STORE_SELLER, claimMode: true },
    { kind: 'unclaimed', seller: null, source: 'claim', claimMode: true },
  ])('maps contradictory injected state %j to unavailable', (value) => {
    setClaimMode();
    window[STORE_STATE_WINDOW_KEY] = value;
    expect(getStoreState()).toEqual({ kind: 'unavailable', claimMode: true });
  });

  it('reads a valid claimed state from the browser injection', () => {
    setClaimMode();
    window[STORE_STATE_WINDOW_KEY] = {
      kind: 'claimed',
      seller: STORE_SELLER,
      source: 'claim',
      claimMode: true,
    };
    expect(getStoreState()).toEqual({
      kind: 'claimed',
      seller: STORE_SELLER,
      source: 'claim',
      claimMode: true,
    });
  });

  it('serializes the complete browser state with null seller fields while unclaimed', () => {
    expect(serializeStoreState({ kind: 'unclaimed', claimMode: true })).toBe(
      'window.__PUBKY_STORE__=Object.freeze({"kind":"unclaimed","seller":null,"source":null,"claimMode":true});',
    );
  });

  it('allows tests to inject the server render state', () => {
    setStoreStateForTests({ kind: 'unclaimed', claimMode: true });
    expect(getStoreState()).toEqual({ kind: 'unclaimed', claimMode: true });
  });

  it('flags a store opened outside a secure context', () => {
    setStoreSeller(STORE_SELLER);
    setSecureContext(false);
    expect(isStoreModeInsecureContext()).toBe(true);
    setSecureContext(true);
    expect(isStoreModeInsecureContext()).toBe(false);
  });

  it('never flags the full Market, secure context or not', () => {
    setSecureContext(false);
    expect(isStoreModeInsecureContext()).toBe(false);
  });
});

describe('allowsThirdPartyAnalytics', () => {
  it.each([
    ['off', { kind: 'off' }, true],
    ['a pinned store', { kind: 'claimed', seller: STORE_SELLER, source: 'pinned', claimMode: false }, true],
    ['an unclaimed store', { kind: 'unclaimed', claimMode: true }, false],
    ['an unavailable store', { kind: 'unavailable', claimMode: true }, false],
    [
      'a store claimed in the browser',
      { kind: 'claimed', seller: STORE_SELLER, source: 'claim', claimMode: true },
      false,
    ],
  ] as const)('answers for %s', (_name, state, allowed) => {
    expect(allowsThirdPartyAnalytics(state)).toBe(allowed);
  });
});
