export const IMAGE_UPLOAD_SIZE_LIMIT_KINDS = ['raw', 'gif', 'animated-webp', 'svg', 'raster'] as const;

export type ImageUploadSizeLimitKind = (typeof IMAGE_UPLOAD_SIZE_LIMIT_KINDS)[number];

const IMAGE_UPLOAD_SIZE_LIMIT_MESSAGE_PREFIX = 'IMAGE_UPLOAD_SIZE_LIMIT:';

/**
 * Throws a plain Error whose message encodes the size-limit kind so callers can
 * map it to a toast message without coupling core to UI copy.
 */
export function throwImageUploadSizeLimit(kind: ImageUploadSizeLimitKind): never {
  throw new Error(`${IMAGE_UPLOAD_SIZE_LIMIT_MESSAGE_PREFIX}${kind}`);
}
