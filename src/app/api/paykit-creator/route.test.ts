import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaykitCreatorController } from '@/controllers/paykit-creator/paykit-creator';
import { ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { HttpStatusCode } from '@/libs/http/http.types';
import { GET } from './route';

const request = (query: Record<string, string>) =>
  new NextRequest(`http://localhost/api/paykit-creator?${new URLSearchParams(query)}`);

const validQuery = { creator: 'pubkygy1wnkhfwezwdnawnur1bc3kw1x3jf5ggjj3cm37e31i5ntq3pco' };

describe('API Route: /api/paykit-creator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it('reports a Paykit outage with its status instead of an answer', async () => {
    vi.spyOn(PaykitCreatorController, 'fetchCreatorHeld').mockRejectedValue(
      Err.server(ServerErrorCode.SERVICE_UNAVAILABLE, 'Paykit unavailable', {
        service: ErrorService.Paykit,
        operation: 'isCreatorHeld',
        context: { statusCode: HttpStatusCode.SERVICE_UNAVAILABLE },
      }),
    );

    const response = await GET(request(validQuery));

    expect(response.status).toBe(HttpStatusCode.SERVICE_UNAVAILABLE);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Paykit unavailable' });
  });

  it('hides an unexpected error behind a 500', async () => {
    vi.spyOn(PaykitCreatorController, 'fetchCreatorHeld').mockRejectedValue(new Error('boom'));

    const response = await GET(request(validQuery));

    expect(response.status).toBe(HttpStatusCode.INTERNAL_SERVER_ERROR);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
  });
});
