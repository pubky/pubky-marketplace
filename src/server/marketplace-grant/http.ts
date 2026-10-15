import { NextResponse } from 'next/server';
import postgres from 'postgres';
import { AppError } from '@/libs/error/error';
import { ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { BffError, mapBffError } from './bff';
import { mapCliBffError } from './cli-bff';
import { GrantServiceError } from './service';
import { HomeserverFetchDenied } from './ssrf';

export function noStoreJson(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('cache-control', 'no-store, private');
  return response;
}

export function noStoreEmpty(status: number): NextResponse {
  const response = new NextResponse(null, { status });
  response.headers.set('cache-control', 'no-store, private');
  return response;
}

function applyMappedError(
  mapped: { status: number; code: string; retryAfterSeconds?: number },
  logLabel: string,
  operation: 'grantError' | 'cliGrantError',
  error: unknown,
): NextResponse {
  // AppError factories already report once. BFF/SDK/SQL failures can contain
  // credentials, so classify by known constructors, never arbitrary error names.
  if (!(error instanceof AppError)) {
    const kind =
      error instanceof GrantServiceError
        ? 'grant_service'
        : error instanceof BffError
          ? 'bff'
          : error instanceof HomeserverFetchDenied
            ? 'homeserver_fetch_denied'
            : error instanceof postgres.PostgresError
              ? 'postgres'
              : 'unknown';
    const context = {
      statusCode: mapped.status,
      kind,
      ...(error instanceof GrantServiceError &&
      Number.isInteger(error.status) &&
      error.status >= 100 &&
      error.status <= 599
        ? { upstreamStatus: error.status }
        : {}),
    };
    if (mapped.status >= 500 && mapped.status <= 599) {
      Err.server(ServerErrorCode.INTERNAL_ERROR, 'Marketplace grant request failed', {
        service: ErrorService.NextJsServer,
        operation,
        context,
      });
    } else {
      console.warn(logLabel, context);
    }
  }
  const response = noStoreJson({ error: mapped.code }, mapped.status);
  if (mapped.status === 429) {
    response.headers.set('retry-after', String(mapped.retryAfterSeconds ?? 60));
  }
  return response;
}

export function grantError(error: unknown): NextResponse {
  return applyMappedError(mapBffError(error), '[marketplace-grant] request failed', 'grantError', error);
}

export function cliGrantError(error: unknown): NextResponse {
  return applyMappedError(mapCliBffError(error), '[marketplace-grant-cli] request failed', 'cliGrantError', error);
}

export const grantCookieOptions = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: true,
  path: '/',
};
