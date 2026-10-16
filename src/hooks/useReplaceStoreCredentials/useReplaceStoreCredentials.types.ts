import { z } from 'zod';

export const REPLACE_CREDENTIALS_FIELDS = {
  FIRST: 'first',
  SECOND: 'second',
} as const;

export const replaceCredentialsFormSchema = z.object({
  [REPLACE_CREDENTIALS_FIELDS.FIRST]: z.string().trim().min(8, 'Paste the new value.').max(200),
  [REPLACE_CREDENTIALS_FIELDS.SECOND]: z.string().trim().min(8, 'Paste the new value.').max(200),
});

export type ReplaceCredentialsFormData = z.infer<typeof replaceCredentialsFormSchema>;

export const replaceCredentialsFormDefaults: ReplaceCredentialsFormData = {
  [REPLACE_CREDENTIALS_FIELDS.FIRST]: '',
  [REPLACE_CREDENTIALS_FIELDS.SECOND]: '',
};
