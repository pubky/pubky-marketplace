import type { StoreApiProduct } from './import-store.product';

export const IMPORT_STORE_FAILURE_REASONS = [
  'invalid_url',
  'blocked_address',
  'dns_failed',
  'too_many_redirects',
  'http_error',
  'not_json',
  'not_woocommerce',
  'too_large',
  'budget_exceeded',
  'timeout',
  'network',
  'rate_limited',
  'cancelled',
] as const;

export type TImportStoreFailureReason = (typeof IMPORT_STORE_FAILURE_REASONS)[number];

export function isImportStoreFailureReason(value: unknown): value is TImportStoreFailureReason {
  return typeof value === 'string' && (IMPORT_STORE_FAILURE_REASONS as readonly string[]).includes(value);
}

/** What a seller reads when a store cannot be read: one plain sentence per reason. */
export const IMPORT_STORE_FAILURE_COPY: Readonly<Record<TImportStoreFailureReason, string>> = {
  invalid_url: 'That is not a store address we can read. Use the https address of your shop, like https://myshop.com.',
  blocked_address: 'That address is not allowed. Use the public https address of your shop.',
  dns_failed: 'We could not find that store. Check the address.',
  too_many_redirects: 'That address redirects too many times. Use the final address of your shop.',
  http_error: 'The store did not share its catalogue. The WooCommerce Store API may be switched off.',
  not_json: 'The store answered with something that is not a product list.',
  not_woocommerce: 'That does not look like a WooCommerce store, or its public product list is switched off.',
  too_large: 'The store sent more data than one import reads.',
  budget_exceeded: 'This catalogue is larger than one import reads.',
  timeout: 'The store took too long to answer. Try again in a moment.',
  network: 'We could not reach the store. Try again in a moment.',
  rate_limited: 'Too many store reads just now. Wait a minute and try again.',
  cancelled: 'The import was cancelled.',
};

/** One fetch asked of the route: a page of the catalogue, or one product (a variation) by id. */
export type TImportStoreRequest =
  | { readonly kind: 'page'; readonly page: number }
  | { readonly kind: 'product'; readonly productId: number };

/** What the route returns for a page: the products it could read, trimmed, with the store's own counts. */
export type TImportStorePageResponse = {
  readonly kind: 'page';
  readonly products: readonly StoreApiProduct[];
  /** Products on the page the route could not read at all. */
  readonly rejected: number;
  readonly total: number | null;
  readonly totalPages: number | null;
  /** Bytes read from the store for this response. */
  readonly bytes: number;
};

export type TImportStoreProductResponse = {
  readonly kind: 'product';
  readonly product: StoreApiProduct;
  readonly bytes: number;
};
