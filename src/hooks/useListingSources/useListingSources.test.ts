import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { useListingSources } from './useListingSources';

const mode = vi.hoisted(() => ({ value: 'transaction-service' }));
const connectors = vi.hoisted(() => ({
  fetchConnections: vi.fn(),
  fetchMappings: vi.fn(),
}));

vi.mock('@/controllers/connectors/connectors', () => ({ ConnectorsController: connectors }));
vi.mock('@/config/commerce', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/commerce')>()),
  getCommerceAdapterMode: () => mode.value,
}));

const SELLER = 's'.repeat(52);
const SESSION = {
  pubky: SELLER,
  capabilities: '/pub/pubky.app/:rw',
  issuedAt: '2026-11-05T00:00:00.000Z',
  expiresAt: '2026-12-05T00:00:00.000Z',
};

describe('useListingSources', () => {
  beforeEach(() => {
    mode.value = 'transaction-service';
    connectors.fetchConnections.mockReset();
    connectors.fetchMappings.mockReset();
    useAuthStore.setState({ currentUserPubky: SELLER });
    useCommerceStore.setState({ marketplaceSession: SESSION as never });
  });

  it('maps each listing to the stores that link it', async () => {
    connectors.fetchConnections.mockResolvedValue([
      { id: 'c1', provider: 'shopify', mappingCount: 2 },
      { id: 'c2', provider: 'woocommerce', mappingCount: 1 },
      { id: 'c3', provider: 'shopify', mappingCount: 0 },
    ]);
    connectors.fetchMappings.mockImplementation(async (id: string) =>
      id === 'c1' ? [{ listingId: 'a' }, { listingId: 'b' }] : [{ listingId: 'b' }],
    );

    const { result } = renderHook(() => useListingSources());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.sourcesOf('a')).toEqual(['shopify']);
    expect([...result.current.sourcesOf('b')].sort()).toEqual(['shopify', 'woocommerce']);
    expect(result.current.sourcesOf('made-by-hand')).toEqual([]);
    expect(connectors.fetchMappings).not.toHaveBeenCalledWith('c3');
  });

  it('is ready with no sources for a seller with no store connections', async () => {
    connectors.fetchConnections.mockResolvedValue([]);

    const { result } = renderHook(() => useListingSources());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.sourcesOf('a')).toEqual([]);
  });

  it('stays not ready, so no filter guesses, when the mappings cannot be read', async () => {
    connectors.fetchConnections.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useListingSources());

    await waitFor(() => expect(connectors.fetchConnections).toHaveBeenCalled());
    expect(result.current.ready).toBe(false);
  });

  it('never serves one seller the mappings read for another while the new ones load', async () => {
    connectors.fetchConnections.mockResolvedValueOnce([{ id: 'c1', provider: 'shopify', mappingCount: 1 }]);
    connectors.fetchMappings.mockResolvedValueOnce([{ listingId: 'a' }]);
    const { result } = renderHook(() => useListingSources());
    await waitFor(() => expect(result.current.ready).toBe(true));

    let release: (connections: unknown[]) => void = () => undefined;
    connectors.fetchConnections.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    act(() => {
      useAuthStore.setState({ currentUserPubky: 'o'.repeat(52) });
      useCommerceStore.setState({ marketplaceSession: { ...SESSION, pubky: 'o'.repeat(52) } as never });
    });

    expect(result.current.ready).toBe(false);
    expect(result.current.sourcesOf('a')).toEqual([]);
    await act(async () => release([]));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.sourcesOf('a')).toEqual([]);
  });

  it('asks nothing without a marketplace session or without a transaction service', () => {
    useCommerceStore.setState({ marketplaceSession: null });
    const withoutSession = renderHook(() => useListingSources());
    expect(withoutSession.result.current.ready).toBe(false);

    useCommerceStore.setState({ marketplaceSession: SESSION as never });
    mode.value = 'unavailable';
    const withoutService = renderHook(() => useListingSources());
    expect(withoutService.result.current.ready).toBe(false);
    expect(connectors.fetchConnections).not.toHaveBeenCalled();
  });
});
