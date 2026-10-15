/** @vitest-environment node */
import postgres from 'postgres';
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
import { HomeserverFetchDenied } from './ssrf';

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
      context: { statusCode: 503, kind: 'unknown' },
    });
    expect(reported.context).toEqual({ statusCode: 503, kind: 'unknown' });
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
    expect(vi.mocked(captureAppError).mock.calls[0][0].context).toEqual({
      statusCode: 503,
      kind: 'grant_service',
      upstreamStatus: 502,
    });
    expect(JSON.stringify(vi.mocked(captureAppError).mock.calls)).not.toContain('private-upstream-error-token');
  });

  it.each([NaN, Infinity, 99, 600, 503.5])('omits invalid upstream status %s', (status) => {
    respond(new GrantServiceError(status, 'private-upstream-error-token'));

    expect(vi.mocked(captureAppError).mock.calls[0][0].context).toEqual({
      statusCode: 503,
      kind: 'grant_service',
    });
  });

  it('classifies Postgres errors without recording SQL, parameters or identity', () => {
    // The driver's declaration inherits Error's constructor signature. Its
    // runtime constructor copies protocol fields, populated explicitly here.
    const original = Object.assign(new postgres.PostgresError(''), {
      message: 'private-db-password',
      query: 'SELECT private-token FROM private-table',
      parameters: ['private-pubky-identity'],
      detail: 'private-row-contents',
      cause: new Error('private-connection-string'),
    });
    original.stack = 'private-original-stack';

    respond(original);

    expect(captureAppError).toHaveBeenCalledTimes(1);
    const reported = vi.mocked(captureAppError).mock.calls[0][0];
    expect(reported.context).toEqual({ statusCode: 503, kind: 'postgres' });
    expect(reported.cause).toBeUndefined();
    expect(reported.stack).not.toContain('private-original-stack');
    expect(JSON.stringify(vi.mocked(captureAppError).mock.calls)).not.toContain('private-');
    expect(JSON.stringify(vi.mocked(Logger.error).mock.calls)).not.toContain('private-');
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each(['GrantServiceError', 'BffError', 'HomeserverFetchDenied', 'PostgresError'])(
    'does not classify an arbitrary error by its forged %s name',
    (name) => {
      const original = Object.assign(new Error('private-token'), { name, status: 502 });

      respond(original);

      expect(vi.mocked(captureAppError).mock.calls[0][0].context).toEqual({ statusCode: 503, kind: 'unknown' });
    },
  );

  it('classifies homeserver fetch denial while preserving browser and CLI response mappings', async () => {
    const original = new HomeserverFetchDenied();
    original.message = 'private-proof-url';
    const response = respond(original);

    if (respond === cliGrantError) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'homeserver_proof_invalid' });
      expect(captureAppError).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledExactlyOnceWith('[marketplace-grant-cli] request failed', {
        statusCode: 401,
        kind: 'homeserver_fetch_denied',
      });
    } else {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'grant_unavailable' });
      expect(vi.mocked(captureAppError).mock.calls[0][0].context).toEqual({
        statusCode: 503,
        kind: 'homeserver_fetch_denied',
      });
    }
    expect(JSON.stringify(vi.mocked(captureAppError).mock.calls)).not.toContain('private-proof-url');
    expect(JSON.stringify(vi.mocked(Logger.error).mock.calls)).not.toContain('private-proof-url');
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private-proof-url');
  });

  it('preserves mapped server status and response code', async () => {
    const response = respond(new BffError(500, 'grant_unavailable'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'grant_unavailable' });
    expect(captureAppError).toHaveBeenCalledWith(
      expect.objectContaining({ context: { statusCode: 500, kind: 'bff' } }),
    );
  });

  it.each([400, 401, 403, 404, 409, 410, 422])('does not capture an expected HTTP %i response', async (status) => {
    const response = respond(new BffError(status, 'expected_failure'));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'expected_failure' });
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(captureAppError).not.toHaveBeenCalled();
    expect(Logger.error).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(expect.any(String), { statusCode: status, kind: 'bff' });
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
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(expect.any(String), {
      statusCode: 429,
      kind: 'grant_service',
      upstreamStatus: 429,
    });
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
