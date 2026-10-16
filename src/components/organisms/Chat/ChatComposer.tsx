'use client';

import { type KeyboardEvent } from 'react';
import { SendHorizontal } from 'lucide-react';
import { Controller } from 'react-hook-form';
import { Button } from '@/atoms/Button/Button';
import { Textarea } from '@/atoms/Textarea/Textarea';
import { Typography } from '@/atoms/Typography/Typography';
import { CHAT_BODY_MAX_BYTES } from '@/config/chat';
import { useChatComposerForm } from '@/hooks/useChatComposerForm/useChatComposerForm';
import { CHAT_COMPOSER_FIELDS } from '@/hooks/useChatComposerForm/useChatComposerForm.types';
import { cn } from '@/libs/utils/utils';
import type { ChatContext } from '@/models/chat/chat.schema';

/** Enter sends, Shift+Enter breaks a line; the byte meter appears near the cap. */
export function ChatComposer({
  peerPubky,
  context,
  disabled,
  disabledReason,
  placeholder,
  onSent,
}: {
  peerPubky: string;
  context?: ChatContext;
  disabled?: boolean;
  disabledReason?: string;
  placeholder: string;
  onSent?: () => void;
}) {
  const { form, submit, bytesUsed, isOverLimit } = useChatComposerForm(peerPubky, context);
  const isSubmitting = form.formState.isSubmitting;

  const send = async () => {
    if (disabled || isSubmitting) return;
    if (await submit()) onSent?.();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  const nearLimit = bytesUsed > CHAT_BODY_MAX_BYTES * 0.8;
  const error = form.formState.errors.body?.message;

  return (
    <form
      className="flex flex-col gap-2"
      data-testid="chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {disabled && disabledReason ? (
        <Typography as="p" size="xs" className="text-muted-foreground">
          {disabledReason}
        </Typography>
      ) : null}
      <div className="flex items-end gap-2">
        <Controller
          name={CHAT_COMPOSER_FIELDS.body}
          control={form.control}
          render={({ field }) => (
            <Textarea
              id="chat-composer-body"
              name={field.name}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              rows={1}
              aria-label="Message"
              aria-invalid={Boolean(error) || isOverLimit}
              className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl px-4 py-2.5"
            />
          )}
        />
        <Button
          type="submit"
          variant="brand"
          size="icon"
          className="size-11 shrink-0 rounded-full"
          disabled={disabled || isSubmitting || isOverLimit}
          aria-label="Send"
          data-testid="chat-send"
        >
          <SendHorizontal className="size-5" aria-hidden="true" />
        </Button>
      </div>
      {error || nearLimit ? (
        <Typography
          as="p"
          size="xs"
          className={cn('px-1', error || isOverLimit ? 'text-destructive' : 'text-muted-foreground')}
        >
          {error ?? `${bytesUsed.toLocaleString()} / ${CHAT_BODY_MAX_BYTES.toLocaleString()} bytes`}
        </Typography>
      ) : null}
    </form>
  );
}
