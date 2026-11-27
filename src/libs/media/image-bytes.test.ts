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

const ascii = (text: string) => new TextEncoder().encode(text);

/** An ISO-BMFF `ftyp` box: declared size, major brand, minor version 0, then compatible brands, then `trailing`. */
function ftypBox(size: number, major: string, compatible: readonly string[] = [], trailing = ''): Uint8Array {
  const body = ascii(`ftyp${major}\0\0\0\0${compatible.join('')}${trailing}`);
  const box = new Uint8Array(4 + body.length);
  new DataView(box.buffer).setUint32(0, size);
  box.set(body, 4);
  return box;
}

/** A complete 8 kHz mono 16-bit PCM WAV file holding 8 samples of silence. */
function wavFile(): Uint8Array {
  const samples = 8;
  const file = new Uint8Array(44 + samples * 2);
  const view = new DataView(file.buffer);
  file.set(ascii('RIFF'), 0);
  view.setUint32(4, file.length - 8, true);
  file.set(ascii('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  file.set(ascii('data'), 36);
  view.setUint32(40, samples * 2, true);
  return file;
}

/** A stream that hands over `bytes` in `parts` chunks. */
function chunkedBody(bytes: Uint8Array, parts: number): ReadableStream<Uint8Array> {
  const size = Math.ceil(bytes.length / parts);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
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

  it('types a real GIF87a image', async () => {
    const gif87a = (await encode('gif')).slice();
    gif87a.set(ascii('GIF87a'), 0);

    expect(await sharp(gif87a).metadata()).toMatchObject({ format: 'gif', width: 4, height: 3 });
    expect(rasterImageMimeType(gif87a)).toBe('image/gif');
  });

  it.each([
    ['only its major brand is avif', ftypBox(16, 'avif')],
    ['its major brand is avis', ftypBox(16, 'avis')],
    ['avis is only in the compatible list', ftypBox(20, 'mif1', ['avis'])],
  ])('types AVIF when %s', (_label, bytes) => {
    expect(rasterImageMimeType(bytes)).toBe('image/avif');
  });

  it.each([
    ['a JPEG start without its third byte', new Uint8Array([0xff, 0xd8, 0x00, 0xe0])],
    ['a JPEG start without its second byte', new Uint8Array([0xff, 0x00, 0xff, 0xe0])],
    ['a PNG start with only its first four bytes', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])],
    ['GIF89b', ascii('GIF89b')],
    ['GIF79a', ascii('GIF79a')],
    ['a real RIFF/WAVE file', wavFile()],
    ['RIFX with a WEBP fourcc', ascii('RIFX\0\0\0\0WEBPVP8 ')],
    ['an ftyp box whose avif brand is past the box end', ftypBox(16, 'mif1', [], 'avif')],
    ['an ftyp box smaller than its header', ftypBox(8, 'avif', ['avif'])],
    [
      'an avif box tagged ftyx instead of ftyp',
      ftypBox(24, 'avif', ['avif']).map((byte, i) => (i === 7 ? 0x78 : byte)),
    ],
    ['xxxxftypavif, too short for a box', ascii('xxxxftypavif')],
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
  it('reads a body whose declared length equals the cap', async () => {
    const bytes = new Uint8Array(MAX_BYTES).fill(3);
    const response = new Response(bytes, { headers: { 'content-length': String(MAX_BYTES) } });

    await expect(readBodyWithin(response, MAX_BYTES)).resolves.toEqual(bytes);
  });

  it('refuses a body one byte over the cap', async () => {
    await expect(readBodyWithin(respond(new Uint8Array(MAX_BYTES + 1)), MAX_BYTES)).resolves.toBeNull();
  });

  it('joins a body that arrives in several chunks', async () => {
    const png = await encode('png');

    const result = await readRasterImage(new Response(chunkedBody(png, 3)), MAX_BYTES);

    expect(result).toMatchObject({ ok: true, blob: { type: 'image/png' } });
    if (result.ok) expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(png);
  });

  it.each([
    [MAX_BYTES, MAX_BYTES],
    [MAX_BYTES + 1, null],
  ])('caps a %i-byte response that exposes no body stream', async (size, expected) => {
    const response = respond(new Uint8Array(size));
    Object.defineProperty(response, 'body', { value: null });

    const bytes = await readBodyWithin(response, MAX_BYTES);

    expect(bytes === null ? null : bytes.byteLength).toBe(expected);
  });

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
