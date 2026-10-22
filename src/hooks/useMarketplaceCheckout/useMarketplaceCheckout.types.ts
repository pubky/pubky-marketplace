import { z } from 'zod';
import { DIGITAL_CHECKOUT_REFUSAL_COPY, isWellFormedDeliveryEmail } from '@/libs/commerce/digital';
import { refinePostalAddressFields } from '@/libs/commerce/postal-address';
import { destinationCountryError, SHIPS_TO_ANYWHERE, type ShipsToDestinations } from '@/libs/commerce/ships-to';

/**
 * The checkout form (local pickup design §A2): the delivery address is
 * required only when at least one cart group ships — a pickup-only checkout
 * sends NO address at all (the strictest reading of the address-privacy
 * policy). `requiresDeliveryAddress` is a hidden form value the cart keeps
 * in sync with the fulfillment choices, so the schema — and the cart's
 * `safeParse(formValues)` validity check — follows the groups.
 *
 * `requiresDeliveryEmail` does the same for the email an email-kind digital
 * line needs (digital delivery design §4.3): required then, and never sent
 * otherwise.
 *
 * `shipsTo` is another hidden value: the destination countries the shipped
 * sellers' shop records allow. An address elsewhere is invalid. Every path
 * that seals an address re-reads those records first, which also covers the
 * moment before they have loaded here.
 */
export const marketplaceCheckoutSchema = z
  .object({
    name: z.string().trim().max(100),
    line1: z.string().trim().max(200),
    line2: z.string().trim().max(200),
    city: z.string().trim().max(100),
    region: z.string().trim().max(100),
    postalCode: z.string().trim().max(32),
    countryCode: z
      .string()
      .trim()
      .refine((value) => value === '' || /^[A-Za-z]{2}$/.test(value), 'Use a two-letter country code.'),
    requiresDeliveryAddress: z.boolean(),
    // Absent reads as anywhere, for values built outside the form.
    shipsTo: z.custom<ShipsToDestinations>().optional(),
    deliveryEmail: z.string().trim(),
    requiresDeliveryEmail: z.boolean(),
    // Client-only address book controls; never part of the checkout command.
    saveAddress: z.boolean(),
    saveLabel: z.string().trim().max(40, 'Keep the label under 40 characters.'),
  })
  .superRefine((data, context) => {
    if (data.requiresDeliveryAddress) {
      if (!data.name) {
        context.addIssue({ code: 'custom', path: ['name'], message: 'Recipient name is required.' });
      }
      if (!data.line1) {
        context.addIssue({ code: 'custom', path: ['line1'], message: 'Address is required.' });
      }
      if (!data.city) {
        context.addIssue({ code: 'custom', path: ['city'], message: 'City is required.' });
      }
      refinePostalAddressFields(data, context);
      if (!/^[A-Za-z]{2}$/.test(data.countryCode)) {
        context.addIssue({
          code: 'custom',
          path: ['countryCode'],
          message: data.countryCode === '' ? 'Choose your country.' : 'Use a two-letter country code.',
        });
      } else {
        const destinationError = destinationCountryError(data.countryCode, data.shipsTo ?? SHIPS_TO_ANYWHERE);
        if (destinationError) context.addIssue({ code: 'custom', path: ['countryCode'], message: destinationError });
      }
    }
    if (data.requiresDeliveryEmail) {
      if (!data.deliveryEmail) {
        context.addIssue({
          code: 'custom',
          path: ['deliveryEmail'],
          message: DIGITAL_CHECKOUT_REFUSAL_COPY.email_required,
        });
      } else if (!isWellFormedDeliveryEmail(data.deliveryEmail)) {
        context.addIssue({
          code: 'custom',
          path: ['deliveryEmail'],
          message: DIGITAL_CHECKOUT_REFUSAL_COPY.invalid_email,
        });
      }
    }
    if (data.saveAddress && !data.saveLabel) {
      context.addIssue({
        code: 'custom',
        path: ['saveLabel'],
        message: 'Add a label to save this address, or untick Save this address.',
      });
    }
  });

export type MarketplaceCheckoutData = z.infer<typeof marketplaceCheckoutSchema>;

export const marketplaceCheckoutDefaults: MarketplaceCheckoutData = {
  name: '',
  line1: '',
  line2: '',
  city: '',
  region: '',
  postalCode: '',
  countryCode: 'US',
  requiresDeliveryAddress: true,
  shipsTo: SHIPS_TO_ANYWHERE,
  deliveryEmail: '',
  requiresDeliveryEmail: false,
  saveAddress: false,
  saveLabel: '',
};

/** The checkout fields a saved address fills (everything except the save controls). */
export const MARKETPLACE_CHECKOUT_ADDRESS_FIELDS = [
  'name',
  'line1',
  'line2',
  'city',
  'region',
  'postalCode',
  'countryCode',
] as const;

export type MarketplaceCheckoutAddressField = (typeof MARKETPLACE_CHECKOUT_ADDRESS_FIELDS)[number];
