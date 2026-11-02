import { AppError } from '@/libs/error/error';
import { TimeoutErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory } from '@/libs/error/error.types';

const TIMEOUT_REPORT_INTERVAL_MS = 60_000;
const MAX_TIMEOUT_KEYS = 128;

/**
 * Per-SDK-instance protection against staging polling outages. Keep the first
 * sampled request timeout per service/operation/budget each minute. No URLs,
 * messages, user IDs or error objects are retained in this bounded cache.
 * Repeats do not extend the window, so a continuing outage remains visible.
 */
export function createTimeoutQuotaFilter(): (error: unknown) => boolean {
  const reported = new Map<string, number>();

  return (error) => {
    if (
      !(error instanceof AppError) ||
      error.category !== ErrorCategory.Timeout ||
      error.code !== TimeoutErrorCode.REQUEST_TIMEOUT ||
      !error.service ||
      !error.operation
    ) {
      return false;
    }

    const timeoutMs = error.context?.timeoutMs;
    const key = JSON.stringify([
      error.service,
      error.operation,
      typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) ? timeoutMs : null,
    ]);
    const now = Date.now();
    const last = reported.get(key);
    if (last !== undefined && now >= last && now - last < TIMEOUT_REPORT_INTERVAL_MS) return true;

    for (const [entry, timestamp] of reported) {
      if (now < timestamp || now - timestamp >= TIMEOUT_REPORT_INTERVAL_MS) reported.delete(entry);
    }
    if (reported.size >= MAX_TIMEOUT_KEYS) {
      const oldest = reported.keys().next().value;
      if (oldest !== undefined) reported.delete(oldest);
    }
    reported.set(key, now);
    return false;
  };
}
