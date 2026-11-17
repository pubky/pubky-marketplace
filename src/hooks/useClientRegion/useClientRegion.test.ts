import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
import { useClientRegion } from './useClientRegion';

beforeEach(() => resetRegionState());
afterEach(() => resetRegionState());

describe('useClientRegion', () => {
  it('makes no request and stays off while no region is blocked', () => {
    for (const modes of [undefined, 'none', 'EU=nuanced,GB=nuanced', 'EU=open']) {
      setRegionModes(modes);
      const fetchStub = stubClientRegion('DE');
      const { result, unmount } = renderHook(() => useClientRegion());
      expect(result.current).toEqual({ status: 'off' });
      expect(fetchStub).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('makes no request under the older flags either', () => {
    process.env.PUBKY_RUNTIME_EU_FENCE_ENABLED = 'true';
    process.env.PUBKY_RUNTIME_DIGITAL_REGION_BLOCK_ENABLED = 'true';
    setRegionModes(undefined);
    const fetchStub = stubClientRegion('DE');
    const { result } = renderHook(() => useClientRegion());
    expect(result.current).toEqual({ status: 'off' });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('asks once and reports the visitor country while a region is blocked', async () => {
    setRegionModes('EU=blocked,GB=blocked,US=blocked');
    const fetchStub = stubClientRegion('US');
    const first = renderHook(() => useClientRegion());
    const second = renderHook(() => useClientRegion());
    expect(first.result.current).toEqual({ status: 'loading' });
    await waitFor(() => expect(first.result.current).toEqual({ status: 'ready', country: 'US' }));
    await waitFor(() => expect(second.result.current).toEqual({ status: 'ready', country: 'US' }));
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('asks for a lone UNKNOWN=blocked policy too', async () => {
    setRegionModes('UNKNOWN=blocked');
    const fetchStub = stubClientRegion(null);
    const { result } = renderHook(() => useClientRegion());
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', country: null }));
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('reports a failed read', async () => {
    setRegionModes('US=blocked');
    stubClientRegion('fail');
    const { result } = renderHook(() => useClientRegion());
    await waitFor(() => expect(result.current).toEqual({ status: 'failed' }));
  });

  it('reads the country again when the visitor comes back to the tab, so a VPN switch needs no reload', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-22T12:00:00Z') });
    try {
      setRegionModes('EU=blocked,GB=blocked,US=blocked');
      stubClientRegion('GB');
      const { result } = renderHook(() => useClientRegion());
      await waitFor(() => expect(result.current).toEqual({ status: 'ready', country: 'GB' }));

      vi.setSystemTime(new Date('2026-10-22T12:01:00Z'));
      const fetchStub = stubClientRegion('CH');
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
      await waitFor(() => expect(result.current).toEqual({ status: 'ready', country: 'CH' }));
      expect(fetchStub).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('listens for nothing, and reads nothing, while no region is blocked', () => {
    setRegionModes('EU=nuanced,GB=nuanced');
    const fetchStub = stubClientRegion('CH');
    const { unmount } = renderHook(() => useClientRegion());
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(fetchStub).not.toHaveBeenCalled();
    unmount();
  });

  it('stops listening when the page that asked goes away', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-22T12:00:00Z') });
    try {
      setRegionModes('US=blocked');
      stubClientRegion('CH');
      const { result, unmount } = renderHook(() => useClientRegion());
      await waitFor(() => expect(result.current).toEqual({ status: 'ready', country: 'CH' }));
      unmount();

      vi.setSystemTime(new Date('2026-10-22T12:01:00Z'));
      const fetchStub = stubClientRegion('US');
      window.dispatchEvent(new Event('focus'));
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
