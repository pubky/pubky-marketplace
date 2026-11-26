import { describe, expect, it } from 'vitest';
import { FileVariant } from '@/services/nexus/file/file.types';
import { resolveFileVariant, supportsResizedVariants } from './fileVariant';

describe('supportsResizedVariants', () => {
  it.each(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])('supports %s', (contentType) => {
    expect(supportsResizedVariants(contentType)).toBe(true);
  });

  it.each(['IMAGE/JPEG', 'Image/WebP', 'image/png; charset=binary', ' image/jpeg ;q=1'])(
    'normalizes %s',
    (contentType) => {
      expect(supportsResizedVariants(contentType)).toBe(true);
    },
  );

  it.each([
    'image/svg+xml',
    'image/bmp',
    'image/heic',
    'video/mp4',
    'application/pdf',
    '',
    undefined,
    null,
    'image/',
    'imagepng',
    'image/svg+xml; charset=utf-8',
  ])('does not support %s', (contentType) => {
    expect(supportsResizedVariants(contentType)).toBe(false);
  });
});

describe('resolveFileVariant', () => {
  it.each([FileVariant.FEED, FileVariant.SMALL])('maps %s to main for SVG', (requested) => {
    expect(resolveFileVariant('image/svg+xml', requested)).toBe(FileVariant.MAIN);
  });

  it.each([FileVariant.FEED, FileVariant.SMALL])('maps %s to main for an unknown type', (requested) => {
    expect(resolveFileVariant('image/heic', requested)).toBe(FileVariant.MAIN);
  });

  it.each([FileVariant.FEED, FileVariant.SMALL])('keeps %s for raster images', (requested) => {
    expect(resolveFileVariant('image/png', requested)).toBe(requested);
  });

  it.each(['image/svg+xml', 'image/heic', 'image/png'])('keeps main for %s', (contentType) => {
    expect(resolveFileVariant(contentType, FileVariant.MAIN)).toBe(FileVariant.MAIN);
  });
});
