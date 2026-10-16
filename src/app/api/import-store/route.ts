import { type NextRequest, NextResponse } from 'next/server';
import { IMPORT_STORE_MAX_REQUEST_BODY_BYTES } from '@/config/import-store';
import { ImportStoreController } from '@/controllers/import-store/import-store';
import { importRateLimitKeys, isSameOriginRequest } from '@/libs/api/import-route-guards';
import { handleApiError } from '@/libs/api/route-error-handler';
import { HttpStatusCode } from '@/libs/http/http.types';
import type { TImportStoreFailureReason } from '@/pipes/import-store/import-store.types';

export const runtime = 'nodejs';

const STATUS_BY_REASON: Record<TImportStoreFailureReason, number> = {
  invalid_url: HttpStatusCode.BAD_REQUEST,
  blocked_address: HttpStatusCode.FORBIDDEN,
  dns_failed: HttpStatusCode.BAD_GATEWAY,
  too_many_redirects: HttpStatusCode.BAD_GATEWAY,
  http_error: HttpStatusCode.BAD_GATEWAY,
  not_json: HttpStatusCode.UNPROCESSABLE_ENTITY,
  not_woocommerce: HttpStatusCode.UNPROCESSABLE_ENTITY,
  too_large: HttpStatusCode.PAYLOAD_TOO_LARGE,
  budget_exceeded: HttpStatusCode.PAYLOAD_TOO_LARGE,
  timeout: HttpStatusCode.GATEWAY_TIMEOUT,
  network: HttpStatusCode.BAD_GATEWAY,
  rate_limited: HttpStatusCode.TOO_MANY_REQUESTS,
  cancelled: HttpStatusCode.BAD_GATEWAY,
};

const NO_STORE = 'no-store, private';

/**
 * Reads one page of a seller's public WooCommerce catalogue (or one product)
 * for their import and returns the products, trimmed to what the import reads.
 * The Store API sends no CORS headers, so the browser cannot read it directly.
 * The route never holds or forwards a credential, and only ever fetches the
 * Store API products path under the address the seller gave.
 *
 * POST (not GET): a JSON body forces a CORS preflight for cross-site callers,
 * and responses must never be shared between sellers by a cache.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request)) return failureResponse('blocked_address', HttpStatusCode.FORBIDDEN);

    const body = await readBody(request);
    if (!body.ok) return failureResponse('invalid_url', body.status);

    const result = await ImportStoreController.fetch({
      body: body.value,
      rateLimitKeys: importRateLimitKeys(request),
      signal: request.signal,
    });

    if (!result.ok) {
      return failureResponse(result.reason, STATUS_BY_REASON[result.reason], result.retryAfterSeconds);
    }

    return NextResponse.json(result.response, {
      status: HttpStatusCode.OK,
      headers: { 'Cache-Control': NO_STORE, 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    return handleApiError(error, 'api.import-store.POST', { unknownErrorMessage: 'Internal server error' });
  }
}

function failureResponse(reason: TImportStoreFailureReason, status: number, retryAfterSeconds?: number): NextResponse {
  const headers: Record<string, string> = { 'Cache-Control': NO_STORE };
  if (retryAfterSeconds) headers['Retry-After'] = String(retryAfterSeconds);
  return NextResponse.json({ reason }, { status, headers });
}

async function readBody(request: NextRequest): Promise<{ ok: true; value: unknown } | { ok: false; status: number }> {
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') return { ok: false, status: HttpStatusCode.BAD_REQUEST };

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IMPORT_STORE_MAX_REQUEST_BODY_BYTES) {
    return { ok: false, status: HttpStatusCode.PAYLOAD_TOO_LARGE };
  }

  const text = await request.text();
  if (Buffer.byteLength(text) > IMPORT_STORE_MAX_REQUEST_BODY_BYTES) {
    return { ok: false, status: HttpStatusCode.PAYLOAD_TOO_LARGE };
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, status: HttpStatusCode.BAD_REQUEST };
    }
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, status: HttpStatusCode.BAD_REQUEST };
  }
}
