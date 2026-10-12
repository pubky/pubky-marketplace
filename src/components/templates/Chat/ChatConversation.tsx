'use client';

import { Typography } from '@/atoms/Typography/Typography';

/** One conversation. Placeholder until the chat core lands. */
export function ChatConversation({ peerPubky }: { peerPubky: string }) {
  return (
    <main data-surface="chat-conversation" className="mx-auto flex w-full max-w-4xl flex-col gap-2 px-4 py-6">
      <Typography as="h1" size="2xl" className="font-bold">
        Conversation
      </Typography>
      <Typography as="p" className="break-all text-muted-foreground">
        {peerPubky}
      </Typography>
    </main>
  );
}
