import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { connectorAlertSchema } from '@/libs/commerce/connectors';
import { toast } from '@/molecules/Toaster/use-toast';
import { connectorRefusal } from '@/test-utils/connector-errors';
import { connectionFixture } from '@/test-utils/connector-fixtures';
import { useStoreConnections } from './useStoreConnections';

const mode = vi.hoisted(() => ({ value: 'transaction-service' as string, enabled: true }));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => mode.value, getStoreConnectionsEnabled: () => mode.enabled };
});

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: 'y'.repeat(52) }),
}));

vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: {
    fetchConnections: vi.fn(),
    fetchAlerts: vi.fn(async () => []),
    commitDisconnect: vi.fn(),
    commitResolveAlert: vi.fn(),
    commitVariantMode: vi.fn(),
  },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

function connection(id: string, overrides: Record<string, unknown> = {}) {
  return connectionFixture({
    id,
    provider: 'woocommerce',
    domain: `${id}.example.com`,
    status: 'connected',
    scopes: ['read_write'],
    ...overrides,
  });
}

describe('useStoreConnections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mode.value = 'transaction-service';
    mode.enabled = true;
  });

  it('lists the connections with their health', async () => {
    vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([
      connection('a'),
      connection('b', { status: 'error', lastError: { message: 'credentials_rejected' } }),
    ]);
    const { result } = renderHook(() => useStoreConnections());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.rows.map((row) => row.health.state)).toEqual(['connected', 'needs_attention']);
    expect(result.current.error).toBeNull();
  });

  it('asks for a session when the service wants one', async () => {
    const expired = connectorRefusal('x', 401);
    Object.assign(expired, { code: 'SESSION_EXPIRED' });
    vi.mocked(ConnectorsController.fetchConnections).mockRejectedValue(expired);
    const { result } = renderHook(() => useStoreConnections());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.needsSession).toBe(true);
  });

  it('says store connections are off when the service has them switched off', async () => {
    vi.mocked(ConnectorsController.fetchConnections).mockRejectedValue(connectorRefusal('connectors_disabled', 404));
    const { result } = renderHook(() => useStoreConnections());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.unavailable).toBe(true);
    expect(result.current.error).toBe('Store connections are not switched on for this shop yet.');
  });

  it('does not call the service outside the durable mode', async () => {
    mode.value = 'sandbox';
    const { result } = renderHook(() => useStoreConnections());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(false);
    expect(ConnectorsController.fetchConnections).not.toHaveBeenCalled();
  });

  it('does not call the service while the store connections switch is off', async () => {
    mode.enabled = false;
    const { result } = renderHook(() => useStoreConnections());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(false);
    expect(result.current.lostAlerts).toEqual([]);
    expect(ConnectorsController.fetchConnections).not.toHaveBeenCalled();
    expect(ConnectorsController.fetchAlerts).not.toHaveBeenCalled();
  });

  it('keeps a disconnected store in the list as Disconnected until the page is reloaded', async () => {
    const first = connection('a');
    vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([first, connection('b')]);
    vi.mocked(ConnectorsController.commitDisconnect).mockResolvedValue();
    const { result } = renderHook(() => useStoreConnections());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let ok = false;
    await act(async () => {
      ok = await result.current.disconnect(first);
    });

    expect(ok).toBe(true);
    expect(ConnectorsController.commitDisconnect).toHaveBeenCalledWith('a');
    expect(result.current.rows.map((row) => [row.connection.id, row.health.state])).toEqual([
      ['b', 'connected'],
      ['a', 'disconnected'],
    ]);
    expect(toast).toHaveBeenCalledWith({ description: 'Disconnected. Pubky deleted its keys for this store.' });
  });

  it('leaves the connection in place and says so when Disconnect fails', async () => {
    const first = connection('a');
    vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([first]);
    vi.mocked(ConnectorsController.commitDisconnect).mockRejectedValue(connectorRefusal('provider_unavailable', 502));
    const { result } = renderHook(() => useStoreConnections());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      expect(await result.current.disconnect(first)).toBe(false);
    });

    expect(result.current.rows.map((row) => row.health.state)).toEqual(['connected']);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', title: 'Could not disconnect' }));
  });

  it('keeps the alerts that say a connection is gone, and dismisses one', async () => {
    const lost = connectorAlertSchema.parse({
      id: 'a1',
      connectionId: 'gone',
      kind: 'store_uninstalled',
      createdAt: '2026-10-15T12:00:00.000Z',
    });
    const other = connectorAlertSchema.parse({
      id: 'a2',
      connectionId: 'a',
      kind: 'push_quarantined',
      createdAt: '2026-10-15T12:00:00.000Z',
    });
    const rejected = connectorAlertSchema.parse({
      id: 'a3',
      connectionId: 'b',
      kind: 'credentials_rejected',
      createdAt: '2026-10-15T12:00:00.000Z',
    });
    vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([]);
    vi.mocked(ConnectorsController.fetchAlerts).mockResolvedValue([lost, other, rejected]);
    vi.mocked(ConnectorsController.commitResolveAlert).mockResolvedValue();
    const { result } = renderHook(() => useStoreConnections());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.lostAlerts.map((alert) => alert.id)).toEqual(['a1']);
    await act(async () => {
      await result.current.dismissLostAlert('a1');
    });
    expect(ConnectorsController.commitResolveAlert).toHaveBeenCalledWith('a1');
    expect(result.current.lostAlerts).toEqual([]);
  });

  it('saves the variant mode and shows the connection the service answered with', async () => {
    const first = connection('a');
    vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([first]);
    vi.mocked(ConnectorsController.commitVariantMode).mockResolvedValue({
      connection: connection('a', { variantMode: 'split' }),
      unmappedListings: [],
    });
    const { result } = renderHook(() => useStoreConnections());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      expect(await result.current.setVariantMode(first, 'split')).toBe(true);
    });

    expect(ConnectorsController.commitVariantMode).toHaveBeenCalledWith('a', 'split');
    expect(result.current.connections[0]?.variantMode).toBe('split');
  });

  it('keeps the listings a switch to split unlinked, and clears them when dismissed', async () => {
    const first = connection('a');
    vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([first]);
    vi.mocked(ConnectorsController.commitVariantMode).mockResolvedValue({
      connection: connection('a', { variantMode: 'split' }),
      unmappedListings: [
        { listingId: 'boots_01', mappingsRemoved: 2 },
        { listingId: 'woo-9', mappingsRemoved: 3 },
      ],
    });
    const { result } = renderHook(() => useStoreConnections());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.unmapped).toBeNull();

    await act(async () => {
      expect(await result.current.setVariantMode(first, 'split')).toBe(true);
    });

    expect(result.current.unmapped).toEqual({
      connectionId: 'a',
      domain: first.domain,
      listings: [
        { listingId: 'boots_01', mappingsRemoved: 2 },
        { listingId: 'woo-9', mappingsRemoved: 3 },
      ],
    });
    act(() => result.current.dismissUnmapped());
    expect(result.current.unmapped).toBeNull();
  });

  it('shows no unlinked listings when the switch unlinked none', async () => {
    const first = connection('a');
    vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([first]);
    vi.mocked(ConnectorsController.commitVariantMode).mockResolvedValue({
      connection: connection('a', { variantMode: 'split' }),
      unmappedListings: [],
    });
    const { result } = renderHook(() => useStoreConnections());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.setVariantMode(first, 'split');
    });

    expect(result.current.unmapped).toBeNull();
  });

  it('keeps the setting and says so when the service refuses the change', async () => {
    const first = connection('a');
    vi.mocked(ConnectorsController.fetchConnections).mockResolvedValue([first]);
    vi.mocked(ConnectorsController.commitVariantMode).mockRejectedValue(connectorRefusal('invalid_variant_mode', 422));
    const { result } = renderHook(() => useStoreConnections());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      expect(await result.current.setVariantMode(first, 'split')).toBe(false);
    });

    expect(result.current.connections[0]?.variantMode).toBe('native');
    expect(result.current.unmapped).toBeNull();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', description: 'That setting was not accepted.' }),
    );
  });
});
