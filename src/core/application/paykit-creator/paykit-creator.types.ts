/** A validated creator lookup: Paykit's canonical `pubky<z32>` creator. */
export interface TPaykitCreatorProbeParams {
  creator: string;
}

/**
 * The answer to a lookup. A refusal by one of this server's own limits is an expected answer, not an
 * application error, so it is returned rather than thrown and nothing is logged or captured for it.
 */
export type TPaykitCreatorAnswer =
  | { ok: true; held: boolean }
  | { ok: false; reason: 'rate_limited'; retryAfterSeconds: number };

/** A lookup by a caller of the route, counted against each of its limiter keys (client address). */
export interface TPaykitCreatorLookupParams extends TPaykitCreatorProbeParams {
  rateLimitKeys: string[];
}
