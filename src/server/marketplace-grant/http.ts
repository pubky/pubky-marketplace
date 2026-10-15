import { NextResponse } from 'next/server';
import { AppError } from '@/libs/error/error';
import { ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { mapBffError } from './bff';
import { mapCliBffError } from './cli-bff';

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
  // credentials, so only capture static metadata, never the original error.
  if (!(error instanceof AppError)) {
    if (mapped.status >= 500 && mapped.status <= 599) {
      Err.server(ServerErrorCode.INTERNAL_ERROR, 'Marketplace grant request failed', {
        service: ErrorService.NextJsServer,
        operation,
        context: { statusCode: mapped.status },
      });
    } else {
      console.warn(logLabel, { statusCode: mapped.status });
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
