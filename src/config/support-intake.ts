/**
 * Limits for the support form routes (src/app/api/{feedback,report,copyright}/route.ts).
 * Counters live in server process memory, so a deployment with several
 * instances multiplies every request limit by the instance count.
 */

export type TSupportIntakeKind = 'feedback' | 'report' | 'copyright';

export type TSupportIntakeLimits = {
  /** Submissions one client address may send per window. */
  perClientRequests: number;
  /** Submissions from all clients together per window, per server instance. */
  globalRequests: number;
  /** Largest request body accepted. */
  maxBodyBytes: number;
};

/** Length of one rate window. May be tuned. */
export const SUPPORT_INTAKE_RATE_LIMIT_WINDOW_MS = 60 * 60_000;

/**
 * Distinct client addresses tracked per form. When all slots hold live
 * windows, new addresses are refused until a window expires. May be tuned.
 */
export const SUPPORT_INTAKE_RATE_LIMIT_MAX_KEYS = 5_000;

/**
 * Per-form limits. May be tuned. Copyright leaves room for a rights holder who
 * files several notices in one sitting, and its body cap fits a notice that
 * lists several URLs and a postal address.
 */
export const SUPPORT_INTAKE_LIMITS: Record<TSupportIntakeKind, TSupportIntakeLimits> = {
  feedback: { perClientRequests: 10, globalRequests: 300, maxBodyBytes: 16 * 1024 },
  report: { perClientRequests: 20, globalRequests: 600, maxBodyBytes: 16 * 1024 },
  copyright: { perClientRequests: 10, globalRequests: 100, maxBodyBytes: 64 * 1024 },
};
