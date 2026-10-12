'use client';

import { Typography } from '@/atoms/Typography/Typography';
import { CHAT_COPY } from '@/libs/chat/copy';

/** Conversation list. Placeholder until the chat core lands. */
export function Chat() {
  return (
    <main data-surface="chat-inbox" className="mx-auto flex w-full max-w-4xl flex-col gap-2 px-4 py-6">
      <Typography as="h1" size="2xl" className="font-bold">
        {CHAT_COPY.inboxTitle}
      </Typography>
      <Typography as="p" className="text-muted-foreground">
        {CHAT_COPY.inboxEmptyTitle} {CHAT_COPY.inboxEmptyBody}
      </Typography>
    </main>
  );
}
