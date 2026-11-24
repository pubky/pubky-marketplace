import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { NexusFileDetails } from '@/services/nexus/nexus.types';
import { queryNexus } from '@/services/nexus/nexus.utils';
import { NexusFileService } from './file';
import type { TFileBody } from './file.types';

vi.mock('@/services/nexus/nexus.utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/nexus/nexus.utils')>();
  return {
    ...actual,
    queryNexus: vi.fn(),
  };
});

const mockQueryNexus = vi.mocked(queryNexus);

function createFile(uri: string): NexusFileDetails {
  return {
    id: uri,
    name: `${uri}.png`,
    src: uri,
    content_type: 'image/png',
    size: 1,
    created_at: 0,
    indexed_at: 0,
    metadata: {},
    owner_id: 'owner-id',
    uri,
    urls: { feed: uri, main: uri, small: uri },
  };
}

describe('NexusFileService.fetchFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test.each([
    { count: 0, chunkSizes: [] },
    { count: 1, chunkSizes: [1] },
    { count: 100, chunkSizes: [100] },
    { count: 101, chunkSizes: [100, 1] },
    { count: 250, chunkSizes: [100, 100, 50] },
  ])('fetches $count URIs in $chunkSizes.length requests', async ({ count, chunkSizes }) => {
    const fileUris = Array.from({ length: count }, (_, index) => `file-uri-${index}`);
    let offset = 0;
    const responses = chunkSizes.map((chunkSize) => {
      const response = fileUris.slice(offset, offset + chunkSize).map(createFile);
      offset += chunkSize;
      return response;
    });
    mockQueryNexus.mockResolvedValue([]);
    responses.forEach((response) => mockQueryNexus.mockResolvedValueOnce(response));

    const result = await NexusFileService.fetchFiles(fileUris);

    expect(mockQueryNexus).toHaveBeenCalledTimes(chunkSizes.length);
    expect(result).toEqual(responses.flat());
    const requests = mockQueryNexus.mock.calls.map(([params]) => params);
    requests.forEach((request) => {
      expect(request.url).toMatch(/v0\/files\/by_ids$/);
      expect(request.method).toBe('POST');
    });
    const bodies = requests.map((request) => JSON.parse(String(request.body)) as TFileBody);
    expect(bodies.map((body) => body.uris.length)).toEqual(chunkSizes);
    expect(bodies.every((body) => body.uris.length <= 100)).toBe(true);
    expect(bodies.flatMap((body) => body.uris)).toEqual(fileUris);
  });

  test('propagates a rejection from the second request without requesting later chunks', async () => {
    const fileUris = Array.from({ length: 250 }, (_, index) => `file-uri-${index}`);
    const error = new Error('File request failed');
    mockQueryNexus
      .mockResolvedValueOnce(fileUris.slice(0, 100).map(createFile))
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(fileUris.slice(200).map(createFile));

    await expect(NexusFileService.fetchFiles(fileUris)).rejects.toBe(error);
    expect(mockQueryNexus).toHaveBeenCalledTimes(2);
  });
});
