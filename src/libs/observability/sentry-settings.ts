import { Env } from '@/libs/env/env';
import { getSentryEnvironment, getSentrySampleRate } from '@/libs/runtime-config/runtime-config';

/** Sentry's tier is independent of the homeserver used by a deployment. */
export function resolveSentryEnvironment(): string {
  return getSentryEnvironment() ?? Env?.NODE_ENV ?? 'unknown';
}

/** Shared by SDK initialization and the read-only verification harness. */
export function getSentryErrorSampling(environment = resolveSentryEnvironment()) {
  const isStaging = /(^|-)staging($|-)/.test(environment);
  return { isStaging, sampleRate: getSentrySampleRate() ?? (isStaging ? 0.1 : 1) };
}
