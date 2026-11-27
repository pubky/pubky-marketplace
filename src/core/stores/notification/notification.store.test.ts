import { beforeEach, describe, expect, it } from 'vitest';
import { NOTIFICATION_PERSIST_KEY } from '@/stores/persistedKeys';
import { useNotificationStore } from './notification.store';

describe('NotificationStore', () => {
  beforeEach(() => {
    useNotificationStore.getState().reset();
  });

  it('sets and gets marketplace unread count', () => {
    const store = useNotificationStore.getState();

    store.setMarketplaceUnread(3);
    expect(store.selectMarketplaceUnread()).toBe(3);
  });

  it('prevents negative marketplace unread count', () => {
    const store = useNotificationStore.getState();

    store.setMarketplaceUnread(-3);
    expect(store.selectMarketplaceUnread()).toBe(0);
  });

  it('rehydrates only the Market counter from the legacy record and drops social fields on the next write', async () => {
    localStorage.setItem(
      NOTIFICATION_PERSIST_KEY,
      JSON.stringify({
        state: { lastRead: 123, lastPolledTimestamp: 456, unread: 7, marketplaceUnread: 3 },
        version: 0,
      }),
    );

    await useNotificationStore.persist.rehydrate();
    expect(useNotificationStore.getState().selectMarketplaceUnread()).toBe(3);
    expect(useNotificationStore.getState()).not.toHaveProperty('lastRead');
    useNotificationStore.getState().reset();
    expect(JSON.parse(localStorage.getItem(NOTIFICATION_PERSIST_KEY)!)).toEqual({
      state: { marketplaceUnread: 0 },
      version: 0,
    });
  });
});
