import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/stores/auth/auth.store';
import { setStoreSeller } from '@/test-utils/store-mode';
import { useCanSellHere } from './useCanSellHere';

const STORE_SELLER = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u';
const BUYER = 'o'.repeat(52);

describe('useCanSellHere', () => {
  afterEach(() => {
    setStoreSeller(undefined);
    useAuthStore.setState({ currentUserPubky: null });
  });

  it('lets everyone sell outside store mode', () => {
    useAuthStore.setState({ currentUserPubky: BUYER });
    expect(renderHook(() => useCanSellHere()).result.current).toBe(true);
  });

  it.each([
    [STORE_SELLER, true],
    [BUYER, false],
    [null, false],
  ])('in a store, answers %s with %s', (viewer, expected) => {
    setStoreSeller(STORE_SELLER);
    useAuthStore.setState({ currentUserPubky: viewer });
    expect(renderHook(() => useCanSellHere()).result.current).toBe(expected);
  });
});
