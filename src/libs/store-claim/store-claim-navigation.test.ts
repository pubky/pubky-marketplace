import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreState } from '@/config/store-mode';
import { setBasePath } from '@/test-utils/base-path';
import { STORE_CLAIM_CODE_SESSION_KEY, STORE_CLAIM_LANDING_RETRY_SESSION_KEY } from './store-claim-code';
import {
  markStoreClaimNavigation,
  navigateToClaimedStudio,
  scheduleStoreClaimLandingRetry,
} from './store-claim-navigation';

const UNCLAIMED: StoreState = { kind: 'unclaimed', claimMode: true };
const CLAIMED: StoreState = { kind: 'claimed', seller: 'o'.repeat(52), source: 'claim', claimMode: true };

describe('store claim landing retry', () => {
  const reload = vi.fn();
  const assign = vi.fn();
  const originalLocation = window.location;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllTimers();
    window.sessionStorage.clear();
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, reload, assign },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: originalLocation });
    setBasePath('');
  });

  it('navigates to the Studio through the base path helper', () => {
    setBasePath('/shop');
    navigateToClaimedStudio();
    expect(assign).toHaveBeenCalledExactlyOnceWith('/shop/marketplace/dashboard');
  });

  it('does not reload an ordinary unclaimed visit', () => {
    scheduleStoreClaimLandingRetry('/', UNCLAIMED);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds reloads at five after a claim navigation', () => {
    markStoreClaimNavigation();
    window.sessionStorage.setItem(STORE_CLAIM_CODE_SESSION_KEY, 'code');

    for (let attempt = 0; attempt < 6; attempt += 1) {
      scheduleStoreClaimLandingRetry('/', UNCLAIMED);
      vi.advanceTimersByTime(1_000);
    }

    expect(reload).toHaveBeenCalledTimes(5);
    expect(window.sessionStorage.getItem(STORE_CLAIM_LANDING_RETRY_SESSION_KEY)).toBeNull();
  });

  it('clears the attempt count when claimed state is seen', () => {
    markStoreClaimNavigation();
    scheduleStoreClaimLandingRetry('/marketplace/dashboard', CLAIMED);
    expect(window.sessionStorage.getItem(STORE_CLAIM_LANDING_RETRY_SESSION_KEY)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });
});
