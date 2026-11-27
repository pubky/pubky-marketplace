import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompositeIdDomain, type Pubky } from '@/models/models.types';
import { buildCompositeId, buildCompositeIdFromPubkyUri } from '@/models/models.utils';
import { LocalFileService } from '@/services/local/file/file';
import { filesApi } from '@/services/nexus/file/file.api';
import type { NexusFileDetails } from '@/services/nexus/nexus.types';
import { asOpaque } from '@/test-utils/type-assertions';
import { FileApplication } from './file';

vi.mock('@/services/local/file/file', () => ({ LocalFileService: { createMany: vi.fn() } }));
vi.mock('@/services/nexus/file/file.api', () => ({ filesApi: { getAvatarUrl: vi.fn() } }));

const TEST_PUBKY = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rd0' as Pubky;
const TEST_TIMESTAMP = 1234567890;

const createMockFile = (
  id: string,
  name: string,
  uri: string,
  overrides?: Partial<NexusFileDetails>,
): NexusFileDetails => ({
  id,
  name,
  src: `src-${name}`,
  content_type: 'image/jpeg',
  size: 100,
  created_at: TEST_TIMESTAMP,
  indexed_at: TEST_TIMESTAMP,
  metadata: {},
  owner_id: TEST_PUBKY,
  uri,
  urls: { feed: '', main: '', small: '' },
  ...overrides,
});

const createFileUri = (fileId: string, pubky: Pubky = TEST_PUBKY) => `pubky://${pubky}/pub/pubky.app/files/${fileId}`;

const createMockUrls = (feed: string = 'feed', main: string = 'main', small: string = 'small') =>
  JSON.stringify({ feed, main, small });

beforeEach(() => vi.clearAllMocks());

describe('FileApplication', () => {
  describe('getAvatarUrl', () => {
    it('delegates to filesApi.getAvatarUrl', () => {
      const expectedUrl = 'https://cdn.example.com/avatar/encoded-pubky';

      vi.spyOn(filesApi, 'getAvatarUrl').mockReturnValue(expectedUrl);

      const result = FileApplication.getAvatarUrl(TEST_PUBKY);

      expect(filesApi.getAvatarUrl).toHaveBeenCalledWith(TEST_PUBKY, undefined);
      expect(result).toBe(expectedUrl);
    });
  });

  describe('persistFiles', () => {
    it.each([{ uri: undefined }, { uri: null }, { uri: 'invalid-file-uri' }, { urls: '{invalid json' }])(
      'stores the valid records when one has malformed metadata: %j',
      async (invalid) => {
        const valid = createMockFile('', 'valid.png', createFileUri('valid'));
        const malformed = asOpaque<NexusFileDetails>({ ...valid, ...invalid });
        const createManySpy = vi.spyOn(LocalFileService, 'createMany').mockResolvedValue(undefined);

        await FileApplication.persistFiles([malformed, valid]);

        expect(createManySpy).toHaveBeenCalledWith({
          files: [{ ...valid, id: buildCompositeId({ pubky: TEST_PUBKY, id: 'valid' }) }],
        });
      },
    );

    it('skips the write when no record is valid', async () => {
      const createManySpy = vi.spyOn(LocalFileService, 'createMany');

      await FileApplication.persistFiles([asOpaque<NexusFileDetails>({ uri: undefined })]);

      expect(createManySpy).not.toHaveBeenCalled();
    });

    it('returns early when fileAttachments is empty', async () => {
      const createManySpy = vi.spyOn(LocalFileService, 'createMany');

      await FileApplication.persistFiles([]);

      expect(createManySpy).not.toHaveBeenCalled();
    });

    it('handles urls as JSON string (from file details endpoint)', async () => {
      const fileId = 'file-123';
      const uri = createFileUri(fileId);
      const compositeId = buildCompositeIdFromPubkyUri({ uri, domain: CompositeIdDomain.FILES });

      const fileAttachments = [
        {
          ...createMockFile('', 'file1.jpg', uri),
          urls: createMockUrls('feed1', 'main1', 'small1'),
        },
      ];

      const createManySpy = vi.spyOn(LocalFileService, 'createMany').mockResolvedValue(undefined);

      await FileApplication.persistFiles(asOpaque<NexusFileDetails[]>(fileAttachments));

      expect(createManySpy).toHaveBeenCalledWith({
        files: [{ ...fileAttachments[0], id: compositeId, urls: { feed: 'feed1', main: 'main1', small: 'small1' } }],
      });
    });

    it('handles urls as parsed object (from inline attachments_metadata)', async () => {
      const fileId = 'file-456';
      const uri = createFileUri(fileId);
      const compositeId = buildCompositeIdFromPubkyUri({ uri, domain: CompositeIdDomain.FILES });

      const urlsObject = { feed: 'feed-url', main: 'main-url', small: 'small-url' };
      const fileAttachments: NexusFileDetails[] = [
        {
          ...createMockFile('', 'file2.png', uri),
          urls: urlsObject,
        },
      ];

      const createManySpy = vi.spyOn(LocalFileService, 'createMany').mockResolvedValue(undefined);

      await FileApplication.persistFiles(fileAttachments);

      expect(createManySpy).toHaveBeenCalledWith({
        files: [{ ...fileAttachments[0], id: compositeId, urls: urlsObject }],
      });
    });
  });
});
