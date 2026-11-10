import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { fetchImageAsDataUri } from './ogData';

const PNG_DATA_URI_PREFIX = 'data:image/png;base64,';

async function transcodeImage(input: Buffer, contentType: string): Promise<Buffer> {
  const dataUri = await fetchImageAsDataUri(
    'https://cdn.test/image',
    async () => new Response(new Uint8Array(input), { headers: { 'Content-Type': contentType } }),
  );

  expect(dataUri).toMatch(/^data:image\/png;base64,/);
  return Buffer.from(dataUri?.slice(PNG_DATA_URI_PREFIX.length) ?? '', 'base64');
}

describe('fetchImageAsDataUri with native Sharp', () => {
  it('rasterizes a benign SVG and preserves its transparent background', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="6" height="4"><rect width="2" height="2" fill="red"/></svg>',
    );

    const png = await transcodeImage(svg, 'image/svg+xml');

    expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 6, height: 4, hasAlpha: true });
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    expect([...data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect(data[data.length - 1]).toBe(0);
  });

  it.each(['png', 'jpeg', 'webp'] as const)('decodes %s to PNG without enlarging a small image', async (format) => {
    const input = await sharp({
      create: { width: 4, height: 2, channels: 3, background: { r: 200, g: 40, b: 80 } },
    })
      .toFormat(format)
      .toBuffer();

    const png = await transcodeImage(input, `image/${format}`);

    expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 4, height: 2 });
  });

  it.each([
    { width: 2400, height: 600, expectedWidth: 1200, expectedHeight: 300 },
    { width: 600, height: 2400, expectedWidth: 300, expectedHeight: 1200 },
  ])('bounds a $width×$height image to a 1200px longest edge', async (dimensions) => {
    const input = await sharp({
      create: {
        width: dimensions.width,
        height: dimensions.height,
        channels: 3,
        background: { r: 200, g: 40, b: 80 },
      },
    })
      .png()
      .toBuffer();

    const png = await transcodeImage(input, 'image/png');

    expect(await sharp(png).metadata()).toMatchObject({
      format: 'png',
      width: dimensions.expectedWidth,
      height: dimensions.expectedHeight,
    });
  });

  it('returns null when the native decoder rejects corrupt image bytes', async () => {
    await expect(
      fetchImageAsDataUri(
        'https://cdn.test/corrupt.png',
        async () => new Response('not a valid image', { headers: { 'Content-Type': 'image/png' } }),
      ),
    ).resolves.toBeNull();
  });
});
