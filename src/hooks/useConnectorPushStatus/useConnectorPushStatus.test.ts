import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderPushRow, StorePushOverview } from '@/application/connectors/connectors';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { connectorAlertSchema, connectorPushSchema } from '@/libs/commerce/connectors';
import { toast } from '@/molecules/Toaster/use-toast';
import { connectorRefusal } from '@/test-utils/connector-errors';
import { connectionFixture } from '@/test-utils/connector-fixtures';
import { useConnectorPushStatus } from './useConnectorPushStatus';

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
  ConnectorsController: { fetchPushOverview: vi.fn(), commitRetryPush: vi.fn(), commitResolveAlert: vi.fn() },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

const connection = connectionFixture({
  id: 'c1',
  provider: 'woocommerce',
  domain: 'dezentralshop.ch',
  status: 'connected',
  scopes: ['read_write'],
});

function push(id: string, overrides: Record<string, unknown> = {}) {
  return connectorPushSchema.parse({
    id: `push-${id}`,
    pubkyOrderId: `order-${id}`,
    provider: 'woocommerce',
    state: 'created',
    externalId: '501',
    createdAt: '2026-10-15T12:00:00.000Z',
    updatedAt: '2026-10-15T12:00:00.000Z',
    ...overrides,
  });
}

function alert(id: string, kind: string, orderId: string | null) {
  return connectorAlertSchema.parse({
    id,
    connectionId: 'c1',
    kind,
    pubkyOrderId: orderId,
    createdAt: '2026-10-15T12:00:00.000Z',
  });
}

function overview(overrides: Partial<StorePushOverview> = {}): StorePushOverview {
  return { connections: [connection], pushes: [], alerts: [], ...overrides };
}

const quarantined = push('2', {
  state: 'quarantined',
  quarantineReason: 'unmapped_variant',
  quarantineSeverity: 'action_required',
});

describe('useConnectorPushStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mode.value = 'transaction-service';
  });

  it('is hidden for a seller with no connected store and no alerts', async () => {
    vi.mocked(ConnectorsController.fetchPushOverview).mockResolvedValue(overview({ connections: [] }));
    const { result } = renderHook(() => useConnectorPushStatus());
    await waitFor(() => expect(ConnectorsController.fetchPushOverview).toHaveBeenCalled());
    expect(result.current.visible).toBe(false);
  });

  it('is hidden when the service cannot be read, such as connectors switched off', async () => {
    vi.mocked(ConnectorsController.fetchPushOverview).mockRejectedValue(connectorRefusal('connectors_disabled', 404));
    const { result } = renderHook(() => useConnectorPushStatus());
    await waitFor(() => expect(ConnectorsController.fetchPushOverview).toHaveBeenCalled());
    expect(result.current.visible).toBe(false);
  });

  it('does not read outside the durable mode', () => {
    mode.value = 'sandbox';
    renderHook(() => useConnectorPushStatus());
    expect(ConnectorsController.fetchPushOverview).not.toHaveBeenCalled();
  });

  it('separates orders that need action from the ones in the store', async () => {
    vi.mocked(ConnectorsController.fetchPushOverview).mockResolvedValue(
      overview({
        pushes: [
          { connection, push: push('1') },
          { connection, push: quarantined },
          {
            connection,
            push: push('3', {
              state: 'quarantined',
              quarantineReason: 'order_cancelled_before_push',
              quarantineSeverity: 'info',
            }),
          },
        ],
      }),
    );
    const { result } = renderHook(() => useConnectorPushStatus());
    await waitFor(() => expect(result.current.visible).toBe(true));

    expect(result.current.needsAttention.map((row) => row.push.pubkyOrderId)).toEqual(['order-2']);
    expect(result.current.pushes).toHaveLength(3);
  });

  it('shows an alert once: the push_quarantined alert of a listed order folds into its row', async () => {
    vi.mocked(ConnectorsController.fetchPushOverview).mockResolvedValue(
      overview({
        pushes: [{ connection, push: quarantined }],
        alerts: [alert('a1', 'push_quarantined', 'order-2'), alert('a2', 'merchant_cancelled', 'order-9')],
      }),
    );
    const { result } = renderHook(() => useConnectorPushStatus());
    await waitFor(() => expect(result.current.visible).toBe(true));

    expect(result.current.alerts.map((entry) => entry.id)).toEqual(['a2']);
  });

  it('retries a quarantined order and shows it as sending', async () => {
    const row: OrderPushRow = { connection, push: quarantined };
    vi.mocked(ConnectorsController.fetchPushOverview).mockResolvedValue(overview({ pushes: [row] }));
    vi.mocked(ConnectorsController.commitRetryPush).mockResolvedValue(
      push('2', { state: 'sending', quarantineReason: null, quarantineSeverity: null }),
    );
    const { result } = renderHook(() => useConnectorPushStatus());
    await waitFor(() => expect(result.current.visible).toBe(true));

    await act(async () => {
      expect(await result.current.retry(row)).toBe(true);
    });

    expect(ConnectorsController.commitRetryPush).toHaveBeenCalledWith('c1', 'order-2');
    expect(result.current.pushes[0]?.push.state).toBe('sending');
    expect(result.current.needsAttention).toEqual([]);
  });

  it.each([
    ['not_retryable', 'This order is not waiting for a retry any more.'],
    ['already_created', 'This order is already in your store.'],
  ])('explains a %s refusal', async (reason, description) => {
    const row: OrderPushRow = { connection, push: quarantined };
    vi.mocked(ConnectorsController.fetchPushOverview).mockResolvedValue(overview({ pushes: [row] }));
    vi.mocked(ConnectorsController.commitRetryPush).mockRejectedValue(connectorRefusal(reason));
    const { result } = renderHook(() => useConnectorPushStatus());
    await waitFor(() => expect(result.current.visible).toBe(true));

    await act(async () => {
      expect(await result.current.retry(row)).toBe(false);
    });

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', description }));
    expect(result.current.pushes[0]?.push.state).toBe('quarantined');
  });

  it('dismisses an alert', async () => {
    vi.mocked(ConnectorsController.fetchPushOverview).mockResolvedValue(
      overview({ alerts: [alert('a2', 'merchant_cancelled', 'order-9')] }),
    );
    vi.mocked(ConnectorsController.commitResolveAlert).mockResolvedValue();
    const { result } = renderHook(() => useConnectorPushStatus());
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));

    await act(async () => {
      expect(await result.current.dismissAlert('a2')).toBe(true);
    });

    expect(ConnectorsController.commitResolveAlert).toHaveBeenCalledWith('a2');
    expect(result.current.alerts).toEqual([]);
  });
});
