'use client';

import { CommerceController } from '@/controllers/commerce/commerce';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useSellerPaymentConfirmStore } from '@/stores/seller-payment-confirm/seller-payment-confirm.store';

/** The signed-in seller's automatic confirmation setting in this browser, and its switch. */
export function useSellerPaymentAutoConfirm(): { enabled: boolean; setEnabled: (enabled: boolean) => void } {
  const pubky = useAuthStore((state) => state.currentUserPubky);
  const enabled = useSellerPaymentConfirmStore((state) => (pubky ? state.autoConfirmByPubky[pubky] === true : false));
  return {
    enabled,
    setEnabled: (next) => CommerceController.setSellerPaymentAutoConfirm(next),
  };
}
