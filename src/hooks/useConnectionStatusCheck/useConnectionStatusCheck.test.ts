import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionCheck } from '@/application/connectors/connectors';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { connectionHealth, connectorConnectionSchema } from '@/libs/commerce/connectors';
import { useConnectionStatusCheck } from './useConnectionStatusCheck';

vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: { fetchConnections: vi.fn(), fetchConnectionCheck: vi.fn() },
}));

function connection(overrides: Record<string, unknown> = {}) {
  return connectorConnectionSchema.parse({
    id: 'c1',
    provider: 'woocommerce',
    domain: 'dezentralshop.ch',
    status: 'connected',
    scopes: ['read_write'],
    updatedAt: '2026-10-15T10:00:00.000Z',
    ...overrides,
  });
}

function check(overrides: Partial<ConnectionCheck> = {}): ConnectionCheck {
  const found = overrides.connection === undefined ? connection() : overrides.connection;
  return {
    connection: found,
    health: found ? connectionHealth(found) : null,
    productCount: 3,
    catalogReadable: true,
    ...overrides,
  };
}

describe('useConnectionStatusCheck', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports a connected store whose catalog can be read', async () => {
    vi.mocked(ConnectorsController.fetchConnectionCheck).mockResolvedValue(check());
    const { result } = renderHook(() => useConnectionStatusCheck());

    await act(async () => {
      expect(await result.current.run({ connectionId: 'c1', attempts: 1 })).toBe('connected');
    });

    expect(result.current.phase).toBe('connected');
    expect(result.current.result?.productCount).toBe(3);
  });

  it('needs attention when connected but the catalog cannot be read', async () => {
    vi.mocked(ConnectorsController.fetchConnectionCheck).mockResolvedValue(
      check({ catalogReadable: false, productCount: null }),
    );
    const { result } = renderHook(() => useConnectionStatusCheck());
    await act(async () => {
      expect(await result.current.run({ connectionId: 'c1', attempts: 1 })).toBe('attention');
    });
  });

  it('needs attention when the store rejected the keys', async () => {
    const rejected = connection({ status: 'error', lastError: { message: 'credentials_rejected' } });
    vi.mocked(ConnectorsController.fetchConnectionCheck).mockResolvedValue(
      check({ connection: rejected, catalogReadable: false }),
    );
    const { result } = renderHook(() => useConnectionStatusCheck());
    await act(async () => {
      expect(await result.current.run({ connectionId: 'c1', attempts: 1 })).toBe('attention');
    });
    expect(result.current.result?.health?.reasons[0]).toContain('rejected the saved keys');
  });

  it('keeps looking while the connection is pending, then settles when it connects', async () => {
    const pending = connection({ status: 'pending' });
    vi.mocked(ConnectorsController.fetchConnectionCheck)
      .mockResolvedValueOnce(check({ connection: pending, catalogReadable: false, productCount: null }))
      .mockResolvedValueOnce(check());
    const { result } = renderHook(() => useConnectionStatusCheck());

    await act(async () => {
      expect(await result.current.run({ connectionId: 'c1', attempts: 3, delayMs: 0 })).toBe('connected');
    });

    expect(ConnectorsController.fetchConnectionCheck).toHaveBeenCalledTimes(2);
  });

  it('says it is still waiting when the store never confirms', async () => {
    vi.mocked(ConnectorsController.fetchConnectionCheck).mockResolvedValue(
      check({ connection: connection({ status: 'pending' }), catalogReadable: false }),
    );
    const { result } = renderHook(() => useConnectionStatusCheck());
    await act(async () => {
      expect(await result.current.run({ connectionId: 'c1', attempts: 2, delayMs: 0 })).toBe('waiting');
    });
    expect(ConnectorsController.fetchConnectionCheck).toHaveBeenCalledTimes(2);
  });

  it('finds the newest connection of a provider when it has no id yet', async () => {
    vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([
      connection({ id: 'old', updatedAt: '2026-10-14T10:00:00.000Z' }),
      connection({ id: 'new', updatedAt: '2026-10-15T10:00:00.000Z' }),
      connection({ id: 'shop', provider: 'shopify', updatedAt: '2026-10-16T10:00:00.000Z' }),
    ]);
    vi.mocked(ConnectorsController.fetchConnectionCheck).mockResolvedValue(check());
    const { result } = renderHook(() => useConnectionStatusCheck());

    await act(async () => {
      await result.current.run({ provider: 'woocommerce', attempts: 1 });
    });

    expect(ConnectorsController.fetchConnectionCheck).toHaveBeenCalledWith('new');
  });

  it('treats a failing check as not confirmed yet instead of throwing', async () => {
    vi.mocked(ConnectorsController.fetchConnectionCheck).mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useConnectionStatusCheck());
    await act(async () => {
      expect(await result.current.run({ connectionId: 'c1', attempts: 1 })).toBe('waiting');
    });
    expect(result.current.result).toBeNull();
  });

  it('goes back to idle on reset', async () => {
    vi.mocked(ConnectorsController.fetchConnectionCheck).mockResolvedValue(check());
    const { result } = renderHook(() => useConnectionStatusCheck());
    await act(async () => {
      await result.current.run({ connectionId: 'c1', attempts: 1 });
    });
    act(() => result.current.reset());
    expect(result.current.phase).toBe('idle');
    expect(result.current.result).toBeNull();
  });
});
