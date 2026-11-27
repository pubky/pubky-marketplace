import sharp from 'sharp';
import { IMAGE_MAX_UPLOAD_SIZE } from '@/config/images';
import { Logger } from '@/libs/logger/logger';
import { OG_REVALIDATE } from './ogConstants';

const OG_IMAGE_MAX_EDGE = 1200;
export const OG_IMAGE_MAX_BYTES = IMAGE_MAX_UPLOAD_SIZE;

type ImageBodyResult = { buffer: Buffer } | { overCap: true };

async function readImageBody(res: Response, signal?: AbortSignal): Promise<ImageBodyResult | null> {
  const contentLength = res.headers.get('content-length');
  if (contentLength !== null && Number.parseInt(contentLength, 10) > OG_IMAGE_MAX_BYTES) {
    return { overCap: true };
  }

  const reader = res.body?.getReader();
  if (!reader) return null;

  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined);
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      if (done) return { buffer: Buffer.concat(chunks) };
      totalBytes += value.byteLength;
      if (totalBytes > OG_IMAGE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { overCap: true };
      }
      chunks.push(value);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // The original read error is the useful failure.
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try {
      reader.releaseLock();
    } catch {
      // Lock may already be released after cancel.
    }
  }
}

/**
 * Fetches a remote image, transcodes it to PNG, and returns it as a base64
 * `data:` URI — or `null` on any failure (missing URL, network error, non-2xx,
 * decode failure).
 *
 * Two reasons this is done up-front rather than letting satori fetch `<img src>`
 * directly:
 *   1. satori fetches lazily while the response streams, so a broken URL surfaces
 *      as an un-catchable 500 at stream time. Pre-fetching keeps every remote
 *      fetch inside catchable async code.
 *   2. The Pubky CDN serves WebP, which satori cannot decode ("u2 is not
 *      iterable"). sharp transcodes WebP/JPEG/PNG → PNG (preserving alpha for
 *      avatars) and downscales to bound the payload.
 */
export async function fetchImageAsDataUri(
  url: string | null | undefined,
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch,
  options?: { signal?: AbortSignal },
): Promise<string | null> {
  if (!url) return null;
  try {
    const signal = options?.signal;
    const res = await fetcher(url, {
      next: { revalidate: OG_REVALIDATE },
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) return null;

    const body = await readImageBody(res, signal);
    if (!body) return null;
    if ('overCap' in body) {
      Logger.warn('[ogData] Rejected oversized image body for OG', { url, maxBytes: OG_IMAGE_MAX_BYTES });
      return null;
    }

    const input = body.buffer;
    const png = await sharp(input)
      .resize({ width: OG_IMAGE_MAX_EDGE, height: OG_IMAGE_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch (error) {
    Logger.warn('[ogData] Failed to fetch/transcode image for OG', { url, error });
    return null;
  }
}
