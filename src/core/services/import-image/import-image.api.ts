import { withBasePath } from '@/config/base-path';
import type { TImportImageFailureReason, TImportImageMimeType } from '@/pipes/import-image/import-image.types';
import { isImportImageFailureReason } from '@/pipes/import-image/import-image.types';

export type TImportImageApiResult =
  | { ok: true; bytes: Uint8Array; mimeType: TImportImageMimeType | string }
  | { ok: false; reason: TImportImageFailureReason; retryAfterSeconds?: number };

export type TImportImageApiParams = {
  url: string;
  remainingBytes: number;
  signal?: AbortSignal;
};

const ROUTE = '/api/import-image';

/** Browser client for the import-image route. Same-origin only. */
export class ImportImageApiService {
  private constructor() {}

  static async fetchImage({ url, remainingBytes, signal }: TImportImageApiParams): Promise<TImportImageApiResult> {
    let response: Response;
    try {
      response = await fetch(withBasePath(ROUTE), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, remainingBytes }),
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
      });
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return { ok: false, reason: 'cancelled' };
      }
      return { ok: false, reason: 'network' };
    }

    if (response.ok) {
      try {
        return {
          ok: true,
          bytes: new Uint8Array(await response.arrayBuffer()),
          mimeType: response.headers.get('content-type') ?? '',
        };
      } catch {
        return { ok: false, reason: signal?.aborted ? 'cancelled' : 'network' };
      }
    }

    const failure = await readFailure(response);
    const retryAfter = Number(response.headers.get('retry-after'));
    return {
      ok: false,
      reason: failure,
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    };
  }
}

async function readFailure(response: Response): Promise<TImportImageFailureReason> {
  try {
    const body: unknown = await response.json();
    const reason = body && typeof body === 'object' && 'reason' in body ? body.reason : undefined;
    if (isImportImageFailureReason(reason)) return reason;
  } catch {
    // Non-JSON error bodies (proxy pages, 5xx) carry no reason.
  }
  return 'network';
}
