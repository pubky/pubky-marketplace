import { z } from 'zod';
import { SHIPPING_CARRIERS } from '@/libs/commerce/carriers';

const carrierIds = SHIPPING_CARRIERS.map(({ id }) => id) as [string, ...string[]];

export const orderTrackingFormSchema = z.object({
  /** Curated carrier id from the registry, or `other` with a free-text name below. */
  carrierChoice: z.enum(carrierIds),
  carrier: z.string().trim().max(100, 'Use 100 characters or fewer.'),
  trackingNumber: z.string().trim().min(1, 'Enter the tracking number.').max(200, 'Use 200 characters or fewer.'),
});

export type OrderTrackingFormData = z.infer<typeof orderTrackingFormSchema>;
