import { z } from 'zod';
import { CARRIER_CHOICE_COPY, carrierChoiceFieldSchema, NO_CARRIER_CHOICE } from '@/libs/commerce/carrier-choice';
import { codePointLength, trimmedText } from '@/libs/commerce/code-point-text';

export const orderTrackingFormSchema = z.object({
  /** Curated carrier id from the registry, or `other` with a free-text name below. */
  carrierChoice: carrierChoiceFieldSchema.refine(
    (choice) => choice !== NO_CARRIER_CHOICE,
    CARRIER_CHOICE_COPY.required,
  ),
  carrier: trimmedText({ max: 100, message: 'Use 100 characters or fewer.' }),
  trackingNumber: z
    .string()
    .trim()
    .min(1, 'Enter the tracking number.')
    .refine((value) => codePointLength(value) <= 200, 'Use 200 characters or fewer.'),
});

export type OrderTrackingFormData = z.infer<typeof orderTrackingFormSchema>;
