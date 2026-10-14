import { HttpMethod } from '@/libs/http/http.types';

/**
 * Parameters for building a Nexus URL with query string.
 * @see buildUrlWithQuery in nexus.utils.ts
 */
export type TBuildUrlWithQueryParams = {
  /** Base route path (e.g., 'post/123/details') */
  baseRoute: string;
  /** Object containing all parameters to potentially include in query string */
  params: Record<string, unknown>;
  /** Keys that are path parameters and should be excluded from query string */
  excludeKeys?: readonly string[];
  /**
   * Nexus base URL override. Defaults to the main `getNexusUrl()`; the only
   * caller that overrides it is the marketplace index API, which routes
   * through `getMarketplaceNexusUrl()` (the marketplace endpoints may live on
   * a dedicated Nexus deployment).
   */
  baseUrl?: string;
};

/**
 * Parameters for creating fetch request options.
 * @see createFetchOptions in nexus.utils.ts
 */
export type TCreateFetchOptionsParams = {
  /** HTTP method (defaults to GET) */
  method?: HttpMethod;
  /** Request body as JSON string */
  body?: string | null;
};

/**
 * Parameters for raw fetch requests to Nexus API.
 * @see fetchNexus in nexus.utils.ts
 */
export type TFetchNexusParams = {
  /** Full API endpoint URL */
  url: string;
  /** HTTP method (defaults to GET) */
  method?: HttpMethod;
  /** Request body as JSON string */
  body?: string | null;
  /** Optional bound for this request and its response body; enabled for auth bootstrap. */
  timeoutMs?: number;
};

/**
 * Parameters for querying Nexus API with retry logic.
 * @see queryNexus in nexus.utils.ts
 */
export type TQueryNexusParams = {
  /** Full API endpoint URL */
  url: string;
  /** HTTP method (defaults to GET) */
  method?: HttpMethod;
  /** Request body as JSON string */
  body?: string | null;
  /** Per-attempt IO deadline; query retry/cache behavior is unchanged. */
  timeoutMs?: number;
  /** Bound retries and offline/hidden pauses for auth bootstrap; cancels this exact query. */
  totalTimeoutMs?: number;
};
