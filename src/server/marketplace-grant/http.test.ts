/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/libs/error/error';
import { ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { Logger } from '@/libs/logger/logger';
import { captureAppError } from '@/libs/observability/sentry';
import { BffError } from './bff';
import { cliGrantError, grantError } from './http';
import { GrantServiceError } from './service';

// The global database setup imports the factory before this file's mocks.
vi.hoisted(() => vi.resetModules());
vi.mock('@/libs/observability/sentry', () => ({ captureAppError: vi.fn() }));
vi.mock('@/libs/logger/logger', () => ({ Logger: { error: vi.fn(), warn: vi.fn() } }));

describe.each([
  ['browser', grantError, 'grantError'],
  ['CLI', cliGrantError, 'cliGrantError'],
] as const)('%s grant HTTP errors', (_name, respond, operation) => {
  beforeEach(() => {
    vi.mocked(captureAppError).mockReset();
    vi.mocked(Logger.error).mockClear();
    vi.mocked(Logger.warn).mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports unexpected failures without forwarding private error data', async () => {
    const privateData = 'token=private-token pubky=private-identity SELECT secret FROM sessions';
    const original = new Error(privateData, { cause: { sql: privateData } });
    original.name = 'PrivateTokenAndIdentity';
    original.stack = privateData;

    const response = respond(original);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'grant_unavailable' });
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.has('retry-after')).toBe(false);
    expect(captureAppError).toHaveBeenCalledTimes(1);
    const reported = vi.mocked(captureAppError).mock.calls[0][0];
    expect(reported).toBeInstanceOf(AppError);
    expect(reported).not.toBe(original);
    expect(reported).toMatchObject({
      category: ErrorCategory.Server,
      code: ServerErrorCode.INTERNAL_ERROR,
      message: 'Marketplace grant request failed',
      service: ErrorService.NextJsServer,
      operation,
      context: { statusCode: 503 },
    });
    expect(reported.context).toEqual({ statusCode: 503 });
    expect(reported.cause).toBeUndefined();
    expect(reported.stack).not.toContain(privateData);
    expect(JSON.stringify(vi.mocked(captureAppError).mock.calls)).not.toContain('private-');
    expect(JSON.stringify(vi.mocked(Logger.error).mock.calls)).not.toContain('private-');
    expect(JSON.stringify(vi.mocked(Logger.warn).mock.calls)).not.toContain('private-');
    expect(console.warn).not.toHaveBeenCalled();
    expect(Logger.error).toHaveBeenCalledTimes(1);
  });

  it('reports upstream outages without recording the upstream code', async () => {
    const response = respond(new GrantServiceError(502, 'private-upstream-error-token'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'grant_unavailable' });
    expect(captureAppError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(captureAppError).mock.calls)).not.toContain('private-upstream-error-token');
  });

  it('preserves mapped server status and response code', async () => {
    const response = respond(new BffError(500, 'grant_unavailable'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'grant_unavailable' });
    expect(captureAppError).toHaveBeenCalledWith(expect.objectContaining({ context: { statusCode: 500 } }));
  });

  it.each([400, 401, 403, 404, 409, 410, 422])('does not capture an expected HTTP %i response', async (status) => {
    const response = respond(new BffError(status, 'expected_failure'));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'expected_failure' });
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(captureAppError).not.toHaveBeenCalled();
    expect(Logger.error).not.toHaveBeenCalled();
  });

  it.each([undefined, 12])('keeps rate limiting silent and preserves Retry-After (%s)', async (retryAfter) => {
    const response = respond(new BffError(429, 'retry_later', retryAfter));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'retry_later' });
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('retry-after')).toBe(String(retryAfter ?? 60));
    expect(captureAppError).not.toHaveBeenCalled();
  });

  it('keeps upstream rate limiting silent', async () => {
    const response = respond(new GrantServiceError(429, 'capacity_exhausted'));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(captureAppError).not.toHaveBeenCalled();
  });

  it('does not capture or log an AppError twice', async () => {
    const original = Err.server(ServerErrorCode.SERVICE_UNAVAILABLE, 'Upstream unavailable', {
      service: ErrorService.Marketplace,
      operation: 'approve',
    });
    expect(captureAppError).toHaveBeenCalledTimes(1);
    vi.mocked(captureAppError).mockClear();
    vi.mocked(Logger.error).mockClear();

    const response = respond(original);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'grant_unavailable' });
    expect(captureAppError).not.toHaveBeenCalled();
    expect(Logger.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('preserves the HTTP response when capture fails', async () => {
    vi.mocked(captureAppError).mockImplementationOnce(() => {
      throw new Error('Sentry unavailable');
    });

    const response = respond(new Error('private-auth-token'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'grant_unavailable' });
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(captureAppError).toHaveBeenCalledTimes(1);
    expect(Logger.warn).toHaveBeenCalledWith('[Err.factory] captureAppError failed', expect.any(Error));
    expect(JSON.stringify(vi.mocked(Logger.warn).mock.calls)).not.toContain('private-auth-token');
  });
});
