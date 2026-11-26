import { FileVariant } from '@/services/nexus/file/file.types';

const RESIZED_VARIANT_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** Nexus builds feed and small variants only for JPEG, PNG, GIF, and WebP images. */
export function supportsResizedVariants(contentType: string | null | undefined): boolean {
  const normalizedContentType = contentType?.split(';', 1)[0].trim().toLowerCase();
  return normalizedContentType ? RESIZED_VARIANT_CONTENT_TYPES.has(normalizedContentType) : false;
}

/** Keeps main for unsupported content types, whose feed and small URLs are not available. */
export function resolveFileVariant(contentType: string | null | undefined, requested: FileVariant): FileVariant {
  return requested === FileVariant.MAIN || supportsResizedVariants(contentType) ? requested : FileVariant.MAIN;
}
