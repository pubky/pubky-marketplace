import { type NextRequest, NextResponse } from 'next/server';
import { IMPORT_IMAGE_MAX_REQUEST_BODY_BYTES } from '@/config/import-image';
import { ImportImageController } from '@/controllers/import-image/import-image';
import { importRateLimitKeys, isSameOriginRequest } from '@/libs/api/import-route-guards';
import { handleApiError } from '@/libs/api/route-error-handler';
import { HttpStatusCode } from '@/libs/http/http.types';
import type { TImportImageFailureReason } from '@/pipes/import-image/import-image.types';

export const runtime = 'nodejs';

const STATUS_BY_REASON: Record<TImportImageFailureReason, number> = {
  invalid_url: HttpStatusCode.BAD_REQUEST,
  blocked_address: HttpStatusCode.FORBIDDEN,
  dns_failed: HttpStatusCode.BAD_GATEWAY,
  too_many_redirects: HttpStatusCode.BAD_GATEWAY,
  http_error: HttpStatusCode.BAD_GATEWAY,
  not_image: HttpStatusCode.UNPROCESSABLE_ENTITY,
  too_large: HttpStatusCode.PAYLOAD_TOO_LARGE,
  budget_exceeded: HttpStatusCode.PAYLOAD_TOO_LARGE,
  timeout: HttpStatusCode.GATEWAY_TIMEOUT,
  network: HttpStatusCode.BAD_GATEWAY,
  rate_limited: HttpStatusCode.TOO_MANY_REQUESTS,
  decode_failed: HttpStatusCode.UNPROCESSABLE_ENTITY,
  upload_failed: HttpStatusCode.BAD_GATEWAY,
  limit_reached: HttpStatusCode.PAYLOAD_TOO_LARGE,
  cancelled: HttpStatusCode.BAD_GATEWAY,
};

const NO_STORE = 'no-store, private';

/**
 * Fetches one product image for a seller's import and returns its bytes. The
 * browser then uploads them to the seller's homeserver with the seller's own
 * session; this route never holds or forwards any credential.
 *
 * POST (not GET): a JSON body forces a CORS preflight for cross-site callers,
 * and responses must never be shared between sellers by a cache.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request)) return failureResponse('blocked_address', HttpStatusCode.FORBIDDEN);

    const body = await readBody(request);
    if (!body.ok) return failureResponse('invalid_url', body.status);

    const result = await ImportImageController.fetch({
      url: body.value.url,
      remainingBytes: body.value.remainingBytes,
      rateLimitKeys: importRateLimitKeys(request),
      signal: request.signal,
    });

    if (!result.ok) {
      return failureResponse(result.reason, STATUS_BY_REASON[result.reason], result.retryAfterSeconds);
    }

    return new NextResponse(result.bytes as BodyInit, {
      status: HttpStatusCode.OK,
      headers: {
        'Content-Type': result.mimeType,
        'Content-Length': String(result.bytes.byteLength),
        'Cache-Control': NO_STORE,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return handleApiError(error, 'api.import-image.POST', { unknownErrorMessage: 'Internal server error' });
  }
}

function failureResponse(reason: TImportImageFailureReason, status: number, retryAfterSeconds?: number): NextResponse {
  const headers: Record<string, string> = { 'Cache-Control': NO_STORE };
  if (retryAfterSeconds) headers['Retry-After'] = String(retryAfterSeconds);
  return NextResponse.json({ reason }, { status, headers });
}

type TBody = { url: unknown; remainingBytes: unknown };

async function readBody(request: NextRequest): Promise<{ ok: true; value: TBody } | { ok: false; status: number }> {
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') return { ok: false, status: HttpStatusCode.BAD_REQUEST };

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IMPORT_IMAGE_MAX_REQUEST_BODY_BYTES) {
    return { ok: false, status: HttpStatusCode.PAYLOAD_TOO_LARGE };
  }

  const text = await request.text();
  if (Buffer.byteLength(text) > IMPORT_IMAGE_MAX_REQUEST_BODY_BYTES) {
    return { ok: false, status: HttpStatusCode.PAYLOAD_TOO_LARGE };
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, status: HttpStatusCode.BAD_REQUEST };
    }
    const { url, remainingBytes } = parsed as Record<string, unknown>;
    return { ok: true, value: { url, remainingBytes } };
  } catch {
    return { ok: false, status: HttpStatusCode.BAD_REQUEST };
  }
}
