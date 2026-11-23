'use client';

import { useEffect } from 'react';
import { ChatController } from '@/controllers/chat/chat';
import type { StoreThreadRoles } from '@/pipes/commerce/store-seller-side';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useChatStore } from '@/stores/chat/chat.store';

/**
 * The roles that tell a viewer's sale threads apart in a store it does not sell in, read on mount.
 * Chat live queries depend on the returned value, so they re-run once the roles arrive. Always null
 * outside store mode and for the store seller.
 */
export function useStoreThreadRoles(): StoreThreadRoles | null {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const roles = useChatStore((state) => state.storeThreadRoles);

  useEffect(() => {
    if (!currentUserPubky) return;
    void ChatController.fetchStoreThreadRoles().catch(() => {});
  }, [currentUserPubky]);

  return roles;
}
