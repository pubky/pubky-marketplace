import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { SELLER_PAYMENT_CONFIRM_PERSIST_KEY } from '../persistedKeys';
import {
  SellerPaymentConfirmActionTypes,
  sellerPaymentConfirmInitialState,
  type SellerPaymentConfirmStore,
} from './seller-payment-confirm.types';

/**
 * Device-level seller preference: whether this browser's Shop session
 * confirms the seller's matching payments for them. Kept on the device on
 * purpose, because the confirmation runs only here, while the seller is signed in.
 */
export const useSellerPaymentConfirmStore = create<SellerPaymentConfirmStore>()(
  devtools(
    persist(
      (set) => ({
        ...sellerPaymentConfirmInitialState,
        setAutoConfirm: (pubky, enabled) =>
          set(
            (state) => ({ autoConfirmByPubky: { ...state.autoConfirmByPubky, [pubky]: enabled } }),
            false,
            SellerPaymentConfirmActionTypes.SET_AUTO_CONFIRM,
          ),
      }),
      {
        name: SELLER_PAYMENT_CONFIRM_PERSIST_KEY,
        version: 1,
        partialize: (state) => ({ autoConfirmByPubky: state.autoConfirmByPubky }),
      },
    ),
    {
      name: 'seller-payment-confirm-store',
      enabled: process.env.NODE_ENV === 'development',
    },
  ),
);
