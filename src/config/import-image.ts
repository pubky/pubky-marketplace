/**
 * Limits for fetching product photos referenced by a seller's import file
 * (see src/app/api/import-image/route.ts). Server and client both read these:
 * the server enforces the per-image cap and the rate window, the client
 * tracks the per-import budget and sends what is left with every request.
 */

/** Largest single image the fetch route will return. */
export const IMPORT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Total bytes one import run may pull through the route. */
export const IMPORT_IMAGE_MAX_TOTAL_BYTES = 100 * 1024 * 1024;

/** Most distinct image URLs one import run fetches. */
export const IMPORT_IMAGE_MAX_COUNT = 500;

/** Wall-clock budget for one remote image: connect, redirects and body. */
export const IMPORT_IMAGE_FETCH_TIMEOUT_MS = 15_000;

/** Redirect hops followed per image; every hop is re-validated. */
export const IMPORT_IMAGE_MAX_REDIRECTS = 3;

/** Fetches allowed per session (or per IP when no session) per window. */
export const IMPORT_IMAGE_RATE_LIMIT_REQUESTS = 120;
export const IMPORT_IMAGE_RATE_LIMIT_WINDOW_MS = 60_000;

/** Image bytes served per session (or per IP) per window. */
export const IMPORT_IMAGE_RATE_LIMIT_BYTES = 150 * 1024 * 1024;
export const IMPORT_IMAGE_RATE_LIMIT_BYTES_WINDOW_MS = 10 * 60_000;

/**
 * Distinct limiter keys (IPs and session digests) tracked per counter. When all
 * slots hold live windows, new keys are refused until a window expires.
 */
export const IMPORT_IMAGE_RATE_LIMIT_MAX_KEYS = 5_000;

/**
 * Caps across all callers together: the ceiling on what this route can do as an
 * open fetch relay, whoever is calling and however many identities they forge.
 * Held per server process, so the effective cap is this times the instance count.
 */
export const IMPORT_IMAGE_GLOBAL_RATE_LIMIT_REQUESTS = 600;
export const IMPORT_IMAGE_GLOBAL_RATE_LIMIT_BYTES = 1024 * 1024 * 1024;

/** Request body ceiling for the route; a body is `{ url, remainingBytes }`. */
export const IMPORT_IMAGE_MAX_REQUEST_BODY_BYTES = 8 * 1024;

export const IMPORT_IMAGE_MAX_URL_LENGTH = 2048;

/**
 * The photo phase loads photos in batches, each with its own count and byte
 * budget (`IMPORT_IMAGE_MAX_COUNT`, `IMPORT_IMAGE_MAX_TOTAL_BYTES`), one after
 * another, so an import of any size finishes without a second import.
 * When the route says to wait, the client waits that long, up to this many
 * seconds for one wait. The route's longest window is the 10-minute byte window.
 */
export const IMPORT_IMAGE_BATCH_MAX_WAIT_SECONDS = 660;

/** Most seconds one batch spends waiting on the route in all; past it the photos are left for a resume. */
export const IMPORT_IMAGE_MAX_TOTAL_WAIT_SECONDS = 30 * 60;
