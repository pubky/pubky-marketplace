import { HttpMethod, HttpStatusCode } from '@/libs/http/http.types';
import { parseRetryAfterHeader } from '@/libs/http/response.utils';
import { extractStatusCode } from './error.utils';

export const HOMESERVER_WRITE_MAX_RETRIES = 2;
export const HOMESERVER_WRITE_MAX_ATTEMPTS = HOMESERVER_WRITE_MAX_RETRIES + 1;

/**
 * The body of the homeserver's 409 when its storage backend (GCS, homeserver
 * 0.16.2+) refused to publish a write because a request it ran late changed
 * the object first. Nothing landed. A 409 without this body (a file/folder
 * path collision, an unknown lock token) is a real conflict.
 */
export const HOMESERVER_PUBLISH_CONFLICT_MESSAGE =
  'The file changed before the change was published; read it again and retry';

const BASE_DELAY_MS = 250;
const MAX_BACKOFF_MS = 4_000;
const MAX_RETRY_AFTER_MS = 30_000;

type RetryMetadata = {
  status: number;
  retryAfterSeconds?: number;
  publishConflict: boolean;
};

type RetryDependencies = {
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  beforeAttempt?: (attempt: number) => void | Promise<void>;
  maxTotalDelayMs?: number;
  /** 0 makes one attempt with no sleep, for a caller that holds a lock and backs off outside it. */
  maxRetries?: number;
  /**
   * false for a write whose body was checked against a read of the same file:
   * a publish conflict means that read may be stale, so the conflict is thrown
   * for {@link retryHomeserverWriteAfterReread} to read again.
   */
  retryPublishConflict?: boolean;
};

const installedDependencies: RetryDependencies = {};

/** Test-only clock. Production callers leave this unset and keep real jitter. */
export function installHomeserverWriteRetryDependenciesForTests(dependencies: RetryDependencies | null): void {
  installedDependencies.sleep = dependencies?.sleep;
  installedDependencies.random = dependencies?.random;
  installedDependencies.now = dependencies?.now;
}

function retryableStatus(status: number): boolean {
  return (
    status === HttpStatusCode.TOO_MANY_REQUESTS ||
    status === HttpStatusCode.INTERNAL_SERVER_ERROR ||
    status === HttpStatusCode.SERVICE_UNAVAILABLE
  );
}

function retryable(metadata: RetryMetadata, retryPublishConflict: boolean): boolean {
  return retryableStatus(metadata.status) || (retryPublishConflict && metadata.publishConflict);
}

function errorContext(error: unknown): Record<string, unknown> | undefined {
  if (typeof error !== 'object' || error === null || !('context' in error)) return undefined;
  const context = (error as { context?: unknown }).context;
  return typeof context === 'object' && context !== null ? (context as Record<string, unknown>) : undefined;
}

/** The SDK's status, or the one an `AppError` from a single-attempt homeserver write carries. */
function errorStatus(error: unknown): number | undefined {
  const status = extractStatusCode(error) ?? errorContext(error)?.statusCode;
  return typeof status === 'number' ? status : undefined;
}

function retryAfterValue(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined;
  const direct = error as {
    retryAfter?: unknown;
    retryAfterSeconds?: unknown;
    headers?: unknown;
    response?: unknown;
    data?: unknown;
  };
  const data =
    typeof direct.data === 'object' && direct.data !== null
      ? (direct.data as { retryAfter?: unknown; retryAfterSeconds?: unknown; headers?: unknown })
      : undefined;
  return (
    direct.retryAfterSeconds ??
    direct.retryAfter ??
    data?.retryAfterSeconds ??
    data?.retryAfter ??
    errorContext(error)?.retryAfter ??
    direct.response ??
    direct.headers ??
    data?.headers
  );
}

function retryAfterSeconds(value: unknown, nowMs: number): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value === 'string') return parseRetryAfterHeader(value, nowMs);
  if (value instanceof Response) return parseRetryAfterHeader(value.headers.get('retry-after'), nowMs);
  if (value instanceof Headers) return parseRetryAfterHeader(value.get('retry-after'), nowMs);
  if (typeof value === 'object' && value !== null && 'get' in value) {
    const get = (value as { get?: unknown }).get;
    if (typeof get === 'function') {
      const header = get.call(value, 'retry-after');
      return typeof header === 'string' ? parseRetryAfterHeader(header, nowMs) : undefined;
    }
  }
  return undefined;
}

/**
 * The SDK puts the response body in the error message
 * (`… 409 Conflict - <body>`), and an `AppError` keeps that message.
 */
function errorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('message' in error)) return '';
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
}

/** Whether a rejected homeserver write is the backend's transient publish conflict. */
export function isHomeserverPublishConflict(error: unknown): boolean {
  return (
    errorStatus(error) === HttpStatusCode.CONFLICT && errorMessage(error).includes(HOMESERVER_PUBLISH_CONFLICT_MESSAGE)
  );
}

function errorMetadata(error: unknown, nowMs: number): RetryMetadata | undefined {
  const status = errorStatus(error);
  if (status === undefined) return undefined;
  return {
    status,
    retryAfterSeconds: retryAfterSeconds(retryAfterValue(error), nowMs),
    publishConflict: isHomeserverPublishConflict(error),
  };
}

async function responseMetadata(value: unknown, nowMs: number): Promise<RetryMetadata | undefined> {
  if (!(value instanceof Response)) return undefined;
  // The clone leaves the caller's body unread; a 409 body is one short line.
  const body =
    value.status === HttpStatusCode.CONFLICT
      ? await value
          .clone()
          .text()
          .catch(() => '')
      : '';
  return {
    status: value.status,
    retryAfterSeconds: parseRetryAfterHeader(value.headers.get('retry-after'), nowMs),
    publishConflict: body.includes(HOMESERVER_PUBLISH_CONFLICT_MESSAGE),
  };
}

function delayMs(metadata: RetryMetadata, retry: number, random: () => number): number {
  if (metadata.status === HttpStatusCode.TOO_MANY_REQUESTS && metadata.retryAfterSeconds !== undefined) {
    return Math.min(Math.max(0, metadata.retryAfterSeconds * 1_000), MAX_RETRY_AFTER_MS);
  }
  const exponential = Math.min(BASE_DELAY_MS * 2 ** retry, MAX_BACKOFF_MS);
  // Full jitter stays inside the exponential cap. random() is [0, 1).
  return Math.min(MAX_BACKOFF_MS, Math.round(exponential * (0.5 + random())));
}

function resolveDependencies(dependencies: RetryDependencies) {
  return {
    sleep:
      dependencies.sleep ??
      installedDependencies.sleep ??
      ((delay: number) => new Promise<void>((resolve) => setTimeout(resolve, delay))),
    random: dependencies.random ?? installedDependencies.random ?? Math.random,
    now: dependencies.now ?? installedDependencies.now ?? Date.now,
    maxTotalDelayMs: dependencies.maxTotalDelayMs ?? Number.POSITIVE_INFINITY,
    maxRetries: dependencies.maxRetries ?? HOMESERVER_WRITE_MAX_RETRIES,
  };
}

/**
 * Repeats one idempotent homeserver PUT or DELETE in the caller's current
 * critical section. The operation must replay the same path and body.
 *
 * Retries 429, 500 and 503, and the backend's publish conflict (a 409 with
 * {@link HOMESERVER_PUBLISH_CONFLICT_MESSAGE}): the homeserver reads the
 * object's version again on every request, so replaying an unconditional
 * write lands it the same way it would have had the late request landed
 * before the first attempt. Any other 409, 412 or 423 is not retried.
 *
 * This helper does not acquire or release a lock. A caller that already holds
 * one — the watchlist Web Lock, or the messaging per-counterparty queue —
 * keeps that hold across every attempt.
 */
export async function retryHomeserverWrite<T>(
  method: HttpMethod.PUT | HttpMethod.DELETE,
  operation: () => Promise<T>,
  dependencies: RetryDependencies = {},
): Promise<T> {
  if (method !== HttpMethod.PUT && method !== HttpMethod.DELETE) return await operation();

  const { sleep, random, now, maxTotalDelayMs, maxRetries } = resolveDependencies(dependencies);
  const retryPublishConflict = dependencies.retryPublishConflict ?? true;
  let totalDelayMs = 0;

  for (let attempt = 0; ; attempt += 1) {
    await dependencies.beforeAttempt?.(attempt);
    let result: T;
    try {
      result = await operation();
    } catch (error) {
      const metadata = errorMetadata(error, now());
      if (!metadata || !retryable(metadata, retryPublishConflict) || attempt >= maxRetries) throw error;
      const delay = delayMs(metadata, attempt, random);
      if (totalDelayMs + delay > maxTotalDelayMs) throw error;
      await sleep(delay);
      totalDelayMs += delay;
      continue;
    }

    const metadata = await responseMetadata(result, now());
    if (!metadata || !retryable(metadata, retryPublishConflict) || attempt >= maxRetries) return result;
    const delay = delayMs(metadata, attempt, random);
    if (totalDelayMs + delay > maxTotalDelayMs) return result;
    await sleep(delay);
    totalDelayMs += delay;
  }
}

/**
 * Runs `readAndWrite` again from its read when the write it ends with is
 * refused by a publish conflict, with the same backoff and attempt cap as
 * {@link retryHomeserverWrite}. For a write whose body was checked against a
 * read of the same file: the conflict says that file changed, so the checks
 * must see the new version before anything is written. Any other failure
 * propagates.
 */
export async function retryHomeserverWriteAfterReread<T>(
  readAndWrite: () => Promise<T>,
  dependencies: Pick<RetryDependencies, 'sleep' | 'random'> = {},
): Promise<T> {
  const { sleep, random, maxRetries } = resolveDependencies(dependencies);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await readAndWrite();
    } catch (error) {
      if (!isHomeserverPublishConflict(error) || attempt >= maxRetries) throw error;
      await sleep(delayMs({ status: HttpStatusCode.CONFLICT, publishConflict: true }, attempt, random));
    }
  }
}
