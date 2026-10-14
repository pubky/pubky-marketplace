'use client';

import { getChatRoute } from '@/app/routes';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { CHAT_INBOX_TIME_TICK_MS } from '@/config/chat';
import type { ChatConversationView } from '@/controllers/chat/chat.types';
import { useNowMs } from '@/hooks/useNowMs/useNowMs';
import { useRelativeTime } from '@/hooks/useRelativeTime/useRelativeTime';
import { cn } from '@/libs/utils/utils';
import { ChatPeerIdentity } from './ChatPeerIdentity';

export function ChatConversationRow({ conversation }: { conversation: ChatConversationView }) {
  const { formatRelativeTime } = useRelativeTime();
  const lastMessageAt = conversation.last_message_at;
  const nowMs = useNowMs(lastMessageAt !== null, CHAT_INBOX_TIME_TICK_MS);
  const unread = conversation.unreadCount > 0;
  const preview =
    conversation.last_message_preview === null
      ? conversation.peer_state === 'no_key'
        ? 'Waiting for them to set up messages'
        : 'No messages yet'
      : `${conversation.last_message_direction === 'sent' ? 'You: ' : ''}${conversation.last_message_preview}`;

  return (
    <Link
      href={getChatRoute(conversation.peer_pubky)}
      overrideDefaults
      data-testid="chat-conversation-row"
      data-unread={unread ? 'true' : 'false'}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-accent/40',
        unread && 'border-brand/40',
      )}
    >
      <ChatPeerIdentity peerPubky={conversation.peer_pubky} className="min-w-0 flex-1" subtitle={preview} />
      <div className="flex shrink-0 flex-col items-end gap-1">
        {lastMessageAt !== null ? (
          <Typography as="span" size="xs" className="text-muted-foreground">
            {formatRelativeTime(new Date(lastMessageAt), nowMs)}
          </Typography>
        ) : null}
        {unread ? (
          <span
            className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-semibold text-background"
            aria-label={`${conversation.unreadCount} unread`}
            data-testid="chat-conversation-unread"
          >
            {conversation.unreadCount > 21 ? '21+' : conversation.unreadCount}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
