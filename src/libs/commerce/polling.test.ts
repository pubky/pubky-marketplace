import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/libs/error/error';
import { AuthErrorCode, ServerErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import {
  classifyCommercePollError,
  COMMERCE_ACTIVE_CHECKOUT_POLL_INTERVAL_MS,
  COMMERCE_POLL_MAX_BACKOFF_MS,
  COMMERCE_POLL_MISSING_SESSION_MIN_BACKOFF_MS,
  getAdaptiveOrderPollIntervalMs,
  nextCommercePollDelayMs,
  startCommercePoller,
} from './polling';

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('commerce polling scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });

  afterEach(() => {
    setVisibility('visible');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('pauses while document is hidden and resumes immediately when visible again', async () => {
    const poll = vi.fn(async () => 'ok' as const);
    const poller = startCommercePoller({ poll, getIntervalMs: () => 5_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(poll).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(poll).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it('never overlaps ticks while a prior tick is still in flight', async () => {
    let resolveFirst: (() => void) | undefined;
    const poll = vi
      .fn<() => Promise<'ok'>>()
      .mockImplementationOnce(
        () =>
          new Promise<'ok'>((resolve) => {
            resolveFirst = () => resolve('ok');
          }),
      )
      .mockResolvedValue('ok');

    const poller = startCommercePoller({ poll, getIntervalMs: () => 2_000, refetchOnFocus: true });
    expect(poll).toHaveBeenCalledTimes(1);

    // Time elapses and focus/trigger fire while the first tick is still pending.
    await vi.advanceTimersByTimeAsync(20_000);
    window.dispatchEvent(new Event('focus'));
    poller.trigger();
    expect(poll).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(poll).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('applies exponential backoff on 5xx errors and resets after recovery', async () => {
    const poll = vi
      .fn<() => Promise<'ok' | 'retryable_error'>>()
      .mockResolvedValueOnce('retryable_error')
      .mockResolvedValueOnce('retryable_error')
      .mockResolvedValue('ok');

    const poller = startCommercePoller({ poll, getIntervalMs: () => 5_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);

    // 1st failure backs off to 10s (not 5s).
    await vi.advanceTimersByTimeAsync(9_999);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);

    // 2nd failure backs off to 20s.
    await vi.advanceTimersByTimeAsync(19_999);
    expect(poll).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(3);

    // Recovery returns to the 5s base cadence.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(poll).toHaveBeenCalledTimes(4);
    poller.stop();
  });

  it('backs off sharply on missing session / 401 and ignores focus spam while waiting', async () => {
    const poll = vi.fn(async () => 'missing_session' as const);
    const poller = startCommercePoller({ poll, getIntervalMs: () => 5_000, refetchOnFocus: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(COMMERCE_POLL_MISSING_SESSION_MIN_BACKOFF_MS - 1);
    expect(poll).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(COMMERCE_POLL_MAX_BACKOFF_MS - 1);
    expect(poll).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it('stops polling permanently when outcome is stop until restart() is called', async () => {
    const poll = vi.fn<() => Promise<'stop' | 'ok'>>().mockResolvedValueOnce('stop').mockResolvedValue('ok');
    const poller = startCommercePoller({ poll, getIntervalMs: () => 2_000, refetchOnFocus: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event('focus'));
    expect(poll).toHaveBeenCalledTimes(1);

    poller.restart();
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(poll).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it('classifies session/401 errors separately from 5xx/network failures', () => {
    const expired = new AppError({
      category: ErrorCategory.Auth,
      code: AuthErrorCode.SESSION_EXPIRED,
      message: 'expired',
      service: ErrorService.Marketplace,
      operation: 'getOrders',
    });
    const http401 = new AppError({
      category: ErrorCategory.Auth,
      code: AuthErrorCode.UNAUTHORIZED,
      message: 'unauthorized',
      service: ErrorService.Marketplace,
      operation: 'getOrders',
      context: { statusCode: 401 },
    });
    const http503 = new AppError({
      category: ErrorCategory.Server,
      code: ServerErrorCode.SERVICE_UNAVAILABLE,
      message: 'unavailable',
      service: ErrorService.Marketplace,
      operation: 'getOrders',
      context: { statusCode: 503 },
    });

    expect(classifyCommercePollError(expired)).toBe('missing_session');
    expect(classifyCommercePollError(http401)).toBe('missing_session');
    expect(classifyCommercePollError(http503)).toBe('retryable_error');
    expect(nextCommercePollDelayMs(5_000, 'retryable_error', 10)).toBe(COMMERCE_POLL_MAX_BACKOFF_MS);
  });

  it('uses default 5s idle and 2s active checkout cadence for order polling', () => {
    expect(getAdaptiveOrderPollIntervalMs(false)).toBe(5_000);
    expect(getAdaptiveOrderPollIntervalMs(true)).toBe(COMMERCE_ACTIVE_CHECKOUT_POLL_INTERVAL_MS);
  });
});
