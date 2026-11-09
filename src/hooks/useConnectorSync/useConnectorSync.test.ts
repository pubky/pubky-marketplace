import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { toast } from '@/molecules/Toaster/toast';
import { RECORDED_CONNECTION_ID, recordedSync } from '@/test-utils/connector-changes';
import { bareHttpFailure, connectorRefusal } from '@/test-utils/connector-errors';
import { useConnectorSync } from './useConnectorSync';

const mode = vi.hoisted(() => ({ value: 'transaction-service' as string }));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => mode.value };
});

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: 'y'.repeat(52) }),
}));

vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: { fetchSync: vi.fn(), commitSync: vi.fn() },
}));

vi.mock('@/molecules/Toaster/toast', () => ({ toast: vi.fn() }));

describe('useConnectorSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mode.value = 'transaction-service';
    vi.mocked(ConnectorsController.fetchSync).mockResolvedValue(recordedSync());
  });

  it('loads the direction of each group with its default', async () => {
    const { result } = renderHook(() => useConnectorSync(RECORDED_CONNECTION_ID));

    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    const state = result.current.state;
    expect(state.status === 'ready' && state.sync.groups.map((group) => [group.fieldGroup, group.direction])).toEqual([
      ['content', 'from_store'],
      ['price', 'from_store'],
      ['variants', 'from_store'],
    ]);
  });

  it('saves one group, shows the service answer and tells the review to read again', async () => {
    const onSaved = vi.fn();
    const saved = recordedSync();
    saved.groups = saved.groups.map((group) => (group.fieldGroup === 'price' ? { ...group, direction: 'off' } : group));
    vi.mocked(ConnectorsController.commitSync).mockResolvedValue(saved);
    const { result } = renderHook(() => useConnectorSync(RECORDED_CONNECTION_ID, { onSaved }));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    let ok = false;
    await act(async () => {
      ok = await result.current.setDirection('price', 'off');
    });

    expect(ok).toBe(true);
    expect(ConnectorsController.commitSync).toHaveBeenCalledWith(RECORDED_CONNECTION_ID, { price: 'off' });
    expect(onSaved).toHaveBeenCalledTimes(1);
    const state = result.current.state;
    expect(state.status === 'ready' && state.sync.groups.find((group) => group.fieldGroup === 'price')?.direction).toBe(
      'off',
    );
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Price: off' }));
  });

  it('keeps the old setting and says so when the service refuses the save', async () => {
    const onSaved = vi.fn();
    vi.mocked(ConnectorsController.commitSync).mockRejectedValue(connectorRefusal('connection_not_connected', 409));
    const { result } = renderHook(() => useConnectorSync(RECORDED_CONNECTION_ID, { onSaved }));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    let ok = true;
    await act(async () => {
      ok = await result.current.setDirection('content', 'off');
    });

    expect(ok).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
    const state = result.current.state;
    expect(state.status === 'ready' && state.sync.groups[0]?.direction).toBe('from_store');
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }));
  });

  it('is quiet on a server with no store connections and loud about any other failure', async () => {
    vi.mocked(ConnectorsController.fetchSync).mockRejectedValueOnce(connectorRefusal('connectors_disabled', 404));
    const first = renderHook(() => useConnectorSync(RECORDED_CONNECTION_ID));
    await waitFor(() => expect(first.result.current.state.status).toBe('unavailable'));

    vi.mocked(ConnectorsController.fetchSync).mockRejectedValueOnce(bareHttpFailure(503));
    const second = renderHook(() => useConnectorSync(RECORDED_CONNECTION_ID));
    await waitFor(() => expect(second.result.current.state.status).toBe('failed'));
  });

  it('does nothing outside the live marketplace', () => {
    mode.value = 'local';

    renderHook(() => useConnectorSync(RECORDED_CONNECTION_ID));

    expect(ConnectorsController.fetchSync).not.toHaveBeenCalled();
  });
});
