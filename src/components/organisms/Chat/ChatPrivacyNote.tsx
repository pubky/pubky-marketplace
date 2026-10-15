'use client';

import { X } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Typography } from '@/atoms/Typography/Typography';
import { useChatPrivacyNote } from '@/hooks/useChatPrivacyNote/useChatPrivacyNote';
import { CHAT_COPY } from '@/libs/chat/copy';

/** One honest line about v0 key custody, shown until the account dismisses it. */
export function ChatPrivacyNote() {
  const { showNote, dismissNote } = useChatPrivacyNote();
  if (!showNote) return null;
  return (
    <div
      role="note"
      data-testid="chat-privacy-note"
      className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 py-1.5 pr-1.5 pl-3"
    >
      <Typography as="p" size="xs" className="flex-1 leading-snug text-muted-foreground">
        {CHAT_COPY.privacyNote}
      </Typography>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Dismiss privacy note"
        onClick={dismissNote}
        className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
