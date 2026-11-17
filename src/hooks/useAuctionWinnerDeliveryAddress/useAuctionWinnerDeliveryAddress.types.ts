import { z } from 'zod';
import { refinePostalAddressFields } from '@/libs/commerce/postal-address';

/**
 * The address an auction winner enters on the order page. Same rules as the
 * checkout address: every field but line 2 and region (where the country has
 * none) is required, and the country, region and postal code must agree.
 */
export const auctionWinnerAddressSchema = z
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
  })
  .superRefine((data, context) => {
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
    }
  });

export type AuctionWinnerAddressData = z.infer<typeof auctionWinnerAddressSchema>;

export const auctionWinnerAddressDefaults: AuctionWinnerAddressData = {
  name: '',
  line1: '',
  line2: '',
  city: '',
  region: '',
  postalCode: '',
  countryCode: 'US',
};

export const AUCTION_WINNER_ADDRESS_FIELDS = [
  'name',
  'line1',
  'line2',
  'city',
  'region',
  'postalCode',
  'countryCode',
] as const;
