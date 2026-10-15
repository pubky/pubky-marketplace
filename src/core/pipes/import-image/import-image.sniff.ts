import type { TImportImageMimeType } from './import-image.types';

/** Bytes needed to tell every supported format apart. */
export const IMPORT_IMAGE_SNIFF_BYTES = 12;

/**
 * Identifies an image from its leading bytes, ignoring any declared
 * Content-Type. SVG (active content) and every non-raster format return null.
 */
export function sniffImageMimeType(head: Uint8Array): TImportImageMimeType | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';

  if (
    head.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => head[index] === byte)
  ) {
    return 'image/png';
  }

  if (
    head.length >= 6 &&
    startsWithAscii(head, 'GIF8', 0) &&
    (head[4] === 0x37 || head[4] === 0x39) &&
    head[5] === 0x61
  ) {
    return 'image/gif';
  }

  if (head.length >= 12 && startsWithAscii(head, 'RIFF', 0) && startsWithAscii(head, 'WEBP', 8)) return 'image/webp';

  return null;
}

function startsWithAscii(bytes: Uint8Array, text: string, offset: number): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}
