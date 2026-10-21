import { z } from 'zod';
import {
  COPYRIGHT_BRIEF_DESCRIPTION_MAX_LENGTH,
  COPYRIGHT_EMAIL_MAX_LENGTH,
  COPYRIGHT_ORIGINAL_CONTENT_URLS_MAX_LENGTH,
  COPYRIGHT_SHORT_FIELD_MAX_LENGTH,
  COPYRIGHT_URL_MAX_LENGTH,
} from '@/config/copyright';
import { VALIDATION_MESSAGES, VALIDATION_PATTERNS } from '@/config/forms';
import { COPYRIGHT_ROLES } from './useCopyrightForm.constants';

/**
 * Schema for the copyright removal request form.
 * Uses a single `role` enum (UI-only); the API still receives two booleans
 * derived from this value at submit time, preserving the wire contract.
 */
export const copyrightFormSchema = z.object({
  role: z.enum([COPYRIGHT_ROLES.RIGHTS_OWNER, COPYRIGHT_ROLES.REPORTING_ON_BEHALF], {
    message: VALIDATION_MESSAGES.ROLE_REQUIRED,
  }),
  nameOwner: z
    .string()
    .min(1, 'Name of rights owner is required')
    .max(
      COPYRIGHT_SHORT_FIELD_MAX_LENGTH,
      `Name of rights owner must be no more than ${COPYRIGHT_SHORT_FIELD_MAX_LENGTH} characters`,
    ),
  originalContentUrls: z
    .string()
    .min(1, 'Original content URLs are required')
    .max(
      COPYRIGHT_ORIGINAL_CONTENT_URLS_MAX_LENGTH,
      `Original content URLs must be no more than ${COPYRIGHT_ORIGINAL_CONTENT_URLS_MAX_LENGTH} characters`,
    ),
  briefDescription: z
    .string()
    .min(1, 'Brief description is required')
    .max(
      COPYRIGHT_BRIEF_DESCRIPTION_MAX_LENGTH,
      `Brief description must be no more than ${COPYRIGHT_BRIEF_DESCRIPTION_MAX_LENGTH} characters`,
    ),
  infringingContentUrl: z
    .string()
    .min(1, 'Infringing content URL is required')
    .max(
      COPYRIGHT_URL_MAX_LENGTH,
      `Infringing content URL must be no more than ${COPYRIGHT_URL_MAX_LENGTH} characters`,
    ),
  firstName: z
    .string()
    .min(1, 'First name is required')
    .max(
      COPYRIGHT_SHORT_FIELD_MAX_LENGTH,
      `First name must be no more than ${COPYRIGHT_SHORT_FIELD_MAX_LENGTH} characters`,
    ),
  lastName: z
    .string()
    .min(1, 'Last name is required')
    .max(
      COPYRIGHT_SHORT_FIELD_MAX_LENGTH,
      `Last name must be no more than ${COPYRIGHT_SHORT_FIELD_MAX_LENGTH} characters`,
    ),
  email: z
    .string()
    .min(1, 'Email is required')
    .max(COPYRIGHT_EMAIL_MAX_LENGTH, `Email must be no more than ${COPYRIGHT_EMAIL_MAX_LENGTH} characters`)
    .email(VALIDATION_MESSAGES.INVALID_EMAIL),
  phoneNumber: z
    .string()
    .min(1, 'Phone number is required')
    .max(
      COPYRIGHT_SHORT_FIELD_MAX_LENGTH,
      `Phone number must be no more than ${COPYRIGHT_SHORT_FIELD_MAX_LENGTH} characters`,
    )
    .refine((val) => VALIDATION_PATTERNS.PHONE.test(val), {
      message: VALIDATION_MESSAGES.INVALID_PHONE,
    }),
  streetAddress: z
    .string()
    .min(1, 'Street address is required')
    .max(
      COPYRIGHT_SHORT_FIELD_MAX_LENGTH,
      `Street address must be no more than ${COPYRIGHT_SHORT_FIELD_MAX_LENGTH} characters`,
    ),
  country: z
    .string()
    .min(1, 'Country is required')
    .max(
      COPYRIGHT_SHORT_FIELD_MAX_LENGTH,
      `Country must be no more than ${COPYRIGHT_SHORT_FIELD_MAX_LENGTH} characters`,
    ),
  city: z
    .string()
    .min(1, 'City is required')
    .max(COPYRIGHT_SHORT_FIELD_MAX_LENGTH, `City must be no more than ${COPYRIGHT_SHORT_FIELD_MAX_LENGTH} characters`),
  stateProvince: z
    .string()
    .min(1, 'State/Province is required')
    .max(
      COPYRIGHT_SHORT_FIELD_MAX_LENGTH,
      `State/Province must be no more than ${COPYRIGHT_SHORT_FIELD_MAX_LENGTH} characters`,
    ),
  zipCode: z
    .string()
    .min(1, 'Zip code is required')
    .max(
      COPYRIGHT_SHORT_FIELD_MAX_LENGTH,
      `Zip code must be no more than ${COPYRIGHT_SHORT_FIELD_MAX_LENGTH} characters`,
    ),
  signature: z
    .string()
    .min(1, 'Signature is required')
    .max(
      COPYRIGHT_SHORT_FIELD_MAX_LENGTH,
      `Signature must be no more than ${COPYRIGHT_SHORT_FIELD_MAX_LENGTH} characters`,
    ),
});

export type CopyrightFormData = z.infer<typeof copyrightFormSchema>;
