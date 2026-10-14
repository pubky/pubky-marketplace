'use client';

import { AlertCircle, Check, Clock } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Typography } from '@/atoms/Typography/Typography';
import type { ChatMessageView } from '@/controllers/chat/chat.types';
import { cn } from '@/libs/utils/utils';
import { ChatContextChip } from './ChatContextChip';

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function ChatMessageBubble({
  message,
  peerPubky,
  onRetry,
}: {
  message: ChatMessageView;
  peerPubky: string;
  onRetry?: (id: string) => void;
}) {
  const mine = message.direction === 'sent';
  const shownAt = message.clock_skewed ? message.received_at : message.sent_at;
  return (
    <div
      className={cn('flex w-full flex-col gap-1', mine ? 'items-end' : 'items-start')}
      data-testid="chat-message"
      data-direction={message.direction}
      data-status={message.status}
    >
      <ChatContextChip
        context={message.context}
        peerPubky={peerPubky}
        className={cn(mine ? 'justify-end' : 'justify-start')}
      />
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2 text-sm wrap-anywhere whitespace-pre-wrap sm:max-w-[70%]',
          mine ? 'rounded-br-md bg-brand text-background' : 'rounded-bl-md bg-secondary text-secondary-foreground',
          message.status === 'queued' && message.last_error === 'peer_not_enabled' && 'opacity-70',
          message.status === 'failed' && 'bg-destructive/20 text-foreground',
        )}
      >
        {message.body}
      </div>
      <div className="flex items-center gap-1.5 px-1">
        <Typography as="span" size="xs" className="text-muted-foreground" overrideDefaults>
          {timeLabel(shownAt)}
        </Typography>
        {mine && message.status === 'queued' ? (
          message.last_error === 'peer_not_enabled' ? (
            <Typography as="span" size="xs" className="flex items-center gap-1 text-muted-foreground" overrideDefaults>
              <Clock className="size-3" aria-hidden="true" />
              Waiting for them to set up messages
            </Typography>
          ) : (
            <Clock className="size-3 text-muted-foreground" aria-label="Sending" />
          )
        ) : null}
        {mine && message.status === 'sent' ? (
          <Check className="size-3 text-muted-foreground" aria-label="Sent" />
        ) : null}
        {mine && message.status === 'failed' ? (
          <>
            <Typography as="span" size="xs" className="flex items-center gap-1 text-destructive" overrideDefaults>
              <AlertCircle className="size-3" aria-hidden="true" />
              Not sent
            </Typography>
            {onRetry ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => onRetry(message.id)}
              >
                Retry
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
