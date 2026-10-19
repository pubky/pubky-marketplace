import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useMarketplaceSessionConnect } from '@/hooks/useMarketplaceSessionConnect/useMarketplaceSessionConnect';
import { useMarketplaceInventoryGrantConnect } from './useMarketplaceInventoryGrantConnect';

const connect = vi.hoisted(() => ({
  status: 'idle',
  start: vi.fn(),
  cancel: vi.fn(),
  openInRing: vi.fn(),
  isOpeningRing: false,
}));
vi.mock('@/hooks/useMarketplaceSessionConnect/useMarketplaceSessionConnect', () => ({
  useMarketplaceSessionConnect: vi.fn(() => connect),
}));
it('routes inventory approval through the same marketplace grant flow', () => {
  const onConnected = vi.fn();
  const { result } = renderHook(() => useMarketplaceInventoryGrantConnect({ onConnected }));
  expect(useMarketplaceSessionConnect).toHaveBeenCalledWith({ onConnected });
  expect(result.current.start).toBe(connect.start);
  expect(result.current.openInSigner).toBe(connect.openInRing);
});
