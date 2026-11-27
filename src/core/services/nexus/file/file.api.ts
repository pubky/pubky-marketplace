import type { Pubky } from '@/models/models.types';
import type { TFileParams } from '@/services/nexus/file/file.types';
import { buildCdnUrl, encodePathSegment } from '@/services/nexus/nexus.utils';

const STATIC_PREFIX = 'files';

export const filesApi = {
  getAvatarUrl: (pubky: Pubky, version?: string | number) => {
    const encodedPubky = encodePathSegment(pubky);
    const url = buildCdnUrl(`avatar/${encodedPubky}`);
    return version ? `${url}?v=${version}` : url;
  },
  getFileUrl: ({ pubky, file_id, variant }: TFileParams) => {
    const encodedPubky = encodePathSegment(pubky);
    const encodedFileId = encodePathSegment(file_id);
    return buildCdnUrl(`${STATIC_PREFIX}/${encodedPubky}/${encodedFileId}/${variant}`);
  },
};
