import { describe, expect, it } from 'vitest';
import { getCdnUrl } from '@/config/nexus';
import { filesApi } from './file.api';
import { FileVariant, type TFileParams } from './file.types';

const pubky = 'qr3xqyz3e5cyf9npgxc5zfp15ehhcis6gqsxob4une7bwwazekry';
const encodedPubky = encodeURIComponent(pubky);
const fileId = 'test-file';
const encodedFileId = encodeURIComponent(fileId);

describe('File API', () => {
  describe('filesApi.getAvatarUrl', () => {
    it('should generate correct avatar URL for valid pubky', () => {
      const result = filesApi.getAvatarUrl(pubky);
      expect(result).toBe(`${getCdnUrl()}/avatar/${encodedPubky}`);
    });

    it('should append version query param when provided', () => {
      const version = 12345;
      const result = filesApi.getAvatarUrl(pubky, version);
      expect(result).toBe(`${getCdnUrl()}/avatar/${encodedPubky}?v=${version}`);
    });
  });

  describe('filesApi.getFileUrl', () => {
    it('should generate correct URL for SMALL variant', () => {
      const params: TFileParams = {
        pubky,
        file_id: fileId,
        variant: FileVariant.SMALL,
      };

      const result = filesApi.getFileUrl(params);
      expect(result).toBe(`${getCdnUrl()}/files/${encodedPubky}/${encodedFileId}/small`);
    });

    it('should generate correct URL for FEED variant', () => {
      const params: TFileParams = {
        pubky,
        file_id: fileId,
        variant: FileVariant.FEED,
      };

      const result = filesApi.getFileUrl(params);
      expect(result).toBe(`${getCdnUrl()}/files/${encodedPubky}/${encodedFileId}/feed`);
    });

    it('should generate correct URL for MAIN variant', () => {
      const params: TFileParams = {
        pubky,
        file_id: fileId,
        variant: FileVariant.MAIN,
      };

      const result = filesApi.getFileUrl(params);
      expect(result).toBe(`${getCdnUrl()}/files/${encodedPubky}/${encodedFileId}/main`);
    });
  });
});
