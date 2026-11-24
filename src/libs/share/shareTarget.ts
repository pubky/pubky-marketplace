import { rasterImageMimeType } from '@/libs/media/image-bytes';

/**
 * Utilities for the Web Share Target API integration.
 *
 * When the OS shares content to this PWA, the service worker intercepts the POST,
 * caches any shared files, and redirects to /share with query parameters.
 * These utilities help the share page retrieve the cached files and compose post content.
 */

const SHARE_TARGET_CACHE = 'share-target-files';

/** Leading bytes read to type a shared file; an AVIF `ftyp` box fits well inside. */
const SHARED_FILE_HEAD_BYTES = 256;

/**
 * Audio and video types that both the manifest's `share_target` offers and the
 * post composer accepts (pubky-app-specs). The manifest's Ogg and WebM types
 * are left out because the composer refuses them.
 */
const SHARED_MEDIA_TYPES: ReadonlySet<string> = new Set(['audio/mpeg', 'audio/wav', 'video/mp4']);

/**
 * The type a shared file is kept under, or null to refuse it. Any page can
 * POST to /share, so an image is typed from its own bytes, and a declared
 * image type whose bytes are not a raster image (SVG included) is refused.
 * Audio and video keep the essence of their declared type (lowercased, without
 * parameters) only when it is one of `SHARED_MEDIA_TYPES`; Chromium hands the
 * part's type over with its case and parameters. HTML, XML and every other
 * type is refused.
 */
export async function sharedFileType(file: Blob): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, SHARED_FILE_HEAD_BYTES).arrayBuffer());
  const imageType = rasterImageMimeType(head);
  if (imageType) return imageType;
  const essence = file.type.split(';')[0].trim().toLowerCase();
  return SHARED_MEDIA_TYPES.has(essence) ? essence : null;
}

/**
 * Answers a Web Share Target POST to /share in the service worker. Text
 * params go into the redirect's query; files `sharedFileType` accepts are
 * cached under that type, and the rest are dropped before caching and
 * counted in `refusedFiles`.
 */
export async function handleShareTarget(request: Request, cacheStorage: CacheStorage): Promise<Response> {
  const formData = await request.formData();

  const title = formData.get('title')?.toString() ?? '';
  const text = formData.get('text')?.toString() ?? '';
  const url = formData.get('url')?.toString() ?? '';

  const files = formData.getAll('media').filter((entry): entry is File => entry instanceof File);
  let stored = 0;
  let refused = 0;

  if (files.length > 0) {
    const cache = await cacheStorage.open(SHARE_TARGET_CACHE);
    for (const key of await cache.keys()) {
      await cache.delete(key);
    }
    for (const file of files) {
      const type = await sharedFileType(file);
      if (!type) {
        refused += 1;
        continue;
      }
      const response = new Response(file, { headers: { 'Content-Type': type, 'X-Share-Filename': file.name } });
      await cache.put(`/share-target-file/${stored}`, response);
      stored += 1;
    }
  }

  const params = new URLSearchParams();
  if (title) params.set('title', title);
  if (text) params.set('text', text);
  if (url) params.set('url', url);
  if (stored > 0) params.set('hasFiles', 'true');
  if (refused > 0) params.set('refusedFiles', String(refused));

  const query = params.toString();
  return Response.redirect(new URL(`/share${query ? `?${query}` : ''}`, request.url).href, 303);
}

/**
 * Retrieve files that were cached by the service worker from a share target POST.
 * Each is checked again with `sharedFileType`, so an entry cached by an older
 * service worker is kept only if it passes. After retrieval, the cache is
 * cleared to avoid stale data.
 */
export async function getSharedFiles(): Promise<File[]> {
  try {
    const cache = await caches.open(SHARE_TARGET_CACHE);
    const keys = await cache.keys();

    if (keys.length === 0) return [];

    const files: File[] = [];

    for (const request of keys) {
      const response = await cache.match(request);
      if (!response) continue;

      const blob = await response.blob();
      const type = await sharedFileType(blob);
      if (!type) continue;
      const filename = response.headers.get('X-Share-Filename') || 'shared-file';

      files.push(new File([blob], filename, { type }));
    }

    // Clear the cache after retrieval
    await caches.delete(SHARE_TARGET_CACHE);

    return files;
  } catch {
    return [];
  }
}

/**
 * Compose post content from share target parameters.
 *
 * Handles common sharing patterns:
 * - Link shares: title + url (from browsers, "share page" actions)
 * - Text shares: text only (from note apps, selected text)
 * - Mixed shares: text + url (from social apps, "share via" with comment)
 */
export function composeShareContent(params: { title?: string; text?: string; url?: string }): string {
  const { title, text, url } = params;
  const parts: string[] = [];

  if (text) {
    parts.push(text);
  }

  // Append URL if it's not already contained in the text
  if (url && (!text || !text.includes(url))) {
    parts.push(url);
  }

  // If we only have a title (rare), use it as content
  if (parts.length === 0 && title) {
    parts.push(title);
  }

  return parts.join('\n\n');
}
