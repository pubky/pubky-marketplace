import { buildNexusUrl } from '@/services/nexus/nexus.utils';
import type { TStreamPostsByIdsParams } from '@/services/nexus/stream/posts/postStream.types';

export const postStreamApi = {
  postsByIds: (params: TStreamPostsByIdsParams) => {
    const body: TStreamPostsByIdsParams = {
      post_ids: params.post_ids,
      include_attachment_metadata: params.include_attachment_metadata ?? true,
    };

    if (params.viewer_id) {
      body.viewer_id = params.viewer_id;
    }

    return { body, url: buildNexusUrl('v0/stream/posts/by_ids') };
  },
};
