import { type NextRequest, NextResponse } from 'next/server';
import { PaykitCreatorController } from '@/controllers/paykit-creator/paykit-creator';
import { importRateLimitKeys, isSameOriginRequest } from '@/libs/api/import-route-guards';
import { AppError } from '@/libs/error/error';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { HttpStatusCode } from '@/libs/http/http.types';

/**
 * Whether the Paykit Server already holds a creator, for the Shop's own pages.
 *
 * The Paykit Server sends no `Access-Control-Allow-Origin`, so a browser cannot read its answer
 * directly; this route asks server-side. The answer changes when a creator finishes a setup, so no
 * browser or CDN may keep it; the service behind it reuses an answer for seconds to spare the read
 * limit every caller of this route shares, and caps the reads per caller and in all.
 *
 * Whatever Paykit sends, the route answers with one of a fixed set of statuses: 200, 400 for a malformed
 * creator, 403 for a cross-site caller, 429 (with `Retry-After`) when a limit is reached here or at Paykit,
 * 503 when Paykit's storage cannot answer, 504 when it does not answer in time, 502 for any other failure
 * of Paykit, and 500 for a failure of this server.
 */
const NO_STORE = 'no-store';

export async function GET(request: NextRequest) {
  if (!isSameOriginRequest(request)) return failure(HttpStatusCode.FORBIDDEN, 'Forbidden');
  try {
    const result = await PaykitCreatorController.fetchCreatorHeld({
      creator: request.nextUrl.searchParams.get('creator'),
      rateLimitKeys: importRateLimitKeys(request),
    });

    if (!result.ok) return failure(result.statusCode, result.message);

    return NextResponse.json({ held: result.held }, { headers: { 'Cache-Control': NO_STORE } });
  } catch (error) {
    return failureFromError(error);
  }
}

function failureFromError(error: unknown): NextResponse {
  if (!(error instanceof AppError)) return failure(HttpStatusCode.INTERNAL_SERVER_ERROR, 'Internal server error');
  switch (error.category) {
    case ErrorCategory.RateLimit: {
      const retryAfter = error.context?.retryAfter;
      return failure(
        HttpStatusCode.TOO_MANY_REQUESTS,
        'Too many requests',
        typeof retryAfter === 'number' && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    case ErrorCategory.Timeout:
      return failure(HttpStatusCode.GATEWAY_TIMEOUT, 'Paykit timed out');
    case ErrorCategory.Validation:
      return failure(HttpStatusCode.INTERNAL_SERVER_ERROR, 'Internal server error');
  }
  if (error.service !== ErrorService.Paykit) {
    return failure(HttpStatusCode.INTERNAL_SERVER_ERROR, 'Internal server error');
  }
  if (error.context?.statusCode === HttpStatusCode.SERVICE_UNAVAILABLE) {
    return failure(HttpStatusCode.SERVICE_UNAVAILABLE, 'Paykit unavailable');
  }
  return failure(HttpStatusCode.BAD_GATEWAY, 'Paykit gave no answer');
}

function failure(status: number, message: string, retryAfterSeconds?: number): NextResponse {
  const headers: Record<string, string> = { 'Cache-Control': NO_STORE };
  if (retryAfterSeconds) headers['Retry-After'] = String(retryAfterSeconds);
  return NextResponse.json({ error: message }, { status, headers });
}
