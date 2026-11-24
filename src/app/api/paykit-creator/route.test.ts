import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaykitCreatorController } from '@/controllers/paykit-creator/paykit-creator';
import {
  AuthErrorCode,
  NetworkErrorCode,
  RateLimitErrorCode,
  ServerErrorCode,
  TimeoutErrorCode,
  ValidationErrorCode,
} from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { HttpStatusCode } from '@/libs/http/http.types';
import { GET } from './route';

const request = (
  query: Record<string, string>,
  headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' },
) => new NextRequest(`http://localhost/api/paykit-creator?${new URLSearchParams(query)}`, { headers });

const paykit = { service: ErrorService.Paykit, operation: 'isCreatorHeld' };

const validQuery = { creator: 'pubkygy1wnkhfwezwdnawnur1bc3kw1x3jf5ggjj3cm37e31i5ntq3pco' };

describe('API Route: /api/paykit-creator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('VERCEL', undefined);
    vi.stubEnv('SHOP_BFF_CLI_TRUSTED_PROXY_COUNT', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['a cross-site page', { 'sec-fetch-site': 'cross-site' }],
    ['a same-site page', { 'sec-fetch-site': 'same-site' }],
    ['a client sending neither Sec-Fetch-Site nor Origin', {}],
    ['a foreign Origin', { origin: 'https://evil.example' }],
  ])('refuses %s with a 403 before asking anything', async (_label, headers) => {
    const fetchCreatorHeld = vi.spyOn(PaykitCreatorController, 'fetchCreatorHeld');

    const response = await GET(request(validQuery, headers));

    expect(response.status).toBe(HttpStatusCode.FORBIDDEN);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetchCreatorHeld).not.toHaveBeenCalled();
  });

  it('accepts an older browser whose Origin matches the host', async () => {
    vi.spyOn(PaykitCreatorController, 'fetchCreatorHeld').mockResolvedValue({ ok: true, held: false });

    const response = await GET(request(validQuery, { origin: 'http://localhost' }));

    expect(response.status).toBe(200);
  });

  it('keys the caller by its trusted client address', async () => {
    vi.stubEnv('SHOP_BFF_CLI_TRUSTED_PROXY_COUNT', '1');
    const fetchCreatorHeld = vi
      .spyOn(PaykitCreatorController, 'fetchCreatorHeld')
      .mockResolvedValue({ ok: true, held: true });

    await GET(request(validQuery, { 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '198.51.100.1, 203.0.113.9' }));

    expect(fetchCreatorHeld).toHaveBeenCalledWith({ creator: validQuery.creator, rateLimitKeys: ['ip:203.0.113.9'] });
  });

  it('answers { held: true } when Paykit holds the creator', async () => {
    vi.spyOn(PaykitCreatorController, 'fetchCreatorHeld').mockResolvedValue({ ok: true, held: true });

    const response = await GET(request(validQuery));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ held: true });
  });

  it('never lets a CDN or the browser cache the answer', async () => {
    vi.spyOn(PaykitCreatorController, 'fetchCreatorHeld').mockResolvedValue({ ok: true, held: true });

    const response = await GET(request(validQuery));

    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('passes the controller validation failure through as a 400', async () => {
    vi.spyOn(PaykitCreatorController, 'fetchCreatorHeld').mockResolvedValue({
      ok: false,
      message: 'Invalid creator',
      statusCode: HttpStatusCode.BAD_REQUEST,
    });

    const response = await GET(request({}));

    expect(response.status).toBe(HttpStatusCode.BAD_REQUEST);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Invalid creator' });
  });

  it.each([
    [
      'a refusal by the route limiter, with its Retry-After',
      Err.rateLimit(RateLimitErrorCode.RATE_LIMITED, 'Too many creator lookups', {
        service: ErrorService.Local,
        operation: 'admit',
        context: { retryAfter: 42 },
      }),
      HttpStatusCode.TOO_MANY_REQUESTS,
      'Too many requests',
      '42',
    ],
    [
      'a 429 from Paykit, with its Retry-After',
      Err.rateLimit(RateLimitErrorCode.RATE_LIMITED, 'Too Many Requests', {
        ...paykit,
        context: { statusCode: 429, retryAfter: 60 },
      }),
      HttpStatusCode.TOO_MANY_REQUESTS,
      'Too many requests',
      '60',
    ],
    [
      'a 503 from Paykit',
      Err.server(ServerErrorCode.SERVICE_UNAVAILABLE, 'Service Unavailable', {
        ...paykit,
        context: { statusCode: 503 },
      }),
      HttpStatusCode.SERVICE_UNAVAILABLE,
      'Paykit unavailable',
      null,
    ],
    [
      'a timeout',
      Err.timeout(TimeoutErrorCode.REQUEST_TIMEOUT, 'This operation was aborted', paykit),
      HttpStatusCode.GATEWAY_TIMEOUT,
      'Paykit timed out',
      null,
    ],
    [
      'a 204 from Paykit, which NextResponse.json cannot send',
      Err.server(ServerErrorCode.UNKNOWN_ERROR, 'No Content', { ...paykit, context: { statusCode: 204 } }),
      HttpStatusCode.BAD_GATEWAY,
      'Paykit gave no answer',
      null,
    ],
    [
      'a 302 from Paykit',
      Err.server(ServerErrorCode.UNKNOWN_ERROR, 'Found', { ...paykit, context: { statusCode: 302 } }),
      HttpStatusCode.BAD_GATEWAY,
      'Paykit gave no answer',
      null,
    ],
    [
      'a 401 from Paykit',
      Err.auth(AuthErrorCode.UNAUTHORIZED, 'Unauthorized', { ...paykit, context: { statusCode: 401 } }),
      HttpStatusCode.BAD_GATEWAY,
      'Paykit gave no answer',
      null,
    ],
    [
      'a 400 from Paykit',
      Err.server(ServerErrorCode.UNKNOWN_ERROR, 'Bad Request', { ...paykit, context: { statusCode: 400 } }),
      HttpStatusCode.BAD_GATEWAY,
      'Paykit gave no answer',
      null,
    ],
    [
      'a network failure',
      Err.network(NetworkErrorCode.CONNECTION_FAILED, 'fetch failed', paykit),
      HttpStatusCode.BAD_GATEWAY,
      'Paykit gave no answer',
      null,
    ],
    [
      'a malformed answer',
      Err.server(ServerErrorCode.INVALID_RESPONSE, 'Paykit creator-held response is invalid', paykit),
      HttpStatusCode.BAD_GATEWAY,
      'Paykit gave no answer',
      null,
    ],
    [
      'a missing Paykit configuration',
      Err.validation(ValidationErrorCode.MISSING_FIELD, 'No Paykit Server configured', paykit),
      HttpStatusCode.INTERNAL_SERVER_ERROR,
      'Internal server error',
      null,
    ],
    ['an unexpected error', new Error('boom'), HttpStatusCode.INTERNAL_SERVER_ERROR, 'Internal server error', null],
  ])('answers %s with a fixed status and message', async (_label, error, status, message, retryAfter) => {
    vi.spyOn(PaykitCreatorController, 'fetchCreatorHeld').mockRejectedValue(error);

    const response = await GET(request(validQuery));

    expect(response.status).toBe(status);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Retry-After')).toBe(retryAfter);
    await expect(response.json()).resolves.toEqual({ error: message });
  });
});
