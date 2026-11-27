import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase } from '@/database/franky/franky.helpers';
import { DatabaseErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { FileDetailsModel } from '@/models/file/fileDetails';
import type { Pubky } from '@/models/models.types';
import { buildCompositeId } from '@/models/models.utils';
import type { NexusFileDetails } from '@/services/nexus/nexus.types';
import { LocalFileService } from './file';

describe('LocalFileService', () => {
  const testPubky: Pubky = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rd0';
  const testFileId1 = 'file-test-1';
  const testFileId2 = 'file-test-2';
  const compositeId1 = buildCompositeId({ pubky: testPubky, id: testFileId1 });
  const compositeId2 = buildCompositeId({ pubky: testPubky, id: testFileId2 });

  const createMockFile = (fileId: string, overrides?: Partial<NexusFileDetails>): NexusFileDetails => ({
    id: buildCompositeId({ pubky: testPubky, id: fileId }),
    name: `test-file-${fileId}.jpg`,
    src: `https://example.com/files/${fileId}`,
    content_type: 'image/jpeg',
    size: 102400,
    created_at: 1234567890,
    indexed_at: 1234567890,
    metadata: {},
    owner_id: testPubky,
    uri: `pubky://${testPubky}/pub/pubky.app/files/${fileId}`,
    urls: {
      feed: `https://example.com/files/${fileId}-feed.jpg`,
      main: `https://example.com/files/${fileId}-main.jpg`,
      small: `https://example.com/files/${fileId}-small.jpg`,
    },
    ...overrides,
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  describe('createMany', () => {
    it('saves multiple files', async () => {
      const file1 = createMockFile(testFileId1);
      const file2 = createMockFile(testFileId2);
      await LocalFileService.createMany({ files: [file1, file2] });

      const [saved1, saved2] = await Promise.all([
        FileDetailsModel.findById(compositeId1),
        FileDetailsModel.findById(compositeId2),
      ]);

      expect(saved1?.name).toBe(file1.name);
      expect(saved2?.name).toBe(file2.name);
    });

    it('saves single file', async () => {
      const file = createMockFile(testFileId1);
      await LocalFileService.createMany({ files: [file] });

      const saved = await FileDetailsModel.findById(compositeId1);
      expect(saved?.name).toBe(file.name);
      expect(saved?.content_type).toBe(file.content_type);
    });

    it('handles empty array', async () => {
      await expect(LocalFileService.createMany({ files: [] })).resolves.not.toThrow();
      expect(await FileDetailsModel.table.toArray()).toHaveLength(0);
    });

    it('updates existing files', async () => {
      await LocalFileService.createMany({ files: [createMockFile(testFileId1, { name: 'original.jpg' })] });
      await LocalFileService.createMany({
        files: [createMockFile(testFileId1, { name: 'updated.jpg', size: 204800 })],
      });

      const saved = await FileDetailsModel.findById(compositeId1);
      expect(saved?.name).toBe('updated.jpg');
      expect(saved?.size).toBe(204800);
    });

    it('saves all file properties', async () => {
      const file = createMockFile(testFileId1, {
        content_type: 'image/png',
        size: 204800,
        metadata: { width: '1920', height: '1080' },
      });
      await LocalFileService.createMany({ files: [file] });

      const saved = await FileDetailsModel.findById(compositeId1);
      expect(saved?.content_type).toBe('image/png');
      expect(saved?.size).toBe(204800);
      expect(saved?.metadata).toEqual({ width: '1920', height: '1080' });
    });

    it('propagates database error when bulkSave fails', async () => {
      const file = createMockFile(testFileId1);
      const databaseError = Err.database(
        DatabaseErrorCode.WRITE_FAILED,
        'Failed to bulk save records in file_details',
        {
          service: ErrorService.Local,
          operation: 'bulkSave',
          context: { rowsCount: 1 },
        },
      );

      vi.spyOn(FileDetailsModel, 'bulkSave').mockRejectedValueOnce(databaseError);

      await expect(LocalFileService.createMany({ files: [file] })).rejects.toMatchObject({
        category: ErrorCategory.Database,
        code: DatabaseErrorCode.WRITE_FAILED,
        message: 'Failed to bulk save records in file_details',
      });
    });

    it('propagates generic error when bulkSave throws', async () => {
      const file = createMockFile(testFileId1);
      const error = new Error('Unexpected database error');

      vi.spyOn(FileDetailsModel, 'bulkSave').mockRejectedValueOnce(error);

      await expect(LocalFileService.createMany({ files: [file] })).rejects.toThrow('Unexpected database error');
    });
  });
});
