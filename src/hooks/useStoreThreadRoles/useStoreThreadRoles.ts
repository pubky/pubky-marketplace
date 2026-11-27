'use client';

import { useEffect } from 'react';
import { CHAT_STORE_ROLES_RETRY_BASE_MS, CHAT_STORE_ROLES_RETRY_MAX_MS } from '@/config/chat';
import { ChatController } from '@/controllers/chat/chat';
import { StoreSellerGate } from '@/controllers/store-seller-gate/store-seller-gate';
import type { StoreThreadRoles } from '@/pipes/commerce/store-seller-side';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useChatStore } from '@/stores/chat/chat.store';

/**
 * The roles that tell a viewer's sale threads apart in a store it does not sell in, read on mount and
 * retried with backoff while the read fails. Chat live queries depend on the returned value, so they
 * re-run once the roles arrive. Always null, with nothing read, outside store mode and for the store seller.
 */
export function useStoreThreadRoles(): StoreThreadRoles | null {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const roles = useChatStore((state) => state.storeThreadRoles);

  useEffect(() => {
    if (!currentUserPubky || StoreSellerGate.canSellHere(currentUserPubky)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = (attempt: number) => {
      ChatController.fetchStoreThreadRoles().catch(() => {
        if (stopped) return;
        const delay = Math.min(CHAT_STORE_ROLES_RETRY_MAX_MS, CHAT_STORE_ROLES_RETRY_BASE_MS * 2 ** attempt);
        timer = setTimeout(() => read(attempt + 1), delay);
      });
    };
    read(0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [currentUserPubky]);

  return roles;
}
