import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { DELIVERY_KEY_COPY } from '@/libs/commerce/delivery-key-copy';
import { toast } from '@/molecules/Toaster/use-toast';
import { useDeliveryKeyGate } from './useDeliveryKeyGate';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    resolveDeliveryKeysForCheckout: vi.fn(),
    commitAcceptDeliveryKeyChange: vi.fn(),
  },
}));
vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

const SELLER = 's'.repeat(52);
const KEY = { keyId: 'a'.repeat(32), publicKey: new Uint8Array(32) };

describe('useDeliveryKeyGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the resolved keys without asking the buyer', async () => {
    vi.mocked(CommerceController.resolveDeliveryKeysForCheckout).mockResolvedValue({
      ok: true,
      keys: new Map([[SELLER, KEY]]),
    });
    const { result } = renderHook(() => useDeliveryKeyGate());

    const outcome = await result.current.resolveKeys([SELLER]);

    expect(outcome).toEqual({ ok: true, keys: new Map([[SELLER, KEY]]) });
    expect(result.current.pendingChange).toBeNull();
  });

  it.each([
    ['no_key', DELIVERY_KEY_COPY.noKey],
    ['invalid', DELIVERY_KEY_COPY.invalid],
  ] as const)('stops with a toast when the seller key is %s', async (kind, description) => {
    vi.mocked(CommerceController.resolveDeliveryKeysForCheckout).mockResolvedValue({
      ok: false,
      sellerPubky: SELLER,
      problem: { kind },
    });
    const { result } = renderHook(() => useDeliveryKeyGate());

    expect(await result.current.resolveKeys([SELLER])).toEqual({ ok: false });
    expect(toast).toHaveBeenCalledWith({ variant: 'error', description });
  });

  it('pins and retries when the buyer accepts a changed key', async () => {
    vi.mocked(CommerceController.resolveDeliveryKeysForCheckout)
      .mockResolvedValueOnce({
        ok: false,
        sellerPubky: SELLER,
        problem: { kind: 'changed', pinnedKeyId: 'b'.repeat(32), currentKeyId: KEY.keyId },
      })
      .mockResolvedValueOnce({ ok: true, keys: new Map([[SELLER, KEY]]) });
    const { result } = renderHook(() => useDeliveryKeyGate());

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.resolveKeys([SELLER]);
    });
    await vi.waitFor(() => expect(result.current.pendingChange).not.toBeNull());
    expect(result.current.pendingChange).toEqual({
      sellerPubky: SELLER,
      pinnedKeyId: 'b'.repeat(32),
      currentKeyId: KEY.keyId,
    });
    act(() => result.current.decide(true));

    expect(await pending).toEqual({ ok: true, keys: new Map([[SELLER, KEY]]) });
    expect(CommerceController.commitAcceptDeliveryKeyChange).toHaveBeenCalledWith(SELLER, KEY.keyId);
    expect(result.current.pendingChange).toBeNull();
  });

  it('stops without pinning when the buyer declines a changed key', async () => {
    vi.mocked(CommerceController.resolveDeliveryKeysForCheckout).mockResolvedValue({
      ok: false,
      sellerPubky: SELLER,
      problem: { kind: 'changed', pinnedKeyId: 'b'.repeat(32), currentKeyId: KEY.keyId },
    });
    const { result } = renderHook(() => useDeliveryKeyGate());

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.resolveKeys([SELLER]);
    });
    await vi.waitFor(() => expect(result.current.pendingChange).not.toBeNull());
    act(() => result.current.decide(false));

    expect(await pending).toEqual({ ok: false });
    expect(CommerceController.commitAcceptDeliveryKeyChange).not.toHaveBeenCalled();
  });

  it('reports an unreachable homeserver instead of throwing', async () => {
    vi.mocked(CommerceController.resolveDeliveryKeysForCheckout).mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useDeliveryKeyGate());

    expect(await result.current.resolveKeys([SELLER])).toEqual({ ok: false });
    expect(toast).toHaveBeenCalledWith({ variant: 'error', description: DELIVERY_KEY_COPY.unreachable });
  });
});
