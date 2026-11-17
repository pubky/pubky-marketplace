import { describe, expect, it } from 'vitest';
import { NotificationModel } from './notification';
import { FlatNotification, NotificationType } from './notification.types';

// Factory for creating test notifications with business key as id
const createNotification = (timestamp: number, type = NotificationType.Follow): FlatNotification => {
  const followed_by = `user-${timestamp}`;
  return {
    id: `${type}:${timestamp}:${followed_by}`, // Business key format
    type,
    timestamp,
    followed_by,
  } as FlatNotification;
};

const createReply = (timestamp: number): FlatNotification => {
  const replied_by = `user-${timestamp}`;
  const reply_uri = `reply-${timestamp}`;
  return {
    id: `${NotificationType.Reply}:${timestamp}:${replied_by}:${reply_uri}`, // Business key format
    type: NotificationType.Reply,
    timestamp,
    replied_by,
    parent_post_uri: 'post123',
    reply_uri,
  } as FlatNotification;
};

describe('NotificationModel', () => {
  describe('bulkSave', () => {
    it('should save notifications to IndexedDB', async () => {
      const notifications = [createNotification(1000), createReply(2000)];

      await NotificationModel.bulkSave(notifications);

      const saved = await NotificationModel.table.toArray();
      expect(saved).toHaveLength(2);
      expect(saved.map((n) => n.type)).toEqual([NotificationType.Follow, NotificationType.Reply]);
    });
  });

  describe('constructor', () => {
    it('should create notification instance with all properties', () => {
      const data = createNotification(1000);
      const notification = new NotificationModel(data);

      expect(notification.type).toBe(NotificationType.Follow);
      expect(notification.timestamp).toBe(1000);
    });
  });

  describe('getOlderThan', () => {
    it('should return notifications older than timestamp in descending order', async () => {
      await NotificationModel.bulkSave([1000, 2000, 3000, 4000, 5000].map((t) => createNotification(t)));

      const result = await NotificationModel.getOlderThan(4000, 10);

      expect(result.map((n) => n.timestamp)).toEqual([3000, 2000, 1000]);
    });

    it('should respect limit parameter', async () => {
      await NotificationModel.bulkSave([1000, 2000, 3000, 4000].map((t) => createNotification(t)));

      const result = await NotificationModel.getOlderThan(5000, 2);

      expect(result.map((n) => n.timestamp)).toEqual([4000, 3000]);
    });

    it.each([
      { olderThan: 3000, timestamps: [5000, 6000], expected: 0 },
      { olderThan: Infinity, timestamps: [1000, 2000, 3000], expected: 3 },
      { olderThan: 2000, timestamps: [1000, 2000, 3000], expected: 1 }, // Excludes equal timestamp
    ])('olderThan=$olderThan returns $expected notifications', async ({ olderThan, timestamps, expected }) => {
      await NotificationModel.bulkSave(timestamps.map((t) => createNotification(t)));

      const result = await NotificationModel.getOlderThan(olderThan, 10);

      expect(result).toHaveLength(expected);
    });

    it('should return empty array when table is empty', async () => {
      const result = await NotificationModel.getOlderThan(Infinity, 10);
      expect(result).toHaveLength(0);
    });
  });

  describe('countFilteredNewerThan', () => {
    it('should count only notifications with matching types above the timestamp', async () => {
      await NotificationModel.bulkSave([
        createNotification(1000, NotificationType.Follow),
        createNotification(2000, NotificationType.Follow),
        createReply(3000),
      ]);

      const count = await NotificationModel.countFilteredNewerThan(500, [NotificationType.Follow]);

      expect(count).toBe(2);
    });

    it('should exclude notifications of types not in allowedTypes', async () => {
      await NotificationModel.bulkSave([createNotification(2000, NotificationType.Follow), createReply(3000)]);

      const count = await NotificationModel.countFilteredNewerThan(1000, [NotificationType.Reply]);

      expect(count).toBe(1);
    });

    it('should exclude notifications at or below the timestamp boundary', async () => {
      await NotificationModel.bulkSave([
        createNotification(1000, NotificationType.Follow),
        createNotification(2000, NotificationType.Follow),
        createNotification(3000, NotificationType.Follow),
      ]);

      const count = await NotificationModel.countFilteredNewerThan(2000, [NotificationType.Follow]);

      expect(count).toBe(1);
    });

    it('should return 0 when no notifications match', async () => {
      await NotificationModel.bulkSave([createNotification(1000, NotificationType.Follow)]);

      const count = await NotificationModel.countFilteredNewerThan(1000, [NotificationType.Reply]);

      expect(count).toBe(0);
    });

    it('should return 0 when allowedTypes is empty', async () => {
      await NotificationModel.bulkSave([createNotification(2000, NotificationType.Follow)]);

      const count = await NotificationModel.countFilteredNewerThan(1000, []);

      expect(count).toBe(0);
    });

    it('should return 0 on empty table', async () => {
      const count = await NotificationModel.countFilteredNewerThan(0, [NotificationType.Follow]);

      expect(count).toBe(0);
    });
  });

  describe('clear', () => {
    it('should remove all notifications', async () => {
      await NotificationModel.bulkSave([createNotification(1000), createNotification(2000)]);
      expect(await NotificationModel.table.count()).toBe(2);

      await NotificationModel.clear();

      expect(await NotificationModel.table.count()).toBe(0);
    });

    it('should not throw when table is already empty', async () => {
      await expect(NotificationModel.clear()).resolves.not.toThrow();
    });
  });
});
