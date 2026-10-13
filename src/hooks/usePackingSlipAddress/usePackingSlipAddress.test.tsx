import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useAuthStore } from '@/stores/auth/auth.store';
import { createOrderFixture, ORDER_FIXTURE_SELLER } from '@/test/fixtures/commerce/orders';
import { usePackingSlipAddress } from './usePackingSlipAddress';

const mockPathname = vi.fn(() => '/marketplace/orders');
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

const ADDRESS = {
  name: 'Alice Buyer',
  line1: '1 Market Street',
  line2: '',
  city: 'New York',
  region: 'NY',
  postalCode: '10001',
  countryCode: 'US',
};

describe('usePackingSlipAddress', () => {
  const order = createOrderFixture('paid');

  beforeEach(() => {
    vi.restoreAllMocks();
    mockPathname.mockReturnValue('/marketplace/orders');
    useAuthStore.setState({ currentUserPubky: ORDER_FIXTURE_SELLER });
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.spyOn(CommerceController, 'getMarketplaceOrder').mockResolvedValue(order);
  });

  it('stays idle until the dialog is enabled', () => {
    const open = vi.spyOn(CommerceController, 'getOrderDeliveryAddress');
    const { result } = renderHook(() => usePackingSlipAddress({ order, enabled: false }));

    expect(result.current.deliveryAddress).toEqual({ status: 'idle' });
    expect(open).not.toHaveBeenCalled();
  });

  it('opens the address on this device and holds it in state', async () => {
    vi.spyOn(CommerceController, 'getOrderDeliveryAddress').mockResolvedValue({ kind: 'address', address: ADDRESS });
    const { result } = renderHook(() => usePackingSlipAddress({ order, enabled: true }));

    await waitFor(() => expect(result.current.deliveryAddress).toEqual({ status: 'ready', address: ADDRESS }));
  });

  it.each([
    [{ kind: 'undecryptable', reason: 'key_missing' } as const, { status: 'undecryptable', reason: 'key_missing' }],
    [{ kind: 'none' } as const, { status: 'unavailable' }],
  ])('maps %j to the slip state', async (result, expected) => {
    vi.spyOn(CommerceController, 'getOrderDeliveryAddress').mockResolvedValue(result);
    const hook = renderHook(() => usePackingSlipAddress({ order, enabled: true }));

    await waitFor(() => expect(hook.result.current.deliveryAddress).toEqual(expected));
  });

  it('reads nothing for an order the viewer did not sell', async () => {
    useAuthStore.setState({ currentUserPubky: 'z'.repeat(52) });
    const open = vi.spyOn(CommerceController, 'getOrderDeliveryAddress');
    const { result } = renderHook(() => usePackingSlipAddress({ order, enabled: true }));

    expect(result.current.deliveryAddress).toEqual({ status: 'idle' });
    expect(open).not.toHaveBeenCalled();
  });

  it('drops the address on clear() and on route change, and never touches web storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    vi.spyOn(CommerceController, 'getOrderDeliveryAddress').mockResolvedValue({ kind: 'address', address: ADDRESS });
    const { result, rerender } = renderHook(() => usePackingSlipAddress({ order, enabled: true }));
    await waitFor(() => expect(result.current.deliveryAddress.status).toBe('ready'));

    result.current.clear();
    await waitFor(() => expect(result.current.deliveryAddress).toEqual({ status: 'idle' }));

    mockPathname.mockReturnValue('/marketplace/dashboard');
    rerender();
    await waitFor(() => expect(result.current.deliveryAddress.status).not.toBe('ready'));
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
