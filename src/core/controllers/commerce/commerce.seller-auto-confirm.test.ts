import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceApplication } from '@/application/commerce/commerce';
import type { CommerceAdapterMode } from '@/config/commerce';
import { SELLER_AUTO_CONFIRM_PASS_TIMEOUT_MS } from '@/libs/commerce/seller-auto-confirm';
import { useAuthStore } from '@/stores/auth/auth.store';
import { SELLER_PAYMENT_CONFIRM_PERSIST_KEY } from '@/stores/persistedKeys';
import { useSellerPaymentConfirmStore } from '@/stores/seller-payment-confirm/seller-payment-confirm.store';
import { CommerceController } from './commerce';

const commerceConfig = vi.hoisted(() => ({ mode: 'transaction-service' as string }));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => commerceConfig.mode as CommerceAdapterMode };
});

const SELLER = 's'.repeat(52);
const OTHER = 'o'.repeat(52);

describe('CommerceController seller auto-confirm', () => {
  beforeEach(() => {
    commerceConfig.mode = 'transaction-service';
    useAuthStore.getState().setCurrentUserPubky(SELLER);
    useSellerPaymentConfirmStore.setState({ autoConfirmByPubky: {} });
  });

  afterEach(() => {
    useAuthStore.getState().setCurrentUserPubky(null);
    vi.restoreAllMocks();
  });

  it('confirms nothing until the signed-in seller turns it on in this browser', async () => {
    const pass = vi.spyOn(CommerceApplication, 'autoConfirmSellerPayments').mockResolvedValue(['order-1']);

    await expect(CommerceController.autoConfirmSellerPayments()).resolves.toEqual([]);
    expect(pass).not.toHaveBeenCalled();

    CommerceController.setSellerPaymentAutoConfirm(true);
    expect(useSellerPaymentConfirmStore.getState().autoConfirmByPubky).toEqual({ [SELLER]: true });
    await expect(CommerceController.autoConfirmSellerPayments()).resolves.toEqual(['order-1']);
    expect(pass).toHaveBeenCalledWith(SELLER, expect.any(Function), expect.any(AbortSignal));
  });

  it('keeps the setting per pubky, so another account on the device is not confirmed for', async () => {
    const pass = vi.spyOn(CommerceApplication, 'autoConfirmSellerPayments').mockResolvedValue([]);
    CommerceController.setSellerPaymentAutoConfirm(true);
    useAuthStore.getState().setCurrentUserPubky(OTHER);

    await expect(CommerceController.autoConfirmSellerPayments()).resolves.toEqual([]);
    expect(pass).not.toHaveBeenCalled();
  });

  it('does nothing outside the durable service', async () => {
    const pass = vi.spyOn(CommerceApplication, 'autoConfirmSellerPayments').mockResolvedValue([]);
    CommerceController.setSellerPaymentAutoConfirm(true);
    commerceConfig.mode = 'sandbox';

    await expect(CommerceController.autoConfirmSellerPayments()).resolves.toEqual([]);
    expect(pass).not.toHaveBeenCalled();
  });

  it('asks the store again before each confirmation, so an opt-out or account switch mid-pass stops it', async () => {
    let isStillEnabled: (() => boolean) | undefined;
    vi.spyOn(CommerceApplication, 'autoConfirmSellerPayments').mockImplementation(async (_pubky, check) => {
      isStillEnabled = check;
      return [];
    });
    CommerceController.setSellerPaymentAutoConfirm(true);
    await CommerceController.autoConfirmSellerPayments();
    expect(isStillEnabled?.()).toBe(true);

    CommerceController.setSellerPaymentAutoConfirm(false);
    expect(isStillEnabled?.()).toBe(false);

    CommerceController.setSellerPaymentAutoConfirm(true);
    useAuthStore.getState().setCurrentUserPubky(OTHER);
    expect(isStillEnabled?.()).toBe(false);
  });

  it('reads a change made in another tab into this tab', async () => {
    CommerceController.setSellerPaymentAutoConfirm(true);
    const unsubscribe = CommerceController.subscribeSellerPaymentAutoConfirmSync();
    try {
      const otherTab = JSON.stringify({ state: { autoConfirmByPubky: { [SELLER]: false } }, version: 1 });
      window.localStorage.setItem(SELLER_PAYMENT_CONFIRM_PERSIST_KEY, otherTab);
      window.dispatchEvent(
        new StorageEvent('storage', { key: SELLER_PAYMENT_CONFIRM_PERSIST_KEY, newValue: otherTab }),
      );
      await vi.waitFor(() => expect(useSellerPaymentConfirmStore.getState().autoConfirmByPubky[SELLER]).toBe(false));

      const pass = vi.spyOn(CommerceApplication, 'autoConfirmSellerPayments').mockResolvedValue(['order-1']);
      await expect(CommerceController.autoConfirmSellerPayments()).resolves.toEqual([]);
      expect(pass).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('ignores storage changes to other keys and stops listening once unsubscribed', async () => {
    CommerceController.setSellerPaymentAutoConfirm(true);
    const rehydrate = vi.spyOn(useSellerPaymentConfirmStore.persist, 'rehydrate');
    const unsubscribe = CommerceController.subscribeSellerPaymentAutoConfirmSync();
    window.dispatchEvent(new StorageEvent('storage', { key: 'some-other-key' }));
    expect(rehydrate).not.toHaveBeenCalled();
    unsubscribe();
    window.dispatchEvent(new StorageEvent('storage', { key: SELLER_PAYMENT_CONFIRM_PERSIST_KEY }));
    expect(rehydrate).not.toHaveBeenCalled();
  });

  it('aborts a pass that outlives its deadline, so a request that never answers cannot hold it', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      vi.spyOn(CommerceApplication, 'autoConfirmSellerPayments').mockImplementation(
        (_pubky, _check, passSignal) =>
          new Promise((resolve) => {
            signal = passSignal;
            passSignal.addEventListener('abort', () => resolve([]));
          }),
      );
      CommerceController.setSellerPaymentAutoConfirm(true);
      const result = CommerceController.autoConfirmSellerPayments();
      await vi.advanceTimersByTimeAsync(SELLER_AUTO_CONFIRM_PASS_TIMEOUT_MS - 1);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal?.aborted).toBe(true);
      await expect(result).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('turns the setting off here when another tab removes it or clears storage', () => {
    const unsubscribe = CommerceController.subscribeSellerPaymentAutoConfirmSync();
    try {
      for (const key of [SELLER_PAYMENT_CONFIRM_PERSIST_KEY, null]) {
        CommerceController.setSellerPaymentAutoConfirm(true);
        window.dispatchEvent(new StorageEvent('storage', { key, newValue: null }));
        expect(useSellerPaymentConfirmStore.getState().autoConfirmByPubky).toEqual({});
      }
    } finally {
      unsubscribe();
    }
  });
});
