'use client';

import { StoreSellerGate } from '@/controllers/store-seller-gate/store-seller-gate';
import { useAuthStore } from '@/stores/auth/auth.store';

/** Whether the signed-in user may use selling tools here: always outside store mode, else only the store seller. */
export function useCanSellHere(): boolean {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  return StoreSellerGate.canSellHere(currentUserPubky);
}
