import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUYER_COUNTRY_PERSIST_KEY } from '../persistedKeys';
import { buyerCountryFor, useBuyerCountryStore } from './buyer-country.store';

const ALICE = 'a'.repeat(52);
const BOB = 'b'.repeat(52);

const persisted = () =>
  JSON.parse(localStorage.getItem(BUYER_COUNTRY_PERSIST_KEY) ?? 'null') as {
    state: { country: string | null; owner: string | null };
    version: number;
  } | null;

/** A fresh copy of the store module, as a page load would build it from what is in `localStorage`. */
async function reload() {
  vi.resetModules();
  return (await import('./buyer-country.store')).useBuyerCountryStore;
}

beforeEach(() => {
  localStorage.clear();
  useBuyerCountryStore.getState().reset();
  localStorage.clear();
});
afterEach(() => localStorage.clear());

describe('buyer country store', () => {
  it('keeps the country upper case and forgets it on null', () => {
    useBuyerCountryStore.getState().setCountry('de', ALICE);
    expect(useBuyerCountryStore.getState()).toMatchObject({ country: 'DE', owner: ALICE });
    useBuyerCountryStore.getState().setCountry(null);
    expect(useBuyerCountryStore.getState().country).toBeNull();
  });

  describe('buyerCountryFor', () => {
    it('gives a country only to the account that said it', () => {
      expect(buyerCountryFor({ country: 'DE', owner: ALICE }, ALICE)).toBe('DE');
      expect(buyerCountryFor({ country: 'DE', owner: ALICE }, BOB)).toBeNull();
      expect(buyerCountryFor({ country: 'DE', owner: ALICE }, null)).toBeNull();
    });

    it('gives a country said before anybody signed in to whoever is signed in', () => {
      expect(buyerCountryFor({ country: 'DE', owner: null }, BOB)).toBe('DE');
      expect(buyerCountryFor({ country: 'DE', owner: null }, null)).toBe('DE');
      expect(buyerCountryFor({ country: null, owner: ALICE }, ALICE)).toBeNull();
    });
  });

  describe('on the device', () => {
    it('stores the country with the pubky that said it', () => {
      useBuyerCountryStore.getState().setCountry('DE', ALICE);
      expect(persisted()).toMatchObject({ state: { country: 'DE', owner: ALICE }, version: 2 });
    });

    it('never writes a country said before anybody signed in', () => {
      useBuyerCountryStore.getState().setCountry('DE');
      expect(useBuyerCountryStore.getState().country).toBe('DE');
      expect(persisted()?.state).toEqual({ country: null, owner: null });
      expect(localStorage.getItem(BUYER_COUNTRY_PERSIST_KEY)).not.toContain('DE');
    });

    it('lets a second account on the same device replace the first account’s country and never see it', async () => {
      useBuyerCountryStore.getState().setCountry('DE', ALICE);

      const afterReload = await reload();
      expect(buyerCountryFor(afterReload.getState(), ALICE)).toBe('DE');
      expect(buyerCountryFor(afterReload.getState(), BOB)).toBeNull();

      afterReload.getState().setCountry('CH', BOB);
      expect(JSON.parse(localStorage.getItem(BUYER_COUNTRY_PERSIST_KEY) ?? '{}').state).toEqual({
        country: 'CH',
        owner: BOB,
      });
      expect(localStorage.getItem(BUYER_COUNTRY_PERSIST_KEY)).not.toContain(ALICE);
      expect(buyerCountryFor(afterReload.getState(), ALICE)).toBeNull();
    });

    it('removes the persisted value with clearStorage and starts empty on the next load', async () => {
      useBuyerCountryStore.getState().setCountry('DE', ALICE);
      useBuyerCountryStore.getState().reset();
      useBuyerCountryStore.persist.clearStorage();

      expect(localStorage.getItem(BUYER_COUNTRY_PERSIST_KEY)).toBeNull();
      expect((await reload()).getState()).toMatchObject({ country: null, owner: null });
    });

    it('drops the version 1 value, which had no owner, instead of adopting it for any account', async () => {
      localStorage.setItem(BUYER_COUNTRY_PERSIST_KEY, JSON.stringify({ state: { country: 'DE' }, version: 1 }));

      const afterReload = await reload();

      expect(afterReload.getState()).toMatchObject({ country: null, owner: null });
      expect(buyerCountryFor(afterReload.getState(), ALICE)).toBeNull();
      expect(localStorage.getItem(BUYER_COUNTRY_PERSIST_KEY)).not.toContain('DE');
    });

    it.each([
      ['an unowned country', { country: 'DE', owner: null }],
      ['an empty owner', { country: 'DE', owner: '' }],
      ['an invalid country', { country: 'Germany', owner: ALICE }],
      ['a lower-case country', { country: 'de', owner: ALICE }],
      ['a wrong type', { country: 7, owner: ALICE }],
    ])('ignores %s in a version 2 value', async (_name, state) => {
      localStorage.setItem(BUYER_COUNTRY_PERSIST_KEY, JSON.stringify({ state, version: 2 }));
      expect((await reload()).getState()).toMatchObject({ country: null, owner: null });
    });
  });
});
