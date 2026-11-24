/** A validated creator lookup: Paykit's canonical `pubky<z32>` creator. */
export interface TPaykitCreatorProbeParams {
  creator: string;
}

/** A lookup by a caller of the route, counted against each of its limiter keys (client address). */
export interface TPaykitCreatorLookupParams extends TPaykitCreatorProbeParams {
  rateLimitKeys: string[];
}
