import { z } from 'zod';
import { trimmedText } from '@/libs/commerce/code-point-text';

export const marketplaceOfferSchema = z.object({
  amount: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,2})?$/, 'Enter a valid offer amount.')
    .refine((value) => Number(value) > 0, 'Offer must be greater than zero.'),
  quantity: z
    .string()
    .trim()
    .regex(/^[1-9]\d*$/, 'Quantity must be a positive whole number.'),
  message: trimmedText({ max: 500, message: 'Message must be 500 characters or fewer.' }),
});

export type MarketplaceOfferData = z.infer<typeof marketplaceOfferSchema>;

export const marketplaceOfferDefaults: MarketplaceOfferData = {
  amount: '',
  quantity: '1',
  message: '',
};
