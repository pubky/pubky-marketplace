/**
 * Turns image bytes the Shop did not produce into something safe to hand to
 * `URL.createObjectURL`: the body is read up to a cap, and the type comes only
 * from the bytes' own signature. A declared Content-Type is never read, so
 * SVG, HTML, XML, octet-stream and any unrecognized body has no type here.
 */

export type TRasterImageMimeType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'image/avif';

type TRasterImageResult = { ok: true; blob: Blob } | { ok: false; reason: 'too_large' | 'not_image' };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const AVIF_BRANDS = ['avif', 'avis'];
const FTYP_HEADER_BYTES = 16;
const FTYP_BRAND_BYTES = 4;

/** The raster type the bytes start with, or null for anything else. */
export function rasterImageMimeType(bytes: Uint8Array): TRasterImageMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return 'image/png';
  }
  if (bytes.length >= 6 && asciiAt(bytes, 'GIF8', 0) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return 'image/gif';
  }
  if (bytes.length >= 12 && asciiAt(bytes, 'RIFF', 0) && asciiAt(bytes, 'WEBP', 8)) return 'image/webp';
  if (isAvif(bytes)) return 'image/avif';
  return null;
}

/**
 * Reads a response body, or returns null once it passes `maxBytes`. A
 * declared Content-Length over the cap is refused before reading; the header
 * is not trusted otherwise, so the stream is counted as it arrives and
 * cancelled as soon as it passes the cap.
 */
export async function readBodyWithin(response: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength > maxBytes ? null : bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Reads a response body within `maxBytes` as a Blob typed from its bytes, or says why it cannot. */
export async function readRasterImage(response: Response, maxBytes: number): Promise<TRasterImageResult> {
  const bytes = await readBodyWithin(response, maxBytes);
  if (!bytes) return { ok: false, reason: 'too_large' };
  const type = rasterImageMimeType(bytes);
  if (!type) return { ok: false, reason: 'not_image' };
  return { ok: true, blob: new Blob([bytes], { type }) };
}

/** An ISO-BMFF `ftyp` box whose major or a compatible brand is AVIF. */
function isAvif(bytes: Uint8Array): boolean {
  if (bytes.length < FTYP_HEADER_BYTES || !asciiAt(bytes, 'ftyp', 4)) return false;
  const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  if (boxSize < FTYP_HEADER_BYTES) return false;
  const end = Math.min(boxSize, bytes.length);
  if (AVIF_BRANDS.some((brand) => asciiAt(bytes, brand, 8))) return true;
  for (let offset = FTYP_HEADER_BYTES; offset + FTYP_BRAND_BYTES <= end; offset += FTYP_BRAND_BYTES) {
    if (AVIF_BRANDS.some((brand) => asciiAt(bytes, brand, offset))) return true;
  }
  return false;
}

function asciiAt(bytes: Uint8Array, text: string, offset: number): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}
