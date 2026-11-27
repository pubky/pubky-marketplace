import { z } from 'zod';
import { isValidStoreClaimCode, normalizeStoreClaimCode } from '@/libs/store-claim/store-claim-code';

export const STORE_CLAIM_FORM_FIELDS = {
  CODE: 'code',
} as const;

export const storeClaimFormSchema = z.object({
  [STORE_CLAIM_FORM_FIELDS.CODE]: z
    .string()
    .refine(
      (value) => isValidStoreClaimCode(normalizeStoreClaimCode(value)),
      'Enter 32 Crockford base32 characters or 64 hexadecimal characters.',
    ),
});

export type StoreClaimFormData = z.infer<typeof storeClaimFormSchema>;

export const storeClaimFormDefaults: StoreClaimFormData = {
  [STORE_CLAIM_FORM_FIELDS.CODE]: '',
};
