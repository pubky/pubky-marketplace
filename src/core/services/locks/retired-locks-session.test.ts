import { afterEach, describe, expect, it, vi } from 'vitest';
import { RETIRED_LOCKS_SESSION_STORAGE_KEYS, RetiredLocksSessionStorage } from './retired-locks-session';

describe('RetiredLocksSessionStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('removes the creator bearer and connect nonce older Shops left, and nothing else', () => {
    for (const key of RETIRED_LOCKS_SESSION_STORAGE_KEYS) window.localStorage.setItem(key, 'left-by-an-older-shop');
    window.localStorage.setItem('pubky.marketplace.session.v1', 'kept');

    RetiredLocksSessionStorage.clear();

    for (const key of RETIRED_LOCKS_SESSION_STORAGE_KEYS) expect(window.localStorage.getItem(key)).toBeNull();
    expect(window.localStorage.getItem('pubky.marketplace.session.v1')).toBe('kept');
  });

  it('does not throw when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    expect(() => RetiredLocksSessionStorage.clear()).not.toThrow();
  });
});
