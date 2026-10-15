import { z } from 'zod';
import { normalizeShopifyDomain } from '@/libs/commerce/connectors';

export const SHOPIFY_CONNECT_FIELDS = {
  DOMAIN: 'domain',
  CLIENT_ID: 'clientId',
  CLIENT_SECRET: 'clientSecret',
} as const;

/** Step 1: the store address. */
export const shopifyDomainFormSchema = z.object({
  [SHOPIFY_CONNECT_FIELDS.DOMAIN]: z
    .string()
    .trim()
    .min(1, 'Enter your store address.')
    .refine(
      (value) => normalizeShopifyDomain(value) !== null,
      'Use your store address, like your-store.myshopify.com.',
    ),
});

export type ShopifyDomainFormData = z.infer<typeof shopifyDomainFormSchema>;

export const shopifyDomainFormDefaults: ShopifyDomainFormData = {
  [SHOPIFY_CONNECT_FIELDS.DOMAIN]: '',
};

/** Step 5: the app's Client ID and Client secret, pasted from the Dev Dashboard. */
export const shopifyKeysFormSchema = z.object({
  [SHOPIFY_CONNECT_FIELDS.CLIENT_ID]: z.string().trim().min(8, 'Paste the Client ID from the app settings.').max(200),
  [SHOPIFY_CONNECT_FIELDS.CLIENT_SECRET]: z
    .string()
    .trim()
    .min(8, 'Paste the Client secret from the app settings.')
    .max(200),
});

export type ShopifyKeysFormData = z.infer<typeof shopifyKeysFormSchema>;

export const shopifyKeysFormDefaults: ShopifyKeysFormData = {
  [SHOPIFY_CONNECT_FIELDS.CLIENT_ID]: '',
  [SHOPIFY_CONNECT_FIELDS.CLIENT_SECRET]: '',
};
