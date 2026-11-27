import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { NOTIFICATION_PERSIST_KEY } from '../persistedKeys';
import type { NotificationStore } from './notification.types';

export const useNotificationStore = create<NotificationStore>()(
  devtools(
    persist(
      (set, get) => ({
        marketplaceUnread: 0,
        selectMarketplaceUnread: () => get().marketplaceUnread,
        setMarketplaceUnread: (count) =>
          set({ marketplaceUnread: Math.max(0, count) }, false, 'SET_MARKETPLACE_UNREAD'),
        reset: () => set({ marketplaceUnread: 0 }, false, 'RESET'),
      }),
      {
        name: NOTIFICATION_PERSIST_KEY,
        partialize: ({ marketplaceUnread }) => ({ marketplaceUnread }),
        // Earlier Shop versions persisted the retired social notification counters in the same record.
        merge: (persisted, current) => {
          const count = (persisted as Partial<Pick<NotificationStore, 'marketplaceUnread'>> | null)?.marketplaceUnread;
          return {
            ...current,
            marketplaceUnread: typeof count === 'number' && Number.isFinite(count) ? Math.max(0, count) : 0,
          };
        },
      },
    ),
    { name: 'notification-store', enabled: process.env.NODE_ENV === 'development' },
  ),
);
