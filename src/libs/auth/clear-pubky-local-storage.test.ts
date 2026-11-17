import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFeatureDiscoveryDeviceStorageKey,
  buildFeatureDiscoveryStorageKey,
  FEATURE_DISCOVERY_STORAGE_PREFIX,
  LEGACY_FEATURE_DISCOVERY_STORAGE_PREFIX,
  MARKETPLACE_NAV_SWIPE_STORAGE_ID,
  MARKETPLACE_PROMO_STORAGE_ID,
} from '@/config/featureDiscovery';
import { ordersSeenStorageKey } from '@/libs/commerce/marketplace-attention';
import { ownDropsStorageKey } from '@/libs/commerce/own-drops-storage';
import { AUTH_PERSIST_KEY, SETTINGS_PERSIST_KEY } from '@/stores/persistedKeys';
import { asOpaque } from '@/test-utils/type-assertions';
import { clearPubkyLocalStorage } from './clear-pubky-local-storage';

const ALICE = 'a'.repeat(52);
const BOB = 'b'.repeat(52);

afterEach(() => localStorage.clear());

describe('clearPubkyLocalStorage', () => {
  it('removes every key that embeds the pubky and reports them', () => {
    const mine = [
      ordersSeenStorageKey(ALICE),
      ownDropsStorageKey(ALICE),
      buildFeatureDiscoveryStorageKey(ALICE, MARKETPLACE_PROMO_STORAGE_ID),
      buildFeatureDiscoveryStorageKey(ALICE, 'chat-privacy-note-v1'),
      `${LEGACY_FEATURE_DISCOVERY_STORAGE_PREFIX}:${ALICE}:collections-nav-v1`,
    ];
    for (const key of mine) localStorage.setItem(key, 'x');

    expect(clearPubkyLocalStorage(ALICE).sort()).toEqual([...mine].sort());
    for (const key of mine) expect(localStorage.getItem(key), key).toBeNull();
  });

  it('keeps another account’s keys', () => {
    const others = [
      ordersSeenStorageKey(BOB),
      ownDropsStorageKey(BOB),
      buildFeatureDiscoveryStorageKey(BOB, MARKETPLACE_PROMO_STORAGE_ID),
    ];
    for (const key of [...others, ordersSeenStorageKey(ALICE)]) localStorage.setItem(key, 'x');

    clearPubkyLocalStorage(ALICE);

    for (const key of others) expect(localStorage.getItem(key), key).toBe('x');
  });

  it('keeps device settings that have no pubky in their key', () => {
    const device = [
      buildFeatureDiscoveryDeviceStorageKey(MARKETPLACE_PROMO_STORAGE_ID),
      buildFeatureDiscoveryDeviceStorageKey(MARKETPLACE_NAV_SWIPE_STORAGE_ID),
      SETTINGS_PERSIST_KEY,
      AUTH_PERSIST_KEY,
      `${FEATURE_DISCOVERY_STORAGE_PREFIX}:unrelated`,
      'theme',
    ];
    for (const key of device) localStorage.setItem(key, 'x');
    localStorage.setItem(ordersSeenStorageKey(ALICE), '1');

    expect(clearPubkyLocalStorage(ALICE)).toEqual([ordersSeenStorageKey(ALICE)]);
    for (const key of device) expect(localStorage.getItem(key), key).toBe('x');
  });

  it('does not take a key for another pubky that merely starts the same way', () => {
    localStorage.setItem(ordersSeenStorageKey(`${ALICE}2`), '1');
    localStorage.setItem(buildFeatureDiscoveryStorageKey(`${ALICE}2`, 'f'), 'x');

    expect(clearPubkyLocalStorage(ALICE)).toEqual([]);
    expect(localStorage.length).toBe(2);
  });

  it('does nothing for an empty pubky', () => {
    localStorage.setItem(ordersSeenStorageKey(''), '1');
    expect(clearPubkyLocalStorage('')).toEqual([]);
    expect(clearPubkyLocalStorage('  ')).toEqual([]);
    expect(localStorage.length).toBe(1);
  });

  it('survives storage that refuses access', () => {
    const refusing = asOpaque<Storage>({
      get length(): number {
        throw new Error('denied');
      },
      key: vi.fn(),
      removeItem: vi.fn(),
    });
    expect(clearPubkyLocalStorage(ALICE, refusing)).toEqual([]);
  });
});
