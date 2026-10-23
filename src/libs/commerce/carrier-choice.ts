import { z } from 'zod';
import { SHIPPING_CARRIERS } from '@/libs/commerce/carriers';

/** The carrier select's value before the seller picks one. Never preselected: a default would record the wrong carrier for sellers it does not fit. */
export const NO_CARRIER_CHOICE = '';

export const CARRIER_CHOICE_COPY = {
  placeholder: 'Select carrier',
  required: 'Select a carrier.',
} as const;

const carrierIds = SHIPPING_CARRIERS.map(({ id }) => id) as [string, ...string[]];

/** A registry carrier id, or `NO_CARRIER_CHOICE` while the form is untouched. */
export const carrierChoiceFieldSchema = z.union([z.literal(NO_CARRIER_CHOICE), z.enum(carrierIds)]);
