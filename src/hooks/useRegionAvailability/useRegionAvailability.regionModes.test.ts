import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { DIGITAL_REGION_MESSAGE, REGION_UNAVAILABLE_MESSAGE } from '@/libs/commerce/eu-region';
import {
  COMMERCE_BLOCKED_INFO,
  COMMERCE_BLOCKED_MESSAGE,
  COMMERCE_UNKNOWN_REGION_MESSAGE,
  PAID_UNLOCKS_BLOCKED_MESSAGE,
  SELLING_BLOCKED_COUNTRY_MESSAGE,
} from '@/libs/commerce/region-modes';
import { useBuyerCountryStore } from '@/stores/buyer-country/buyer-country.store';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
import { useRegionAvailability } from './useRegionAvailability';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    setBuyerCountry: vi.fn((code: string | null) => useBuyerCountryStore.getState().setCountry(code)),
    getSellerAnnualLimit: vi.fn(async () => ({ enabled: true, limitReached: false })),
  },
}));

const SELLER = 's'.repeat(52);
const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';

const run = (input: {
  shop?: { sellerStatus?: string; location?: { countryCode?: string } } | null;
  digital?: boolean;
  isOwner?: boolean;
}) =>
  renderHook(() =>
    useRegionAvailability({
      sellerPubky: SELLER,
      shop: input.shop ?? null,
      digital: input.digital ?? false,
      isOwner: input.isOwner,
    }),
  );

beforeEach(() => resetRegionState());
afterEach(() => resetRegionState());

describe('useRegionAvailability under the region modes', () => {
  it('never prompts for a country while regions are only blocked', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    const { result } = run({ shop: { sellerStatus: 'trader', location: { countryCode: 'NO' } }, digital: true });
    await waitFor(() => expect(result.current.commerce.checking).toBe(false));
    expect(result.current).toMatchObject({ needsCountry: false, usesCountry: false, refusal: null, digitalNote: null });
  });

  it('replaces buying with the one line and its info text for a visitor in a blocked region', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('US');
    const { result } = run({ shop: { sellerStatus: 'private' } });
    expect(result.current.commerce).toMatchObject({ checking: true, held: true });
    expect(result.current.blockedNotice).toBeNull();

    await waitFor(() => expect(result.current.commerce.blocked).toBe(true));
    expect(result.current.blockedNotice).toEqual({
      message: COMMERCE_BLOCKED_MESSAGE,
      info: COMMERCE_BLOCKED_INFO,
      source: 'ip',
    });
    expect(result.current).toMatchObject({ refusal: null, needsCountry: false, enabled: true });
  });

  it('names paid unlocks on a digital-only listing, and the unknown region as it is', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('DE');
    const digital = run({ digital: true });
    await waitFor(() => expect(digital.result.current.blockedNotice).not.toBeNull());
    expect(digital.result.current.blockedNotice?.message).toBe(PAID_UNLOCKS_BLOCKED_MESSAGE);
    digital.unmount();

    resetRegionState();
    setRegionModes(LAUNCH);
    stubClientRegion(null);
    const unknown = run({ digital: true });
    await waitFor(() => expect(unknown.result.current.blockedNotice).not.toBeNull());
    expect(unknown.result.current.blockedNotice?.message).toBe(COMMERCE_UNKNOWN_REGION_MESSAGE);
  });

  it('leaves a visitor from an open country alone', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    const { result } = run({ shop: { sellerStatus: 'private', location: { countryCode: 'NO' } } });
    await waitFor(() => expect(result.current.commerce.checking).toBe(false));
    expect(result.current.commerce).toMatchObject({ blocked: false, held: false });
    expect(result.current.blockedNotice).toBeNull();
    expect(result.current).toMatchObject({ refusal: null, needsCountry: false });
  });

  it('blocks buying from a seller whose shop is in a blocked country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    const { result } = run({ shop: { sellerStatus: 'private', location: { countryCode: 'US' } } });
    await waitFor(() => expect(result.current.blockedNotice).not.toBeNull());
    expect(result.current.blockedNotice?.message).toBe(SELLING_BLOCKED_COUNTRY_MESSAGE);
  });

  it('does not block the seller looking at their own listing for their shop country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    const { result } = run({ shop: { location: { countryCode: 'US' } }, isOwner: true });
    await waitFor(() => expect(result.current.commerce.checking).toBe(false));
    expect(result.current.commerce.blocked).toBe(false);
  });

  it('keeps the nuanced rules for nuanced regions and blocks the rest in a mixed policy', async () => {
    setRegionModes('EU=nuanced,GB=nuanced,US=blocked');
    stubClientRegion('DE');
    const { result } = run({ shop: { sellerStatus: 'trader' }, digital: false });
    expect(result.current.needsCountry).toBe(true);
    await waitFor(() => expect(result.current.commerce.checking).toBe(false));
    expect(result.current.commerce.blocked).toBe(false);

    act(() => result.current.setBuyerCountry('DE'));
    await waitFor(() => expect(result.current.refusal).toBe(REGION_UNAVAILABLE_MESSAGE));

    act(() => result.current.setBuyerCountry('US'));
    await waitFor(() => expect(result.current.commerce.blocked).toBe(true));
    expect(result.current).toMatchObject({ refusal: null, needsCountry: false });
  });

  it('applies the digital hold only in nuanced regions and never to a country that is open', async () => {
    setRegionModes('EU=nuanced,GB=nuanced');
    const { result } = run({ shop: { sellerStatus: 'private' }, digital: true });
    expect(result.current.digitalNote).toBe(DIGITAL_REGION_MESSAGE);
    act(() => result.current.setBuyerCountry('FR'));
    await waitFor(() => expect(result.current.refusal).toBe(DIGITAL_REGION_MESSAGE));
    act(() => result.current.setBuyerCountry('US'));
    await waitFor(() => expect(result.current.refusal).toBeNull());
    expect(CommerceController.getSellerAnnualLimit).toHaveBeenCalled();
  });

  it('does not apply the fence to a region the modes leave open or block', async () => {
    setRegionModes('GB=nuanced,DE=blocked');
    stubClientRegion('CH');
    useBuyerCountryStore.setState({ country: 'FR' });
    const { result } = run({ shop: { sellerStatus: 'trader' } });
    await waitFor(() => expect(result.current.commerce.checking).toBe(false));
    expect(result.current.refusal).toBeNull();
  });
});
