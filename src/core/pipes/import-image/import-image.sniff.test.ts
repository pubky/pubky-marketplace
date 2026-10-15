import { describe, expect, it } from 'vitest';
import { sniffImageMimeType } from './import-image.sniff';

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

describe('sniffImageMimeType', () => {
  it.each([
    ['jpeg', [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0], 'image/jpeg'],
    ['png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0], 'image/png'],
    ['gif89a', [...ascii('GIF89a'), 0, 0, 0, 0, 0, 0], 'image/gif'],
    ['gif87a', [...ascii('GIF87a'), 0, 0, 0, 0, 0, 0], 'image/gif'],
    ['webp', [...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBP')], 'image/webp'],
  ])('recognises %s from bytes', (_name, bytes, expected) => {
    expect(sniffImageMimeType(new Uint8Array(bytes))).toBe(expected);
  });

  it.each([
    ['html', ascii('<!DOCTYPE html>')],
    ['svg', ascii('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['xml prolog svg', ascii('<?xml version="1.0"?><svg/>')],
    ['pdf', ascii('%PDF-1.7 trailing')],
    ['wav (RIFF but not WEBP)', [...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVE')]],
    ['truncated png', [0x89, 0x50, 0x4e]],
    ['empty', []],
  ])('rejects %s', (_name, bytes) => {
    expect(sniffImageMimeType(new Uint8Array(bytes))).toBeNull();
  });
});
