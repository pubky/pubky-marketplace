import { getCommercePollIntervalMs } from '@/config/commerce';
import { hasHttpStatus, isMarketplaceSessionRequiredError } from '@/libs/error/error.utils';
import { HttpStatusCode } from '@/libs/http/http.types';

export type CommercePollOutcome = 'ok' | 'missing_session' | 'retryable_error' | 'stop';

export const COMMERCE_ACTIVE_CHECKOUT_POLL_INTERVAL_MS = 2_000;
export const COMMERCE_POLL_MAX_BACKOFF_MS = 60_000;
export const COMMERCE_POLL_MISSING_SESSION_MIN_BACKOFF_MS = 30_000;

/**
 * Adaptive polling cadence for order timelines: uses the configured interval
 * (default 5s) when idle, and speeds up to 2s while an order awaits payment.
 * Explicitly longer intervals (> 10s, including unit-test overrides) are kept
 * unchanged.
 */
export function getAdaptiveOrderPollIntervalMs(hasActiveCheckout: boolean): number {
  const configured = getCommercePollIntervalMs();
  if (!hasActiveCheckout) return configured;
  return configured <= 10_000 ? Math.min(configured, COMMERCE_ACTIVE_CHECKOUT_POLL_INTERVAL_MS) : configured;
}

export function classifyCommercePollError(error: unknown): Exclude<CommercePollOutcome, 'ok' | 'stop'> {
  if (isMarketplaceSessionRequiredError(error) || hasHttpStatus(error, HttpStatusCode.UNAUTHORIZED)) {
    return 'missing_session';
  }
  return 'retryable_error';
}

export function nextCommercePollDelayMs(
  baseIntervalMs: number,
  outcome: Exclude<CommercePollOutcome, 'stop'>,
  consecutiveFailures: number,
): number {
  if (outcome === 'ok') return baseIntervalMs;
  if (outcome === 'missing_session') {
    const floor = Math.max(baseIntervalMs * 4, COMMERCE_POLL_MISSING_SESSION_MIN_BACKOFF_MS);
    const delay = floor * 2 ** Math.max(0, consecutiveFailures - 1);
    return Math.min(COMMERCE_POLL_MAX_BACKOFF_MS, Math.max(baseIntervalMs, delay));
  }
  const delay = baseIntervalMs * 2 ** Math.max(1, consecutiveFailures);
  return Math.min(COMMERCE_POLL_MAX_BACKOFF_MS, Math.max(baseIntervalMs, delay));
}

export interface CommercePollerOptions {
  /** Executes one poll pass and returns how the scheduler should proceed. */
  poll: () => Promise<CommercePollOutcome>;
  /** Base interval (ms) when healthy; re-evaluated after each tick. */
  getIntervalMs?: () => number;
  /** Re-poll on window focus while visible (default false). */
  refetchOnFocus?: boolean;
}

export interface CommercePoller {
  /** Runs a tick immediately when visible and not already in flight. */
  trigger: () => void;
  /** Stops all timers and removes DOM listeners. */
  stop: () => void;
}

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Visibility-aware, single-flight commerce poller with exponential backoff on
 * missing sessions, 401s, and transient 5xx/network failures. Schedules the
 * next tick only after the active tick settles so slow responses never overlap.
 */
export function startCommercePoller({
  poll,
  getIntervalMs = getCommercePollIntervalMs,
  refetchOnFocus = false,
}: CommercePollerOptions): CommercePoller {
  let active = true;
  let stoppedByOutcome = false;
  let inFlight = false;
  let timer: number | null = null;
  let consecutiveFailures = 0;
  let lastOutcome: CommercePollOutcome = 'ok';

  const clearTimer = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const scheduleNext = (outcome: Exclude<CommercePollOutcome, 'stop'>) => {
    if (!active || stoppedByOutcome || isDocumentHidden()) return;
    clearTimer();
    const base = Math.max(1, getIntervalMs());
    const delay = nextCommercePollDelayMs(base, outcome, consecutiveFailures);
    timer = window.setTimeout(() => {
      timer = null;
      void runTick();
    }, delay);
  };

  const runTick = async () => {
    if (!active || stoppedByOutcome || inFlight || isDocumentHidden()) return;
    clearTimer();
    inFlight = true;
    let outcome: CommercePollOutcome = 'ok';
    try {
      outcome = await poll();
    } catch (error) {
      outcome = classifyCommercePollError(error);
    } finally {
      inFlight = false;
    }
    if (!active) return;
    lastOutcome = outcome;
    if (outcome === 'stop') {
      stoppedByOutcome = true;
      clearTimer();
      return;
    }
    if (outcome === 'ok') {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures += 1;
    }
    scheduleNext(outcome);
  };

  const onVisibilityChange = () => {
    if (!active || stoppedByOutcome) return;
    if (isDocumentHidden()) {
      clearTimer();
      return;
    }
    if (lastOutcome === 'missing_session') {
      scheduleNext('missing_session');
      return;
    }
    void runTick();
  };

  const onFocus = () => {
    if (!active || stoppedByOutcome || isDocumentHidden()) return;
    if (lastOutcome === 'missing_session') return;
    void runTick();
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  if (refetchOnFocus && typeof window !== 'undefined') {
    window.addEventListener('focus', onFocus);
  }

  if (!isDocumentHidden()) {
    void runTick();
  }

  return {
    trigger: () => {
      if (!active || stoppedByOutcome) return;
      void runTick();
    },
    stop: () => {
      active = false;
      clearTimer();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      if (refetchOnFocus && typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus);
      }
    },
  };
}
