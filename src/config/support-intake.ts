/**
 * Limits for the support form routes (src/app/api/{feedback,report,copyright}/route.ts).
 * Counters live in server process memory, so a deployment with several
 * instances multiplies every request limit by the instance count.
 */

/** Length of one rate window. May be tuned. */
export const SUPPORT_INTAKE_RATE_LIMIT_WINDOW_MS = 60 * 60_000;

/**
 * Distinct client addresses tracked per form. When all slots hold live
 * windows, new addresses are refused until a window expires. May be tuned.
 */
export const SUPPORT_INTAKE_RATE_LIMIT_MAX_KEYS = 5_000;

/** Feedback submissions one client address may send per window. May be tuned. */
export const SUPPORT_FEEDBACK_RATE_LIMIT_REQUESTS = 10;

/** Report submissions one client address may send per window. May be tuned. */
export const SUPPORT_REPORT_RATE_LIMIT_REQUESTS = 20;

/**
 * Copyright notices one client address may send per window. Leaves room for
 * a rights holder who files several notices in one sitting. May be tuned.
 */
export const SUPPORT_COPYRIGHT_RATE_LIMIT_REQUESTS = 10;

/** Feedback submissions from all clients together per window, per server instance. May be tuned. */
export const SUPPORT_FEEDBACK_GLOBAL_RATE_LIMIT_REQUESTS = 300;

/** Report submissions from all clients together per window, per server instance. May be tuned. */
export const SUPPORT_REPORT_GLOBAL_RATE_LIMIT_REQUESTS = 600;

/** Copyright notices from all clients together per window, per server instance. May be tuned. */
export const SUPPORT_COPYRIGHT_GLOBAL_RATE_LIMIT_REQUESTS = 100;

/** Largest feedback request body accepted. May be tuned. */
export const SUPPORT_FEEDBACK_MAX_REQUEST_BODY_BYTES = 16 * 1024;

/** Largest report request body accepted. May be tuned. */
export const SUPPORT_REPORT_MAX_REQUEST_BODY_BYTES = 16 * 1024;

/** Largest copyright request body accepted; a notice lists several URLs and a postal address. May be tuned. */
export const SUPPORT_COPYRIGHT_MAX_REQUEST_BODY_BYTES = 64 * 1024;
