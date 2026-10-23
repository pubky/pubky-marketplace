import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceOrderTrackingController } from '@/controllers/commerce/order-tracking';
import { PAYMENT_NOT_FINAL_COPY } from '@/libs/commerce/usdt-buyer-status';
import { toast } from '@/molecules/Toaster/use-toast';
import { createOrderFixture } from '@/test/fixtures/commerce/orders';
import { USDT_WIRE_PAYMENT_NOT_FINAL_REFUSAL } from '@/test/fixtures/commerce/usdt-orders';
import { useOrderTracking } from './useOrderTracking';

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/controllers/commerce/order-tracking', () => ({
  CommerceOrderTrackingController: { commitUpdateOrderTracking: vi.fn() },
}));

const commit = vi.mocked(CommerceOrderTrackingController.commitUpdateOrderTracking);

const shippedWithoutNumber = createOrderFixture('shipped', {
  shipment: {
    carrier: 'Other',
    trackingNumber: '',
    state: 'shipped',
    shippedAt: '2026-08-14T10:00:00.000Z',
    deliveredAt: null,
  },
});

function withErrors<T extends ReturnType<typeof useOrderTracking>>(value: T): T {
  void value.form.formState.errors;
  return value;
}

beforeEach(() => {
  vi.mocked(toast).mockClear();
  commit.mockReset().mockResolvedValue({ ok: true, result: { kind: 'order' } } as never);
});

describe('useOrderTracking', () => {
  it('starts from the carrier and number the order shows', () => {
    const { result } = renderHook(() => useOrderTracking(shippedWithoutNumber, vi.fn()));

    expect(result.current.form.getValues()).toEqual({ carrierChoice: 'other', carrier: '', trackingNumber: '' });
  });

  it('sends the curated carrier name and trimmed number at the order revision, then reloads', async () => {
    const onChanged = vi.fn();
    const { result } = renderHook(() => withErrors(useOrderTracking(shippedWithoutNumber, onChanged)));
    await act(async () => {
      result.current.form.setValue('carrierChoice', 'ups');
      result.current.form.setValue('trackingNumber', '  1Z999AA10123456784 ');
    });

    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(true);
    expect(commit).toHaveBeenCalledWith(
      shippedWithoutNumber.id,
      shippedWithoutNumber.revision,
      'UPS',
      '1Z999AA10123456784',
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ title: 'Tracking saved' });
  });

  it('sends Other when no carrier name is given and the seller text when it is', async () => {
    const { result } = renderHook(() => withErrors(useOrderTracking(shippedWithoutNumber, vi.fn())));
    await act(async () => {
      result.current.form.setValue('trackingNumber', 'CA-0001');
    });
    await act(async () => {
      await result.current.submit();
    });
    expect(commit).toHaveBeenLastCalledWith(expect.any(String), expect.any(Number), 'Other', 'CA-0001');

    await act(async () => {
      result.current.form.setValue('carrier', 'Correio da Aldeia');
    });
    await act(async () => {
      await result.current.submit();
    });
    expect(commit).toHaveBeenLastCalledWith(expect.any(String), expect.any(Number), 'Correio da Aldeia', 'CA-0001');
  });

  it('requires a carrier before saving, and never defaults one', async () => {
    const { result } = renderHook(() => withErrors(useOrderTracking(shippedWithoutNumber, vi.fn())));
    await act(async () => {
      result.current.form.setValue('carrierChoice', '');
      result.current.form.setValue('trackingNumber', 'X-1234');
    });

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(result.current.form.formState.errors.carrierChoice?.message).toBe('Select a carrier.');
  });

  it('refuses an empty tracking number without calling the service', async () => {
    const { result } = renderHook(() => withErrors(useOrderTracking(shippedWithoutNumber, vi.fn())));

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(result.current.form.formState.errors.trackingNumber?.message).toBe('Enter the tracking number.');
  });

  it('reloads and asks for a retry on a revision conflict', async () => {
    commit.mockResolvedValue({ ok: false, error: { code: 'REVISION_CONFLICT', message: 'stale' } } as never);
    const onChanged = vi.fn();
    const { result } = renderHook(() => withErrors(useOrderTracking(shippedWithoutNumber, onChanged)));
    await act(async () => {
      result.current.form.setValue('trackingNumber', 'X-1234');
    });

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(false);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }));
  });

  it('shows the service refusal and a thrown failure as error toasts', async () => {
    commit.mockResolvedValueOnce({
      ok: false,
      error: { code: 'INVALID_STATE', message: 'The order was delivered.' },
    } as never);
    const { result } = renderHook(() => withErrors(useOrderTracking(shippedWithoutNumber, vi.fn())));
    await act(async () => {
      result.current.form.setValue('trackingNumber', 'X-1234');
    });

    await act(async () => {
      expect(await result.current.submit()).toBe(false);
    });
    expect(toast).toHaveBeenLastCalledWith({ variant: 'error', description: 'The order was delivered.' });

    commit.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      expect(await result.current.submit()).toBe(false);
    });
    expect(toast).toHaveBeenLastCalledWith({ variant: 'error', description: 'Could not save tracking.' });
  });

  it('shows the payment-not-final copy when a USDT payment stops being final after shipping', async () => {
    commit.mockResolvedValueOnce(USDT_WIRE_PAYMENT_NOT_FINAL_REFUSAL as never);
    const { result } = renderHook(() => withErrors(useOrderTracking(shippedWithoutNumber, vi.fn())));
    await act(async () => {
      result.current.form.setValue('trackingNumber', 'X-1234');
    });

    await act(async () => {
      expect(await result.current.submit()).toBe(false);
    });

    expect(toast).toHaveBeenLastCalledWith({ variant: 'error', description: PAYMENT_NOT_FINAL_COPY });
  });
});
