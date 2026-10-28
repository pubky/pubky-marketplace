import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { SellerPaymentConfirmCoordinator } from '@/coordinators/seller-payment-confirm/seller-payment-confirm';
import { SELLER_AUTO_CONFIRM_INTERVAL_MS } from '@/libs/commerce/seller-auto-confirm';
import { useAuthStore } from '@/stores/auth/auth.store';
import { mockSession } from '@/test-utils/pubky';

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('SellerPaymentConfirmCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    SellerPaymentConfirmCoordinator.resetInstance();
    useAuthStore.getState().reset();
  });

  afterEach(() => {
    SellerPaymentConfirmCoordinator.resetInstance();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs a confirmation pass on start and on every interval while signed in', async () => {
    const pass = vi.spyOn(CommerceController, 'autoConfirmSellerPayments').mockResolvedValue([]);
    useAuthStore.getState().init({ session: mockSession(), currentUserPubky: 's'.repeat(52), hasProfile: true });
    const coordinator = SellerPaymentConfirmCoordinator.getInstance();
    await coordinator.setRoute('/marketplace/orders');
    await coordinator.start();
    await flushPromises();
    expect(pass).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SELLER_AUTO_CONFIRM_INTERVAL_MS);
    expect(pass).toHaveBeenCalledTimes(2);

    coordinator.stop();
    await vi.advanceTimersByTimeAsync(SELLER_AUTO_CONFIRM_INTERVAL_MS * 2);
    expect(pass).toHaveBeenCalledTimes(2);
  });

  it('never runs signed out, and a failed pass does not stop the next one', async () => {
    const pass = vi.spyOn(CommerceController, 'autoConfirmSellerPayments').mockRejectedValue(new Error('down'));
    const coordinator = SellerPaymentConfirmCoordinator.getInstance();
    await coordinator.setRoute('/marketplace');
    await coordinator.start();
    await flushPromises();
    expect(pass).not.toHaveBeenCalled();

    useAuthStore.getState().init({ session: mockSession(), currentUserPubky: 's'.repeat(52), hasProfile: true });
    await flushPromises();
    expect(pass).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SELLER_AUTO_CONFIRM_INTERVAL_MS);
    expect(pass).toHaveBeenCalledTimes(2);
  });
});
