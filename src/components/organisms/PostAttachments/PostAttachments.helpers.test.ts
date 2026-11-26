import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileController } from '@/controllers/file/file';
import { FileVariant } from '@/services/nexus/file/file.types';
import { categorizeAttachments, splitAttachmentsByMediaType } from './PostAttachments.helpers';
import type { AttachmentConstructed } from './PostAttachments.types';

vi.mock('@/controllers/file/file', () => ({
  FileController: { getFileUrl: vi.fn() },
}));

const mockGetFileUrl = vi.mocked(FileController.getFileUrl);

const meta = (id: string, content_type: string) =>
  ({ id, name: `${id}.bin`, content_type }) as Parameters<typeof splitAttachmentsByMediaType>[0][number];

describe('categorizeAttachments', () => {
  it('buckets attachments by media type', () => {
    const attachments: AttachmentConstructed[] = [
      { type: 'image/png', name: 'a', urls: { main: 'm' } },
      { type: 'video/mp4', name: 'b', urls: { main: 'm' } },
      { type: 'audio/mpeg', name: 'c', urls: { main: 'm' } },
      { type: 'application/pdf', name: 'd', urls: { main: 'm' } },
    ];

    const result = categorizeAttachments(attachments);

    expect(result.imagesAndVideos.map((a) => a.name)).toEqual(['a', 'b']);
    expect(result.audios.map((a) => a.name)).toEqual(['c']);
    expect(result.genericFiles.map((a) => a.name)).toEqual(['d']);
  });
});

describe('splitAttachmentsByMediaType', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFileUrl.mockImplementation(({ fileId, variant }) => `${fileId}/${variant}`);
  });

  it('sets the feed URL for PNG images', () => {
    const { imagesAndVideos } = splitAttachmentsByMediaType([meta('img', 'image/png')]);

    expect(imagesAndVideos[0].urls.feed).toBe(`img/${FileVariant.FEED}`);
    expect(imagesAndVideos[0].urls.main).toBe(`img/${FileVariant.MAIN}`);
  });

  it('sets the feed URL for JPEG content types with parameters', () => {
    const { imagesAndVideos } = splitAttachmentsByMediaType([meta('img', 'image/JPEG; charset=binary')]);

    expect(imagesAndVideos[0].urls.feed).toBe(`img/${FileVariant.FEED}`);
  });

  it('uses main only for SVG images', () => {
    const { imagesAndVideos } = splitAttachmentsByMediaType([meta('svg', 'image/svg+xml')]);

    expect(imagesAndVideos[0].urls.feed).toBeUndefined();
    expect(imagesAndVideos[0].urls.main).toBe(`svg/${FileVariant.MAIN}`);
  });

  it('ignores a stored feed URL for SVG images', () => {
    const svg = {
      ...meta('svg', 'image/svg+xml'),
      urls: { main: 'stored/main', feed: 'stored/feed', small: 'stored/small' },
    };
    const { imagesAndVideos } = splitAttachmentsByMediaType([svg]);

    expect(imagesAndVideos[0].urls.feed).toBeUndefined();
    expect(imagesAndVideos[0].urls.main).toBe(`svg/${FileVariant.MAIN}`);
  });

  it('does not set a feed URL for videos', () => {
    const { imagesAndVideos } = splitAttachmentsByMediaType([meta('vid', 'video/mp4')]);

    expect(imagesAndVideos[0].urls.feed).toBeUndefined();
    expect(imagesAndVideos[0].urls.main).toBe(`vid/${FileVariant.MAIN}`);
  });
});
