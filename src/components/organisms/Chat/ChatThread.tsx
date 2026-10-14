'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Typography } from '@/atoms/Typography/Typography';
import type { ChatMessageView } from '@/controllers/chat/chat.types';
import { cn } from '@/libs/utils/utils';
import { ChatMessageBubble } from './ChatMessageBubble';

function dayLabel(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

/**
 * The scrolling message list: day separators, bubbles, "load older" at the
 * top, and a "new messages" pill when the user has scrolled up.
 */
export function ChatThread({
  messages,
  peerPubky,
  hasMore,
  onLoadOlder,
  onRetry,
  emptyHint,
  className,
}: {
  messages: ChatMessageView[];
  peerPubky: string;
  hasMore: boolean;
  onLoadOlder: () => void;
  onRetry: (id: string) => void;
  emptyHint?: string;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const newest = messages[messages.length - 1];
  const lastId = newest?.id;
  const previousLastId = useRef<string | undefined>(undefined);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const firstRender = previousLastId.current === undefined;
    const changed = lastId !== previousLastId.current;
    // My own send always goes to the bottom; the peer's messages only when I am already there.
    if (pinnedToBottom || firstRender || (changed && newest?.direction === 'sent')) {
      element.scrollTop = element.scrollHeight;
      setPinnedToBottom(true);
      setUnseen(0);
    } else if (changed) {
      const previousIndex = messages.findIndex((message) => message.id === previousLastId.current);
      const arrived = messages.slice(previousIndex + 1).filter((message) => message.direction === 'received').length;
      setUnseen((count) => count + arrived);
    }
    previousLastId.current = lastId;
    // `messages` changes identity on every live-query tick; lastId and pinnedToBottom capture the cases that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, pinnedToBottom]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const atBottom = distance < 48;
    setPinnedToBottom(atBottom);
    if (atBottom) setUnseen(0);
  };

  const jumpToBottom = () => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    setPinnedToBottom(true);
    setUnseen(0);
  };

  const days = messages.map((message) => dayLabel(message.clock_skewed ? message.received_at : message.sent_at));
  return (
    <div className={cn('relative min-h-0 flex-1', className)}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex h-full flex-col gap-3 overflow-y-auto overscroll-contain px-1 py-4"
        data-testid="chat-thread"
      >
        {hasMore ? (
          <div className="flex justify-center">
            <Button type="button" variant="secondary" size="sm" className="rounded-full" onClick={onLoadOlder}>
              Load older messages
            </Button>
          </div>
        ) : null}
        {messages.length === 0 && emptyHint ? (
          <div className="flex flex-1 items-center justify-center">
            <Typography as="p" size="sm" className="max-w-xs text-center text-muted-foreground">
              {emptyHint}
            </Typography>
          </div>
        ) : null}
        {messages.map((message, index) => {
          const day = days[index];
          const separator = index === 0 || days[index - 1] !== day;
          return (
            <div key={message.id} className="flex flex-col gap-3">
              {separator ? (
                <div className="flex items-center gap-3 py-1">
                  <div className="h-px flex-1 bg-border" />
                  <Typography as="span" size="xs" className="text-muted-foreground">
                    {day}
                  </Typography>
                  <div className="h-px flex-1 bg-border" />
                </div>
              ) : null}
              <ChatMessageBubble message={message} peerPubky={peerPubky} onRetry={onRetry} />
            </div>
          );
        })}
      </div>
      {!pinnedToBottom && unseen > 0 ? (
        <Button
          type="button"
          variant="brand"
          size="sm"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-lg"
          onClick={jumpToBottom}
        >
          <ArrowDown className="size-4" aria-hidden="true" />
          {unseen === 1 ? '1 new message' : `${unseen} new messages`}
        </Button>
      ) : null}
    </div>
  );
}
