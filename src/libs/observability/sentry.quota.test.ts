import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, type AppErrorParams } from '@/libs/error/error';
import { ServerErrorCode, TimeoutErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { withIoDeadline } from '@/libs/http/io-deadline';
import { resetRuntimeConfigForTests, RUNTIME_CONFIG_WINDOW_KEY } from '@/libs/runtime-config/runtime-config';
import { NETWORK_RUNTIME_DEFAULTS } from '@/libs/runtime-config/runtime-config.schema';
import { getSentryInitBase } from './sentry';

const capture = vi.hoisted(() => {
  vi.resetModules();
  return { exception: vi.fn() };
});
vi.mock('@sentry/nextjs', () => ({
  withScope: (callback: (scope: unknown) => void) => callback({ setTag: vi.fn(), setContext: vi.fn() }),
  captureException: capture.exception,
}));
vi.mock('@/libs/env/env', () => ({
  Env: { NODE_ENV: 'production', NEXT_PUBLIC_APP_VERSION: 'test' },
}));
vi.mock('@/libs/logger/logger', () => ({ Logger: { error: vi.fn(), warn: vi.fn() } }));

function configure(overrides: Record<string, unknown> = {}) {
  resetRuntimeConfigForTests();
  window[RUNTIME_CONFIG_WINDOW_KEY] = {
    ...NETWORK_RUNTIME_DEFAULTS,
    deployEnv: 'production',
    testnet: false,
    sentryDsn: 'https://public@example.com/1',
    sentryEnvironment: 'staging',
    ...overrides,
  };
  return getSentryInitBase();
}

function timeout(overrides: Partial<Extract<AppErrorParams, { category: ErrorCategory.Timeout }>> = {}) {
  return new AppError({
    category: ErrorCategory.Timeout,
    code: TimeoutErrorCode.REQUEST_TIMEOUT,
    message: 'The request took too long. Please retry.',
    service: ErrorService.Homeserver,
    operation: 'getJsonIfFound',
    context: { timeoutMs: 15_000 },
    ...overrides,
  });
}

describe('Sentry staging error quota', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    capture.exception.mockReset();
  });

  afterEach(() => {
    delete window[RUNTIME_CONFIG_WINDOW_KEY];
    resetRuntimeConfigForTests();
    vi.useRealTimers();
  });

  it('samples staging errors independently of traces', () => {
    const options = configure({ sentryTracesSampleRate: 0 });
    expect(options.sampleRate).toBe(0.1);
    expect(options.tracesSampleRate).toBe(0);
  });

  it.each(['production', 'preview', 'development'])('keeps full error sampling in %s', (environment) => {
    expect(configure({ sentryEnvironment: environment }).sampleRate).toBe(1);
  });

  it('recognizes a named staging environment', () => {
    expect(configure({ sentryEnvironment: 'shop-staging' }).sampleRate).toBe(0.1);
  });

  it('recognizes the staging deployment identity with a custom Sentry label', () => {
    expect(
      configure({
        deployEnv: 'staging',
        exchangeRateApi: 'https://rates.example.com',
        sentryEnvironment: 'test-shop',
      }).sampleRate,
    ).toBe(0.1);
  });

  it.each([0, 0.25, 1])('honors an explicit error sample rate of %s', (sampleRate) => {
    expect(configure({ sentrySampleRate: sampleRate }).sampleRate).toBe(sampleRate);
  });

  it('keeps the first IO timeout and bounds repeats from a polling outage', async () => {
    const beforeSend = configure().beforeSend!;
    const sent: unknown[] = [];
    capture.exception.mockImplementation((error) => {
      const event = beforeSend({ type: undefined, message: error.message }, { originalException: error });
      if (event !== null) sent.push(event);
    });

    // Each poll starts a fresh IO deadline and constructs a new AppError.
    // Catching the timeout at the caller does not undo the factory's capture.
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = withIoDeadline(() => new Promise<never>(() => {}), {
        service: ErrorService.Homeserver,
        operation: 'getJsonIfFound',
        timeoutMs: 1_000,
      }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(1_000);
      await result;
      await vi.advanceTimersByTimeAsync(1_000);
    }

    expect(capture.exception).toHaveBeenCalledTimes(30);
    expect(sent).toHaveLength(1);
  });

  it('reports a continuing outage again after one minute without extending the window on repeats', () => {
    const beforeSend = configure().beforeSend!;
    const send = () => beforeSend({ type: undefined }, { originalException: timeout() });
    expect(send()).not.toBeNull();
    vi.advanceTimersByTime(59_999);
    expect(send()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(send()).not.toBeNull();
  });

  it('keeps different services, operations and IO budgets visible', () => {
    const beforeSend = configure().beforeSend!;
    const errors = [
      timeout(),
      timeout({ service: ErrorService.Nexus }),
      timeout({ operation: 'put' }),
      timeout({ context: { timeoutMs: 2_500 } }),
    ];
    for (const error of errors) expect(beforeSend({ type: undefined }, { originalException: error })).not.toBeNull();
    for (const error of errors) expect(beforeSend({ type: undefined }, { originalException: error })).toBeNull();
  });

  it('does not suppress production timeouts or unrelated staging errors', () => {
    const production = configure({ sentryEnvironment: 'production' }).beforeSend!;
    const staging = configure().beforeSend!;
    const serverError = new AppError({
      category: ErrorCategory.Server,
      code: ServerErrorCode.INTERNAL_ERROR,
      message: 'Internal failure',
      service: ErrorService.Marketplace,
      operation: 'getOrders',
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(production({ type: undefined }, { originalException: timeout() })).not.toBeNull();
      expect(staging({ type: undefined }, { originalException: serverError })).not.toBeNull();
      expect(
        staging({ type: undefined }, { originalException: timeout({ code: TimeoutErrorCode.REQUEST_ABORTED }) }),
      ).not.toBeNull();
      expect(staging({ type: undefined, message: 'Unhandled exception' }, {})).not.toBeNull();
    }
  });

  it('still scrubs accepted events and drops unsafe payloads before using the quota', () => {
    const beforeSend = configure().beforeSend!;
    const unsafe = {
      type: undefined,
      extra: {
        get unsafe() {
          throw new Error('unreadable');
        },
      },
    };
    expect(beforeSend(unsafe, { originalException: timeout() })).toBeNull();
    const hint = { originalException: timeout() };
    const event = beforeSend({ type: undefined, extra: { email: 'alice@example.com' } }, hint);
    expect(event).not.toBeNull();
    expect(JSON.stringify(event)).not.toContain('alice@example.com');
    expect(hint.originalException).not.toBeInstanceOf(AppError);
  });

  it('bounds cache cardinality and recovers after a clock rollback', () => {
    const beforeSend = configure().beforeSend!;
    for (let operation = 0; operation < 200; operation++) {
      expect(
        beforeSend({ type: undefined }, { originalException: timeout({ operation: `read${operation}` }) }),
      ).not.toBeNull();
    }
    expect(beforeSend({ type: undefined }, { originalException: timeout({ operation: 'read0' }) })).not.toBeNull();
    expect(beforeSend({ type: undefined }, { originalException: timeout({ operation: 'read199' }) })).toBeNull();
    vi.setSystemTime(new Date('2025-12-31T23:59:00Z'));
    expect(beforeSend({ type: undefined }, { originalException: timeout({ operation: 'read199' }) })).not.toBeNull();
  });
});
