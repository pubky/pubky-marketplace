import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useBuyerCountryStore } from '@/stores/buyer-country/buyer-country.store';
import { resetRegionState, setRegionModes } from '@/test-utils/region-modes';
import { useBuyerCountry } from './useBuyerCountry';

beforeEach(() => resetRegionState());
afterEach(() => resetRegionState());

describe('useBuyerCountry', () => {
  it.each([
    [undefined, false],
    ['none', false],
    ['EU=open', false],
    ['EU=nuanced,GB=nuanced', true],
    ['EU=blocked,GB=blocked,US=blocked', true],
    ['US=blocked', true],
  ])('is enabled for the modes %j: %s', (modes, enabled) => {
    setRegionModes(modes);
    expect(renderHook(() => useBuyerCountry()).result.current.enabled).toBe(enabled);
  });

  it('is enabled under either of the old flags while the setting is unset', () => {
    process.env.PUBKY_RUNTIME_EU_FENCE_ENABLED = 'true';
    setRegionModes(undefined);
    expect(renderHook(() => useBuyerCountry()).result.current.enabled).toBe(true);
  });

  it('reads the remembered country', () => {
    useBuyerCountryStore.setState({ country: 'CH' });
    expect(renderHook(() => useBuyerCountry()).result.current.country).toBe('CH');
  });
});
