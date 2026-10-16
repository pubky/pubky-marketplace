/**
 * Limits for reading a seller's public WooCommerce catalogue through the
 * Store API (see src/app/api/import-store/route.ts). The server enforces the
 * byte caps, the timeout and the rate windows; the client tracks the page and
 * per-import budgets and sends what is left with every request.
 */

/** Products asked for per page; the Store API allows at most 100. */
export const IMPORT_STORE_PER_PAGE = 100;

/** Most pages one import reads. */
export const IMPORT_STORE_MAX_PAGES = 50;

/** Most products one import reads (pages times the page size). */
export const IMPORT_STORE_MAX_PRODUCTS = IMPORT_STORE_MAX_PAGES * IMPORT_STORE_PER_PAGE;

/** Most variation reads (`/products/{id}`) one import makes. */
export const IMPORT_STORE_MAX_VARIATION_READS = 1_500;

/** Variation reads in flight at once. */
export const IMPORT_STORE_VARIATION_CONCURRENCY = 3;

/** Largest page of products the fetch route will read. */
export const IMPORT_STORE_MAX_PAGE_BYTES = 8 * 1024 * 1024;

/** Largest single product (or variation) read. */
export const IMPORT_STORE_MAX_PRODUCT_BYTES = 2 * 1024 * 1024;

/** Total bytes one import run may read from a store. */
export const IMPORT_STORE_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

/** Wall-clock budget for one store request: connect, redirects and body. */
export const IMPORT_STORE_FETCH_TIMEOUT_MS = 20_000;

/** Redirect hops followed per request; every hop is re-validated. */
export const IMPORT_STORE_MAX_REDIRECTS = 3;

/** Requests allowed per session (or per IP when no session) per window. */
export const IMPORT_STORE_RATE_LIMIT_REQUESTS = 120;
export const IMPORT_STORE_RATE_LIMIT_WINDOW_MS = 60_000;

/** Store bytes read per session (or per IP) per window. */
export const IMPORT_STORE_RATE_LIMIT_BYTES = 200 * 1024 * 1024;
export const IMPORT_STORE_RATE_LIMIT_BYTES_WINDOW_MS = 10 * 60_000;

/** Caps across all callers together, as for the image route: the ceiling on this route as a fetch relay. */
export const IMPORT_STORE_GLOBAL_RATE_LIMIT_REQUESTS = 600;
export const IMPORT_STORE_GLOBAL_RATE_LIMIT_BYTES = 1024 * 1024 * 1024;

/** Request body ceiling for the route; a body is `{ storeUrl, kind, page | productId, remainingBytes }`. */
export const IMPORT_STORE_MAX_REQUEST_BODY_BYTES = 8 * 1024;

export const IMPORT_STORE_MAX_URL_LENGTH = 2048;

/** Longest a client waits out a `rate_limited` answer before giving the request up. */
export const IMPORT_STORE_MAX_RETRY_WAIT_SECONDS = 60;

/** Where the public catalogue lives, relative to the store's base address. */
export const IMPORT_STORE_PRODUCTS_PATH = '/wp-json/wc/store/v1/products';
