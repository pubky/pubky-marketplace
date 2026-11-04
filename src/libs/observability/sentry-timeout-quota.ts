import { isAppError } from '@/libs/error/error';
import { TimeoutErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { isIoDeadlineEndpoint } from '@/libs/http/io-deadline.types';

const TIMEOUT_REPORT_INTERVAL_MS = 60_000;
const MAX_TIMEOUT_KEYS = 128;

function timeoutKey(error: unknown): string | null {
  if (
    !isAppError(error) ||
    error.category !== ErrorCategory.Timeout ||
    error.code !== TimeoutErrorCode.REQUEST_TIMEOUT ||
    error.context?.ioDeadline !== true ||
    !error.service ||
    !error.operation
  ) {
    return null;
  }

  const timeoutMs = error.context?.timeoutMs;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return null;
  const endpoint = error.context.ioEndpoint;
  // A generic fetchNexus operation must never merge unidentified routes.
  // The allowlist also prevents URLs or identifiers from entering the key.
  if (error.service === ErrorService.Nexus && !isIoDeadlineEndpoint(endpoint)) return null;
  return JSON.stringify([error.service, error.operation, isIoDeadlineEndpoint(endpoint) ? endpoint : null, timeoutMs]);
}

/**
 * Per-SDK-instance protection against staging polling outages. Keep the first
 * sampled IO-deadline timeout per service/operation/endpoint/budget each minute. No URLs,
 * messages, user IDs or error objects are retained in this bounded cache.
 * Repeats do not extend the window, so a continuing outage remains visible.
 */
export function createTimeoutQuotaFilter() {
  const reported = new Map<string, number>();

  const shouldDrop = (error: unknown): boolean => {
    const key = timeoutKey(error);
    if (key === null) return false;
    const now = Date.now();
    const last = reported.get(key);
    return last !== undefined && now >= last && now - last < TIMEOUT_REPORT_INTERVAL_MS;
  };

  const record = (error: unknown): void => {
    const key = timeoutKey(error);
    if (key === null) return;
    const now = Date.now();
    for (const [entry, timestamp] of reported) {
      if (now < timestamp || now - timestamp >= TIMEOUT_REPORT_INTERVAL_MS) reported.delete(entry);
    }
    if (reported.size >= MAX_TIMEOUT_KEYS) {
      const oldest = reported.keys().next().value;
      if (oldest !== undefined) reported.delete(oldest);
    }
    reported.set(key, now);
  };
  return { shouldDrop, record };
}
