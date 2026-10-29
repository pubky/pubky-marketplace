import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { SellerPaymentConfirmCoordinator } from '@/coordinators/seller-payment-confirm/seller-payment-confirm';
import { SELLER_AUTO_CONFIRM_INTERVAL_MS } from '@/libs/commerce/seller-auto-confirm';
import { useAuthStore } from '@/stores/auth/auth.store';
import { mockSession } from '@/test-utils/pubky';

vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>();
  // Notification polling may ignore visibility; confirmations never do.
  return { ...actual, getNotificationRespectPageVisibility: () => false };
});

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

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
    setVisibility('visible');
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

  it('pauses while the Shop is hidden, whatever the notification polling setting', async () => {
    const pass = vi.spyOn(CommerceController, 'autoConfirmSellerPayments').mockResolvedValue([]);
    setVisibility('hidden');
    useAuthStore.getState().init({ session: mockSession(), currentUserPubky: 's'.repeat(52), hasProfile: true });
    const coordinator = SellerPaymentConfirmCoordinator.getInstance();
    await coordinator.setRoute('/marketplace/orders');
    await coordinator.start();
    await vi.advanceTimersByTimeAsync(SELLER_AUTO_CONFIRM_INTERVAL_MS * 2);
    expect(pass).not.toHaveBeenCalled();

    setVisibility('visible');
    await flushPromises();
    expect(pass).toHaveBeenCalledTimes(1);
  });

  it('never starts a pass while the previous one is still running', async () => {
    let finish: (confirmed: string[]) => void = () => {};
    const pass = vi
      .spyOn(CommerceController, 'autoConfirmSellerPayments')
      .mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    useAuthStore.getState().init({ session: mockSession(), currentUserPubky: 's'.repeat(52), hasProfile: true });
    const coordinator = SellerPaymentConfirmCoordinator.getInstance();
    await coordinator.setRoute('/marketplace/orders');
    await coordinator.start();
    await vi.advanceTimersByTimeAsync(SELLER_AUTO_CONFIRM_INTERVAL_MS * 3);
    expect(pass).toHaveBeenCalledTimes(1);

    finish([]);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(SELLER_AUTO_CONFIRM_INTERVAL_MS);
    expect(pass).toHaveBeenCalledTimes(2);
  });

  it('keeps the setting in step with other tabs while it runs', async () => {
    const unsubscribe = vi.fn();
    const subscribe = vi
      .spyOn(CommerceController, 'subscribeSellerPaymentAutoConfirmSync')
      .mockReturnValue(unsubscribe);
    vi.spyOn(CommerceController, 'autoConfirmSellerPayments').mockResolvedValue([]);
    const coordinator = SellerPaymentConfirmCoordinator.getInstance();
    await coordinator.start();
    await coordinator.start();
    expect(subscribe).toHaveBeenCalledTimes(1);

    SellerPaymentConfirmCoordinator.resetInstance();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
