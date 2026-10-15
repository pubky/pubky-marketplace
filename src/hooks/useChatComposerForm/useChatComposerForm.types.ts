import { z } from 'zod';
import { CHAT_BODY_MAX_BYTES } from '@/config/chat';
import { utf8Bytes } from '@/libs/chat/encoding';

export const CHAT_COMPOSER_FIELDS = { body: 'body' } as const;

export const chatComposerFormSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write a message.')
    .refine((body) => utf8Bytes(body) <= CHAT_BODY_MAX_BYTES, 'Shorten this message to send it.'),
});

export type ChatComposerFormValues = z.infer<typeof chatComposerFormSchema>;

export const chatComposerDefaults: ChatComposerFormValues = { body: '' };
