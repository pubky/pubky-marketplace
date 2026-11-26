/**
 * Limits of the Paykit creator lookup (`src/app/api/paykit-creator/route.ts`). Every caller of the route
 * shares the app server's address, and so the Paykit Server's per-IP read limit for `/setup/creator-held`
 * (600 a minute by default). These keep one caller, or many, from spending it for everyone. All are held
 * per server process, so the effective caps are these times the instance count.
 */

/** Lookups one client address may make per window, answered from the kept answers or not. */
export const PAYKIT_CREATOR_RATE_LIMIT_REQUESTS = 60;
export const PAYKIT_CREATOR_RATE_LIMIT_WINDOW_MS = 60_000;

/** Distinct client addresses tracked; when all hold live windows, new ones are refused until one expires. */
export const PAYKIT_CREATOR_RATE_LIMIT_MAX_KEYS = 5_000;

/**
 * Reads of the Paykit Server per window across all callers, whoever they are. Half of Paykit's default
 * per-IP budget, so this route alone never spends it.
 */
export const PAYKIT_CREATOR_GLOBAL_READS_PER_WINDOW = 300;

/** Distinct creators being asked about at once; a caller asking about one already pending joins that read. */
export const PAYKIT_CREATOR_MAX_IN_FLIGHT = 20;
