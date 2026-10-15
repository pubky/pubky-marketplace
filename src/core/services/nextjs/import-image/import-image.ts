import type { LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import type { TImportImageFetchResult } from '@/application/import-image/import-image.types';
import {
  IMPORT_IMAGE_FETCH_TIMEOUT_MS,
  IMPORT_IMAGE_MAX_BYTES,
  IMPORT_IMAGE_MAX_REDIRECTS,
} from '@/config/import-image';
import { Logger } from '@/libs/logger/logger';
import { IMPORT_IMAGE_SNIFF_BYTES, sniffImageMimeType } from '@/pipes/import-image/import-image.sniff';
import type { TImportImageFailureReason } from '@/pipes/import-image/import-image.types';
import { ImportImageValidators } from '@/pipes/import-image/import-image.validators';
import { checkDnsSafety } from '../nextjs.utils';

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; PubkyShopImportImageFetcher/1.0)',
  Accept: 'image/jpeg,image/png,image/webp,image/gif;q=0.9,*/*;q=0.1',
};

/** Declared types that are certainly not a raster photo; opaque binary types fall through to byte sniffing. */
const OPAQUE_BINARY_TYPES = new Set([
  'application/octet-stream',
  'binary/octet-stream',
  'application/x-www-form-urlencoded',
]);

type TTransportFailureKind = 'blocked_address' | 'dns_failed';

/**
 * Internal transport signal raised from the connection-time DNS lookup. It stays
 * outside Err.* because a seller's CSV pointing at an unreachable host is an
 * expected per-image outcome, mapped to data before it leaves this module.
 */
class ImportImageTransportError extends Error {
  constructor(
    readonly kind: TTransportFailureKind,
    cause?: unknown,
  ) {
    super(`Import image transport failure: ${kind}`, { cause });
    this.name = 'ImportImageTransportError';
  }
}

type TOutcome<T> = { ok: true; value: T } | { ok: false; reason: TImportImageFailureReason; status?: number };

/**
 * Connection-time lookup: resolves every answer, refuses the connection if any
 * answer is non-global, and hands the socket only vetted addresses. This closes
 * the gap between the preflight check and connect (DNS rebinding).
 */
export function importImageSafeLookup(...[hostname, options, callback]: Parameters<LookupFunction>): void {
  void (async () => {
    try {
      const dnsResult = await checkDnsSafety(hostname);
      if (!dnsResult.ok) {
        callback(
          new ImportImageTransportError(dnsResult.reason === 'unsafe_ip' ? 'blocked_address' : 'dns_failed'),
          '',
        );
        return;
      }

      const requestedFamily =
        options.family === 4 || options.family === 'IPv4'
          ? 4
          : options.family === 6 || options.family === 'IPv6'
            ? 6
            : null;
      const addresses = dnsResult.addresses.filter(({ family }) => !requestedFamily || requestedFamily === family);
      if (addresses.length === 0) {
        callback(new ImportImageTransportError('dns_failed'), '');
        return;
      }

      if (options.all) {
        callback(null, addresses);
        return;
      }
      callback(null, addresses[0].address, addresses[0].family);
    } catch (error) {
      callback(error instanceof Error ? error : new ImportImageTransportError('dns_failed', error), '');
    }
  })();
}

const SAFE_DISPATCHER = new Agent({ connect: { lookup: importImageSafeLookup } });

export type TNextJsImportImageFetchParams = {
  url: URL;
  /** Bytes still available in the caller's import budget; null when unknown. */
  remainingBytes: number | null;
  signal?: AbortSignal;
};

/**
 * Fetches one remote image for a seller's import.
 *
 * Guards: https only; DNS preflight and connection-time pinning on every hop;
 * manual redirects capped and re-validated; no cookies, credentials or referrer;
 * one wall-clock timeout over headers and body; streamed byte cap; image type
 * decided from the bytes. Expected failures return as data.
 */
export class NextJsImportImageService {
  private constructor() {}

  static async fetch({ url, remainingBytes, signal }: TNextJsImportImageFetchParams): Promise<TImportImageFetchResult> {
    const budgetBound = remainingBytes !== null && remainingBytes < IMPORT_IMAGE_MAX_BYTES;
    const maxBytes = budgetBound ? remainingBytes : IMPORT_IMAGE_MAX_BYTES;
    const overLimitReason: TImportImageFailureReason = budgetBound ? 'budget_exceeded' : 'too_large';

    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, IMPORT_IMAGE_FETCH_TIMEOUT_MS);
    const onExternalAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const hop = await followRedirects(url, controller.signal);
      if (!hop.ok) return failure(hop.reason, url, hop.status);

      const response = hop.value;
      if (response.status < 200 || response.status >= 300) {
        await cancelBody(response);
        return failure('http_error', url, response.status);
      }

      const declared = parseDeclaredType(response.headers.get('content-type'));
      if (declared === 'not_image') {
        await cancelBody(response);
        return failure('not_image', url);
      }

      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        await cancelBody(response);
        return failure(overLimitReason, url);
      }

      const body = await readCapped(response, maxBytes);
      if (!body.ok) return failure(body.reason === 'too_large' ? overLimitReason : body.reason, url);

      return { ok: true, bytes: body.value.bytes, mimeType: body.value.mimeType };
    } catch (error) {
      return failure(classifyError(error, timedOut), url);
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }
}

async function followRedirects(startUrl: URL, signal: AbortSignal): Promise<TOutcome<Response>> {
  let current = startUrl;

  for (let hop = 0; hop <= IMPORT_IMAGE_MAX_REDIRECTS; hop += 1) {
    const validation = ImportImageValidators.validateParsed(current);
    if (!validation.ok) return { ok: false, reason: hop === 0 ? 'invalid_url' : 'blocked_address' };

    const dns = await checkDnsSafety(current.hostname);
    if (!dns.ok) return { ok: false, reason: dns.reason === 'unsafe_ip' ? 'blocked_address' : 'dns_failed' };

    const response = (await undiciFetch(current, {
      method: 'GET',
      headers: FETCH_HEADERS,
      redirect: 'manual',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal,
      dispatcher: SAFE_DISPATCHER,
    })) as unknown as Response;

    if (response.status < 300 || response.status >= 400) return { ok: true, value: response };

    const location = response.headers.get('location');
    await cancelBody(response);
    if (!location) return { ok: false, reason: 'http_error', status: response.status };

    try {
      current = new URL(location, current);
    } catch {
      return { ok: false, reason: 'http_error', status: response.status };
    }
  }

  return { ok: false, reason: 'too_many_redirects' };
}

function parseDeclaredType(header: string | null): 'unknown' | 'image' | 'not_image' {
  if (!header) return 'unknown';
  const type = header.split(';')[0].trim().toLowerCase();
  if (!type || OPAQUE_BINARY_TYPES.has(type)) return 'unknown';
  if (type === 'image/svg+xml') return 'not_image';
  return type.startsWith('image/') ? 'image' : 'not_image';
}

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<TOutcome<{ bytes: Uint8Array; mimeType: NonNullable<ReturnType<typeof sniffImageMimeType>> }>> {
  const reader = response.body?.getReader();
  if (!reader) return { ok: false, reason: 'not_image' };

  const chunks: Uint8Array[] = [];
  let total = 0;
  let mimeType: ReturnType<typeof sniffImageMimeType> = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);

      if (!mimeType && total >= IMPORT_IMAGE_SNIFF_BYTES) {
        mimeType = sniffImageMimeType(concat(chunks, total));
        if (!mimeType) {
          await reader.cancel().catch(() => {});
          return { ok: false, reason: 'not_image' };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = concat(chunks, total);
  mimeType ??= sniffImageMimeType(bytes);
  if (!mimeType || total === 0) return { ok: false, reason: 'not_image' };
  return { ok: true, value: { bytes, mimeType } };
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {});
}

function classifyError(error: unknown, timedOut: boolean): TImportImageFailureReason {
  if (timedOut) return 'timeout';

  const seen = new Set<unknown>();
  let candidate: unknown = error;
  while (candidate && typeof candidate === 'object' && !seen.has(candidate)) {
    if (candidate instanceof ImportImageTransportError) return candidate.kind;
    if ('name' in candidate && candidate.name === 'AbortError') return 'cancelled';
    seen.add(candidate);
    candidate = 'cause' in candidate ? candidate.cause : undefined;
  }
  return 'network';
}

function failure(reason: TImportImageFailureReason, url: URL, status?: number): TImportImageFetchResult {
  Logger.warn('[import-image:fetch]', { outcome: 'failed', reason, hostname: url.hostname, status });
  return { ok: false, reason, status };
}
