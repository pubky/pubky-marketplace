import type { ChatContext } from '@/models/chat/chat.schema';

/** Two contexts are the same when they point at the same listing and the same order (absent counts as null). */
export function sameChatContext(a: ChatContext | null | undefined, b: ChatContext | null | undefined): boolean {
  return (a?.listingId ?? null) === (b?.listingId ?? null) && (a?.orderId ?? null) === (b?.orderId ?? null);
}
