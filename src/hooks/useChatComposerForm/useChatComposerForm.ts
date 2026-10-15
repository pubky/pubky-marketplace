'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { CHAT_BODY_MAX_BYTES } from '@/config/chat';
import { ChatController } from '@/controllers/chat/chat';
import { utf8Bytes } from '@/libs/chat/encoding';
import { Logger } from '@/libs/logger/logger';
import type { ChatContext } from '@/models/chat/chat.schema';
import { toast } from '@/molecules/Toaster/use-toast';
import { chatComposerDefaults, chatComposerFormSchema, type ChatComposerFormValues } from './useChatComposerForm.types';

/**
 * The message composer. `submit()` queues the message (it appears in the
 * thread at once) and resolves `true`; delivery continues in the background.
 */
export function useChatComposerForm(peerPubky: string, context?: ChatContext) {
  const form = useForm<ChatComposerFormValues>({
    resolver: zodResolver(chatComposerFormSchema),
    defaultValues: chatComposerDefaults,
    mode: 'onSubmit',
  });

  const submit = async (): Promise<boolean> => {
    let sent = false;
    await form.handleSubmit(async (values) => {
      try {
        await ChatController.commitSendMessage({ peerPubky, body: values.body, context });
        form.reset(chatComposerDefaults);
        sent = true;
      } catch (error) {
        Logger.warn('Chat message could not be queued', { error });
        toast({ variant: 'error', title: 'Could not send', description: 'Try again in a moment.' });
      }
    })();
    return sent;
  };

  const body = useWatch({ control: form.control, name: 'body' });
  const bytesUsed = utf8Bytes(body ?? '');

  return {
    form,
    submit,
    reset: () => form.reset(chatComposerDefaults),
    bytesUsed,
    bytesLeft: CHAT_BODY_MAX_BYTES - bytesUsed,
    isOverLimit: bytesUsed > CHAT_BODY_MAX_BYTES,
  };
}
