import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommerceAdapterMode } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { SellerPaymentConfirmCoordinator } from '@/coordinators/seller-payment-confirm/seller-payment-confirm';
import { SELLER_AUTO_CONFIRM_INTERVAL_MS } from '@/libs/commerce/seller-auto-confirm';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { mockSession } from '@/test-utils/pubky';

const commerceConfig = vi.hoisted(() => ({ mode: 'locks-paykit' as CommerceAdapterMode }));

vi.mock('@/config/commerce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/commerce')>();
  return { ...actual, getCommerceAdapterMode: () => commerceConfig.mode };
});

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
  await Promise.resolve();
}

describe('SellerPaymentConfirmCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    SellerPaymentConfirmCoordinator.resetInstance();
    useAuthStore.getState().reset();
    useCommerceStore.getState().reset();
    commerceConfig.mode = 'locks-paykit';
    vi.spyOn(CommerceController, 'hasActiveMarketplaceSession').mockReturnValue(true);
    vi.spyOn(CommerceController, 'fetchPaymentConfirmationMode').mockResolvedValue('seller');
  });

  afterEach(() => {
    SellerPaymentConfirmCoordinator.resetInstance();
    setVisibility('visible');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('pauses payment confirmation on /complete-profile', async () => {
    const pass = vi.spyOn(CommerceController, 'autoConfirmSellerPayments').mockResolvedValue([]);
    useAuthStore.getState().init({ session: mockSession(), currentUserPubky: 's'.repeat(52), hasProfile: true });
    const coordinator = SellerPaymentConfirmCoordinator.getInstance();
    await coordinator.setRoute('/complete-profile');
    await coordinator.start();
    await vi.advanceTimersByTimeAsync(SELLER_AUTO_CONFIRM_INTERVAL_MS * 2);
    expect(pass).not.toHaveBeenCalled();
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

  it.each(['automatic', null] as const)(
    'stays completely inert when paymentConfirmation is %s and stops polling',
    async (mode) => {
      const fetchMode = vi.spyOn(CommerceController, 'fetchPaymentConfirmationMode').mockResolvedValue(mode);
      const pass = vi.spyOn(CommerceController, 'autoConfirmSellerPayments').mockResolvedValue([]);
      useAuthStore.getState().init({ session: mockSession(), currentUserPubky: 's'.repeat(52), hasProfile: true });
      const coordinator = SellerPaymentConfirmCoordinator.getInstance();
      await coordinator.setRoute('/marketplace/orders');
      await coordinator.start();
      await flushPromises();

      expect(fetchMode).toHaveBeenCalledTimes(1);
      expect(pass).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(SELLER_AUTO_CONFIRM_INTERVAL_MS * 5);
      expect(fetchMode).toHaveBeenCalledTimes(1);
      expect(pass).not.toHaveBeenCalled();
    },
  );

  it('stays completely inert without an active marketplace session and starts when a session connects', async () => {
    const hasSession = vi.spyOn(CommerceController, 'hasActiveMarketplaceSession').mockReturnValue(false);
    const fetchMode = vi.spyOn(CommerceController, 'fetchPaymentConfirmationMode').mockResolvedValue('seller');
    const pass = vi.spyOn(CommerceController, 'autoConfirmSellerPayments').mockResolvedValue([]);
    useAuthStore.getState().init({ session: mockSession(), currentUserPubky: 's'.repeat(52), hasProfile: true });
    const coordinator = SellerPaymentConfirmCoordinator.getInstance();
    await coordinator.setRoute('/marketplace/orders');
    await coordinator.start();
    await vi.advanceTimersByTimeAsync(SELLER_AUTO_CONFIRM_INTERVAL_MS * 3);

    expect(fetchMode).not.toHaveBeenCalled();
    expect(pass).not.toHaveBeenCalled();

    hasSession.mockReturnValue(true);
    useCommerceStore.getState().setMarketplaceSession({
      pubky: 's'.repeat(52),
      capabilities: '/pub/pubky.app/:rw',
      issuedAt: '2026-11-27T00:00:00.000Z',
      expiresAt: '2026-11-28T00:00:00.000Z',
    });
    await flushPromises();

    expect(fetchMode).toHaveBeenCalledTimes(1);
    expect(pass).toHaveBeenCalledTimes(1);
  });

  it.each(['sandbox', 'unavailable'] as const)('stays completely inert in %s mode', async (mode) => {
    commerceConfig.mode = mode;
    const fetchMode = vi.spyOn(CommerceController, 'fetchPaymentConfirmationMode').mockResolvedValue('seller');
    const pass = vi.spyOn(CommerceController, 'autoConfirmSellerPayments').mockResolvedValue([]);
    useAuthStore.getState().init({ session: mockSession(), currentUserPubky: 's'.repeat(52), hasProfile: true });
    const coordinator = SellerPaymentConfirmCoordinator.getInstance();
    await coordinator.setRoute('/marketplace/orders');
    await coordinator.start();
    await vi.advanceTimersByTimeAsync(SELLER_AUTO_CONFIRM_INTERVAL_MS * 2);

    expect(fetchMode).not.toHaveBeenCalled();
    expect(pass).not.toHaveBeenCalled();
  });

  it('retries mode detection on the next interval if the initial /health check fails transiently', async () => {
    const fetchMode = vi
      .spyOn(CommerceController, 'fetchPaymentConfirmationMode')
      .mockRejectedValueOnce(new Error('health down'))
      .mockResolvedValueOnce('seller');
    const pass = vi.spyOn(CommerceController, 'autoConfirmSellerPayments').mockResolvedValue([]);
    useAuthStore.getState().init({ session: mockSession(), currentUserPubky: 's'.repeat(52), hasProfile: true });
    const coordinator = SellerPaymentConfirmCoordinator.getInstance();
    await coordinator.setRoute('/marketplace/orders');
    await coordinator.start();
    await flushPromises();

    expect(fetchMode).toHaveBeenCalledTimes(1);
    expect(pass).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SELLER_AUTO_CONFIRM_INTERVAL_MS);
    await flushPromises();

    expect(fetchMode).toHaveBeenCalledTimes(2);
    expect(pass).toHaveBeenCalledTimes(1);
  });

  it('re-checks deployment mode when marketplaceSession changes after latching inactive', async () => {
    const fetchMode = vi
      .spyOn(CommerceController, 'fetchPaymentConfirmationMode')
      .mockResolvedValueOnce('automatic')
      .mockResolvedValueOnce('seller');
    const pass = vi.spyOn(CommerceController, 'autoConfirmSellerPayments').mockResolvedValue([]);
    useAuthStore.getState().init({ session: mockSession(), currentUserPubky: 's'.repeat(52), hasProfile: true });
    const coordinator = SellerPaymentConfirmCoordinator.getInstance();
    await coordinator.setRoute('/marketplace/orders');
    await coordinator.start();
    await flushPromises();

    expect(fetchMode).toHaveBeenCalledTimes(1);
    expect(pass).not.toHaveBeenCalled();

    useCommerceStore.getState().setMarketplaceSession({
      pubky: 's'.repeat(52),
      capabilities: '/pub/pubky.app/:rw',
      issuedAt: '2026-11-27T01:00:00.000Z',
      expiresAt: '2026-11-28T01:00:00.000Z',
    });
    await flushPromises();

    expect(fetchMode).toHaveBeenCalledTimes(2);
    expect(pass).toHaveBeenCalledTimes(1);
  });
});
