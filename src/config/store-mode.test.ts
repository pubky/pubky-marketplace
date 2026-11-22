import { afterEach, describe, expect, it } from 'vitest';
import { setStoreSeller } from '@/test-utils/store-mode';
import { getStoreSeller, isStoreMode, isStoreModeInsecureContext } from './store-mode';

const STORE_SELLER = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u';

function setSecureContext(secure: boolean): void {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: secure });
}

describe('store mode', () => {
  afterEach(() => {
    setStoreSeller(undefined);
    setSecureContext(true);
  });

  it('is off by default', () => {
    expect(getStoreSeller()).toBeNull();
    expect(isStoreMode()).toBe(false);
  });

  it('is on with the store seller set', () => {
    setStoreSeller(STORE_SELLER);
    expect(getStoreSeller()).toBe(STORE_SELLER);
    expect(isStoreMode()).toBe(true);
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
