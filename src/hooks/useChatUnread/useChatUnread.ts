'use client';

/**
 * Conversations with unread messages for the signed-in account. Placeholder
 * until the chat store lands: always 0.
 */
export function useChatUnread({ enabled = true }: { enabled?: boolean } = {}): number {
  return enabled ? 0 : 0;
}
