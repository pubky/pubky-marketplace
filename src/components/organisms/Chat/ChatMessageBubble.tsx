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
  showContext = true,
}: {
  message: ChatMessageView;
  peerPubky: string;
  onRetry?: (id: string) => void;
  /** The thread shows a chip once per run of messages about the same listing or order. */
  showContext?: boolean;
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
        context={showContext ? message.context : null}
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
        <Typography as="span" size="xs" className="text-muted-foreground">
          {timeLabel(shownAt)}
        </Typography>
        {mine && message.status === 'queued' ? (
          message.last_error === 'peer_not_enabled' ? (
            <Typography as="span" size="xs" className="flex items-center gap-1 text-muted-foreground">
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
            <Typography as="span" size="xs" className="flex items-center gap-1 text-destructive">
              <AlertCircle className="size-3" aria-hidden="true" />
              Not sent
            </Typography>
            {onRetry ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto rounded-none border-0 p-0 text-xs font-medium text-foreground underline shadow-none"
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
