import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { IMPORT_IMAGE_MAX_RETRY_WAIT_SECONDS } from '@/config/import-image';
import { type CommerceListingRecord, commerceMediaSchema } from '@/libs/commerce/marketplace-records';
import { stripImageMetadata } from '@/libs/image/stripImageMetadata';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
import { sniffImageMimeType } from '@/pipes/import-image/import-image.sniff';
import type { TImportImageFailureReason } from '@/pipes/import-image/import-image.types';
import { ImportImageApiService } from '@/services/import-image/import-image.api';

export type TImportImageMedia = CommerceListingRecord['media'][number];

export type TImportImagePrepareParams = {
  ownerPubky: string;
  url: string;
  altText: string;
  remainingBytes: number;
  signal?: AbortSignal;
};

export type TImportImagePrepareResult =
  | { ok: true; media: TImportImageMedia; bytes: Uint8Array; fetchedBytes: number }
  | { ok: false; reason: TImportImageFailureReason; fetchedBytes: number };

/**
 * Browser half of the import-image flow: asks the server route for the bytes,
 * re-checks them, then sanitizes and describes them like any listing photo so
 * the existing media write (`CommerceController.commitCreateMedia`) can store them.
 */
export class ImportImageUploadApplication {
  private constructor() {}

  static async fetchAndPrepare({
    ownerPubky,
    url,
    altText,
    remainingBytes,
    signal,
  }: TImportImagePrepareParams): Promise<TImportImagePrepareResult> {
    let fetched = await ImportImageApiService.fetchImage({ url, remainingBytes, signal });

    if (!fetched.ok && fetched.reason === 'rate_limited' && fetched.retryAfterSeconds !== undefined) {
      if (fetched.retryAfterSeconds > IMPORT_IMAGE_MAX_RETRY_WAIT_SECONDS) {
        return { ok: false, reason: 'rate_limited', fetchedBytes: 0 };
      }
      if (!(await sleep(fetched.retryAfterSeconds * 1000, signal))) {
        return { ok: false, reason: 'cancelled', fetchedBytes: 0 };
      }
      fetched = await ImportImageApiService.fetchImage({ url, remainingBytes, signal });
    }

    if (!fetched.ok) return { ok: false, reason: fetched.reason, fetchedBytes: 0 };

    const fetchedBytes = fetched.bytes.byteLength;
    if (fetchedBytes > remainingBytes) return { ok: false, reason: 'budget_exceeded', fetchedBytes };

    const mimeType = sniffImageMimeType(fetched.bytes);
    if (!mimeType) return { ok: false, reason: 'not_image', fetchedBytes };

    try {
      const sanitized = await stripImageMetadata(
        new File([fetched.bytes as BlobPart], 'import-image', { type: mimeType }),
      );
      const bytes = new Uint8Array(await sanitized.arrayBuffer());
      const bitmap = await createImageBitmap(sanitized);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();

      const mediaId = crypto.randomUUID().replaceAll('-', '');
      const media = commerceMediaSchema.parse({
        id: mediaId,
        type: 'image',
        url: CommerceRecordNormalizer.mediaUri(ownerPubky, mediaId),
        contentHash: bytesToHex(blake3(bytes)),
        mimeType: sanitized.type,
        byteSize: bytes.byteLength,
        width: dimensions.width,
        height: dimensions.height,
        altText,
      });
      return { ok: true, media, bytes, fetchedBytes };
    } catch {
      return { ok: false, reason: 'decode_failed', fetchedBytes };
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
