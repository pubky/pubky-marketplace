import type { FlatNotification } from '@/models/notification/notification.types';

export interface UseNotificationsResult {
  notifications: FlatNotification[];
  /** Notifications that were unread when the user entered the page (for visual styling) */
  unreadNotifications: FlatNotification[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  markAllAsRead: () => void;
}
