import { z } from 'zod';
import { normalizeWooStoreAddress } from '@/libs/commerce/connectors';

export const WOO_CONNECT_FIELDS = {
  STORE_URL: 'storeUrl',
  KEYS_STORE_URL: 'keysStoreUrl',
  CONSUMER_KEY: 'consumerKey',
  CONSUMER_SECRET: 'consumerSecret',
} as const;

const storeUrl = z
  .string()
  .trim()
  .min(1, 'Enter your store address.')
  .superRefine((value, context) => {
    const normalized = normalizeWooStoreAddress(value);
    if (normalized.ok) return;
    context.addIssue({
      code: 'custom',
      message:
        normalized.reason === 'insecure'
          ? 'WooCommerce connections need a secure address that starts with https://.'
          : 'Enter your store address, for example shop.example.com.',
    });
  });

/** The one-click form: only the store address. */
export const wooOneClickFormSchema = z.object({
  [WOO_CONNECT_FIELDS.STORE_URL]: storeUrl,
});

export type WooOneClickFormData = z.infer<typeof wooOneClickFormSchema>;

export const wooOneClickFormDefaults: WooOneClickFormData = {
  [WOO_CONNECT_FIELDS.STORE_URL]: '',
};

/** The fallback form: the store address plus a REST key pair. */
export const wooKeysFormSchema = z.object({
  [WOO_CONNECT_FIELDS.KEYS_STORE_URL]: storeUrl,
  [WOO_CONNECT_FIELDS.CONSUMER_KEY]: z
    .string()
    .trim()
    .regex(/^ck_[A-Za-z0-9]{8,}$/, 'A WooCommerce consumer key starts with ck_.'),
  [WOO_CONNECT_FIELDS.CONSUMER_SECRET]: z
    .string()
    .trim()
    .regex(/^cs_[A-Za-z0-9]{8,}$/, 'A WooCommerce consumer secret starts with cs_.'),
});

export type WooKeysFormData = z.infer<typeof wooKeysFormSchema>;

export const wooKeysFormDefaults: WooKeysFormData = {
  [WOO_CONNECT_FIELDS.KEYS_STORE_URL]: '',
  [WOO_CONNECT_FIELDS.CONSUMER_KEY]: '',
  [WOO_CONNECT_FIELDS.CONSUMER_SECRET]: '',
};
