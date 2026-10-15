import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShopHostSnapshot } from '@/libs/shop-session/bridge';
import { useShopHostSession } from './useShopHostSession';

const mocks = vi.hoisted(() => ({
  hosted: true,
  embedded: true,
  ancestors: [] as string[],
  mode: vi.fn(),
  apply: vi.fn<(snapshot: ShopHostSnapshot) => Promise<string>>(),
  request: vi.fn(),
  parse: vi.fn(),
}));
vi.mock('@/controllers/auth/auth', () => ({
  AuthController: { setHostSessionMode: mocks.mode, applyHostSession: mocks.apply },
}));
vi.mock('@/stores/auth/auth.store', () => ({ useAuthStore: () => false }));
vi.mock('@/libs/runtime-config/runtime-config', () => ({
  getEmbeddedFlag: () => mocks.embedded,
  getFrameAncestors: () => mocks.ancestors,
}));
vi.mock('@/libs/shop-session/bridge', () => ({
  getShopHostWindow: () => (mocks.hosted ? window : null),
  parseShopHostSession: mocks.parse,
  requestShopHostAction: mocks.request,
  shopWrapperReturnPath: () => null,
}));

const ready: ShopHostSnapshot = {
  generation: 'A',
  status: 'ready',
  pubky: 'alice',
  clientId: 'pubky.app',
  grantId: 'grant-A',
  sessionStoreId: 'record-A',
};
const signedOut: ShopHostSnapshot = {
  generation: 'B',
  status: 'signed-out',
  pubky: null,
  clientId: null,
  grantId: null,
  sessionStoreId: null,
};
function dispatch(snapshot: ShopHostSnapshot) {
  mocks.parse.mockReturnValue(snapshot);
  window.dispatchEvent(new MessageEvent('message'));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.hosted = true;
  mocks.embedded = true;
  mocks.ancestors = [];
  mocks.apply.mockImplementation(async (snapshot) => snapshot.status);
});

describe('host session lifecycle hook', () => {
  it('establishes host ownership before exposing configured content, then restores an exact snapshot', async () => {
    const { result } = renderHook(useShopHostSession);
    expect(mocks.mode).toHaveBeenCalledWith(true);
    expect(result.current.configured).toBe(true);
    expect(mocks.request).toHaveBeenCalledWith('ready');
    act(() => dispatch(ready));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mocks.apply).toHaveBeenCalledWith(ready);
  });
  it('does not send or consume a bridge handshake in standalone mode', () => {
    mocks.hosted = false;
    mocks.embedded = false;
    const { result } = renderHook(useShopHostSession);
    expect(result.current.hosted).toBe(false);
    expect(mocks.mode).toHaveBeenCalledWith(false);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('does not re-enter restore or cancel mounted Shop state for an identical App snapshot', async () => {
    const { result } = renderHook(useShopHostSession);
    act(() => dispatch(ready));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => dispatch({ ...ready }));
    expect(result.current.status).toBe('ready');
    expect(mocks.apply).toHaveBeenCalledTimes(1);
  });
  it('never lets a late restore make the UI ready after a logout snapshot', async () => {
    let finish!: (value: string) => void;
    mocks.apply.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(useShopHostSession);
    act(() => dispatch(ready));
    act(() => dispatch(signedOut));
    await waitFor(() => expect(result.current.status).toBe('signed-out'));
    await act(async () => finish('ready'));
    expect(result.current.status).toBe('signed-out');
  });
  it('keeps logout gated until serialized private cleanup finishes', async () => {
    const { result } = renderHook(useShopHostSession);
    act(() => dispatch(ready));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let finish!: (value: string) => void;
    mocks.apply.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    act(() => dispatch(signedOut));
    expect(result.current.status).toBe('restoring');
    await act(async () => finish('signed-out'));
    expect(result.current.status).toBe('signed-out');
  });
  it('shows a retryable failure without asking for logout or discarding any reference', async () => {
    mocks.apply.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(useShopHostSession);
    act(() => dispatch(ready));
    await waitFor(() => expect(result.current.status).toBe('temporary-error'));
    act(() => result.current.retry());
    expect(mocks.request.mock.calls.map(([type]) => type)).toEqual(['ready', 'request-retry']);
    act(() => dispatch(ready));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mocks.apply).toHaveBeenCalledTimes(2);
    expect(mocks.apply).toHaveBeenLastCalledWith(ready);
  });
  it('ignores messages rejected by the transport validator and stops listening after unmount', () => {
    mocks.parse.mockReturnValue(null);
    const { unmount } = renderHook(useShopHostSession);
    act(() => window.dispatchEvent(new MessageEvent('message')));
    expect(mocks.apply).not.toHaveBeenCalled();
    unmount();
    act(() => dispatch(ready));
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});
