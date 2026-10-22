import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApplication } from '@/application/auth/auth';
import {
  buildFeatureDiscoveryDeviceStorageKey,
  buildFeatureDiscoveryStorageKey,
  MARKETPLACE_PROMO_STORAGE_ID,
} from '@/config/featureDiscovery';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ordersSeenStorageKey } from '@/libs/commerce/marketplace-attention';
import { ownDropsStorageKey } from '@/libs/commerce/own-drops-storage';
import { Identity } from '@/libs/identity/identity';
import { readPersistedAuthPubky } from '@/stores/auth/auth.persisted';
import { useAuthStore } from '@/stores/auth/auth.store';
import { buyerCountryFor, useBuyerCountryStore } from '@/stores/buyer-country/buyer-country.store';
import { BUYER_COUNTRY_PERSIST_KEY, SETTINGS_PERSIST_KEY } from '@/stores/persistedKeys';
import { mockKeypair } from '@/test-utils/pubky';
import { AuthController } from './auth';
import { grantSession, resetGrantTest } from './auth.grant-test-utils';

vi.mock('@/database/franky/franky.helpers', () => ({ clearDatabase: vi.fn(), clearPrivateData: vi.fn() }));
vi.mock('@/libs/query-client/query-client.factory', async (original) => ({
  ...(await original<object>()),
  clearAllQueryClients: vi.fn(),
}));
vi.mock('@/libs/utils/utils', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  clearCookies: vi.fn(),
}));

const ALICE = '5a1diz4pghi47ywdfyfzpit5f3bdomzt4pugpbmq4rngdd4iub4y';
const BOB = 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo';
const DEVICE_PROMO_KEY = buildFeatureDiscoveryDeviceStorageKey(MARKETPLACE_PROMO_STORAGE_ID);

function seedAccount(pubky: string): string[] {
  const keys = [
    ordersSeenStorageKey(pubky),
    ownDropsStorageKey(pubky),
    buildFeatureDiscoveryStorageKey(pubky, MARKETPLACE_PROMO_STORAGE_ID),
    buildFeatureDiscoveryStorageKey(pubky, 'chat-privacy-note-v1'),
  ];
  for (const key of keys) localStorage.setItem(key, 'x');
  return keys;
}

function signIn(pubky: string) {
  useAuthStore.getState().init({ session: grantSession(pubky), currentUserPubky: pubky, hasProfile: true });
}

beforeEach(() => {
  resetGrantTest();
  useBuyerCountryStore.getState().reset();
  localStorage.clear();
  vi.spyOn(AuthApplication, 'logout').mockResolvedValue(undefined);
});
afterEach(() => {
  AuthController.cancelAllAuthFlows();
  useBuyerCountryStore.getState().reset();
  vi.restoreAllMocks();
});

describe('sign-out and account switches remove what the leaving account left on the device', () => {
  it('forgets the signing-out account’s buyer country in memory and on the device', async () => {
    signIn(ALICE);
    CommerceController.setBuyerCountry('de');
    expect(buyerCountryFor(useBuyerCountryStore.getState(), ALICE)).toBe('DE');
    expect(localStorage.getItem(BUYER_COUNTRY_PERSIST_KEY)).toContain(ALICE);

    await AuthController.logout();

    expect(useBuyerCountryStore.getState()).toMatchObject({ country: null, owner: null });
    expect(localStorage.getItem(BUYER_COUNTRY_PERSIST_KEY)).toBeNull();
  });

  it('removes the signing-out account’s per-pubky keys and leaves every other key alone', async () => {
    signIn(ALICE);
    const alice = seedAccount(ALICE);
    const bob = seedAccount(BOB);
    localStorage.setItem(DEVICE_PROMO_KEY, 'dismissed');
    localStorage.setItem(SETTINGS_PERSIST_KEY, '{"state":{}}');

    await AuthController.logout();

    for (const key of alice) expect(localStorage.getItem(key), key).toBeNull();
    for (const key of bob) expect(localStorage.getItem(key), key).toBe('x');
    expect(localStorage.getItem(DEVICE_PROMO_KEY)).toBe('dismissed');
  });

  it('does not let the next account on the device see the previous account’s country', async () => {
    signIn(ALICE);
    CommerceController.setBuyerCountry('DE');
    await AuthController.logout();
    AuthController.resetCleanupLocalStateGuard();

    signIn(BOB);

    expect(buyerCountryFor(useBuyerCountryStore.getState(), BOB)).toBeNull();
    expect(CommerceController.getBuyerCountry()).toBeNull();
  });

  it('clears the previous account’s country and keys when a sign-in replaces it without a sign-out', async () => {
    signIn(ALICE);
    CommerceController.setBuyerCountry('DE');
    const alice = seedAccount(ALICE);
    const bob = seedAccount(BOB);
    vi.spyOn(Identity, 'keypairFromMnemonic').mockReturnValue(mockKeypair());
    vi.spyOn(Identity, 'z32FromSession').mockReturnValue(BOB);
    vi.spyOn(AuthApplication, 'signIn').mockResolvedValue({
      session: grantSession(BOB),
    } as Awaited<ReturnType<typeof AuthApplication.signIn>>);
    vi.spyOn(AuthApplication, 'userIsSignedUp').mockResolvedValue(false);
    vi.spyOn(AuthApplication, 'saveGrantSession').mockResolvedValue('bob:grant-record');
    vi.spyOn(AuthApplication, 'commitGrantSession').mockImplementation(() => {});

    await AuthController.loginWithMnemonic({ mnemonic: 'test mnemonic phrase' });

    expect(readPersistedAuthPubky()).toBe(BOB);
    expect(buyerCountryFor(useBuyerCountryStore.getState(), BOB)).toBeNull();
    expect(localStorage.getItem(BUYER_COUNTRY_PERSIST_KEY)).toBeNull();
    for (const key of alice) expect(localStorage.getItem(key), key).toBeNull();
    for (const key of bob) expect(localStorage.getItem(key), key).toBe('x');
  });
});
