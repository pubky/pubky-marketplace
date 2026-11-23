import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { rasterImageMimeType, readBodyWithin, readRasterImage, type TRasterImageMimeType } from './image-bytes';

const MAX_BYTES = 64 * 1024;
const CHUNK_BYTES = 16 * 1024;

type TEncodedFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'avif';

const RASTER_FORMATS: readonly [TEncodedFormat, TRasterImageMimeType][] = [
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['avif', 'image/avif'],
];

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" onload="document.title=1"><rect width="1" height="1"/></svg>';
const HTML = '<!doctype html><html><body><script>document.title = 1</script></body></html>';

async function encode(format: TEncodedFormat): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await sharp({ create: { width: 4, height: 3, channels: 3, background: { r: 200, g: 40, b: 10 } } })
    .toFormat(format)
    .toBuffer();
  return new Uint8Array(buffer);
}

function respond(body: BodyInit | null, contentType?: string): Response {
  return new Response(body, { headers: contentType ? { 'content-type': contentType } : {} });
}

/** A body that never ends, counting what the reader pulled and whether it cancelled. */
function endlessBody() {
  const state = { pulledBytes: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulledBytes += CHUNK_BYTES;
        controller.enqueue(new Uint8Array(CHUNK_BYTES));
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
}

describe('rasterImageMimeType', () => {
  it.each(RASTER_FORMATS)('types a real %s image from its bytes', async (format, mimeType) => {
    expect(rasterImageMimeType(await encode(format))).toBe(mimeType);
  });

  it('types AVIF when the brand is only in the compatible list', async () => {
    const avif = await encode('avif');
    const mif1Major = avif.slice();
    mif1Major.set(new TextEncoder().encode('mif1'), 8);

    expect(new TextDecoder().decode(avif.subarray(16, 28))).toContain('avif');
    expect(rasterImageMimeType(mif1Major)).toBe('image/avif');
  });

  it.each([
    ['SVG', new TextEncoder().encode(SVG)],
    ['SVG behind an XML declaration', new TextEncoder().encode(`<?xml version="1.0"?>${SVG}`)],
    ['HTML', new TextEncoder().encode(HTML)],
    ['XML', new TextEncoder().encode('<?xml version="1.0"?><root/>')],
    ['an MP4 file type box', new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode('ftypisom'), 0, 0, 2, 0])],
    ['an empty body', new Uint8Array()],
    ['a truncated PNG signature', new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
  ])('has no type for %s', (_label, bytes) => {
    expect(rasterImageMimeType(bytes)).toBeNull();
  });
});

describe('readRasterImage', () => {
  it.each(RASTER_FORMATS)(
    'returns a real %s image typed from its bytes, whatever was declared',
    async (format, type) => {
      const bytes = await encode(format);

      const result = await readRasterImage(respond(bytes, 'text/html'), MAX_BYTES);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.blob.type).toBe(type);
      expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(bytes);
    },
  );

  it('accepts a valid PNG declared as text/html as image/png', async () => {
    const result = await readRasterImage(respond(await encode('png'), 'text/html'), MAX_BYTES);

    expect(result).toMatchObject({ ok: true, blob: { type: 'image/png' } });
  });

  it.each([
    ['image/png,text/html', HTML],
    ['image/x,image/svg+xml', SVG],
    ['image/svg+xml', SVG],
    ['image/svg+xml;charset=utf-8', SVG],
    ['text/html', HTML],
    ['image/png', SVG],
    ['application/octet-stream', HTML],
    ['application/xml', '<?xml version="1.0"?><root/>'],
  ])('refuses a body declared as %s that is not a raster image', async (contentType, body) => {
    await expect(readRasterImage(respond(body, contentType), MAX_BYTES)).resolves.toEqual({
      ok: false,
      reason: 'not_image',
    });
  });

  it('refuses an image over the cap', async () => {
    const bytes = await encode('png');

    await expect(readRasterImage(respond(bytes), bytes.byteLength - 1)).resolves.toEqual({
      ok: false,
      reason: 'too_large',
    });
  });
});

describe('readBodyWithin', () => {
  it('returns a body of exactly the cap', async () => {
    const bytes = new Uint8Array(MAX_BYTES).fill(7);

    await expect(readBodyWithin(respond(bytes), MAX_BYTES)).resolves.toEqual(bytes);
  });

  it('stops an endless body at the first chunk past the cap and cancels it', async () => {
    const { stream, state } = endlessBody();

    await expect(readBodyWithin(new Response(stream), MAX_BYTES)).resolves.toBeNull();

    expect(state.cancelled).toBe(true);
    expect(state.pulledBytes).toBe(MAX_BYTES + CHUNK_BYTES);
  });

  it('does not trust a Content-Length under the cap', async () => {
    const { stream, state } = endlessBody();
    const response = new Response(stream, { headers: { 'content-length': '10' } });

    await expect(readBodyWithin(response, MAX_BYTES)).resolves.toBeNull();

    expect(state.cancelled).toBe(true);
    expect(state.pulledBytes).toBe(MAX_BYTES + CHUNK_BYTES);
  });

  it('refuses a declared Content-Length over the cap without reading the body', async () => {
    const { stream, state } = endlessBody();
    const response = new Response(stream, { headers: { 'content-length': String(MAX_BYTES + 1) } });

    await expect(readBodyWithin(response, MAX_BYTES)).resolves.toBeNull();

    expect(state.pulledBytes).toBe(0);
    expect(state.cancelled).toBe(true);
  });
});
