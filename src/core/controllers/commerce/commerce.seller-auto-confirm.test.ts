import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceApplication } from '@/application/commerce/commerce';
import type { CommerceAdapterMode } from '@/config/commerce';
import { useAuthStore } from '@/stores/auth/auth.store';
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
    expect(pass).toHaveBeenCalledWith(SELLER);
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
});
