export const IMPORT_IMAGE_FAILURE_REASONS = [
  'invalid_url',
  'blocked_address',
  'dns_failed',
  'too_many_redirects',
  'http_error',
  'not_image',
  'too_large',
  'budget_exceeded',
  'timeout',
  'network',
  'rate_limited',
  'decode_failed',
  'upload_failed',
  'limit_reached',
  'cancelled',
] as const;

export type TImportImageFailureReason = (typeof IMPORT_IMAGE_FAILURE_REASONS)[number];

export const IMPORT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export type TImportImageMimeType = (typeof IMPORT_IMAGE_MIME_TYPES)[number];

/** One line of the import result CSV for an image: `url,status,reason`. */
export type TImportImageResultRow = {
  url: string;
  status: 'uploaded' | 'failed';
  reason?: TImportImageFailureReason;
};

export function isImportImageFailureReason(value: unknown): value is TImportImageFailureReason {
  return typeof value === 'string' && (IMPORT_IMAGE_FAILURE_REASONS as readonly string[]).includes(value);
}
