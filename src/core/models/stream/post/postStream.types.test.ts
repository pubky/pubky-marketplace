import { describe, expect, it } from 'vitest';
import type { Pubky } from '@/models/models.types';
import { buildPostReplyStreamId } from '@/models/stream/post/postStream.types';
import { StreamSource } from '@/services/nexus/stream/posts/postStream.types';

const TEST_PUBKY = 'erztyis9oiaho93ckucetcf5xnxacecqwhbst5hnd7mmkf69dhby' as Pubky;
const TEST_POST_ID = 'post-pubky-id';

describe('post-stream id builders', () => {
  describe('buildPostReplyStreamId', () => {
    it('produces post_replies:<compositeId>', () => {
      expect(buildPostReplyStreamId(`${TEST_PUBKY}:${TEST_POST_ID}`)).toBe(
        `${StreamSource.REPLIES}:${TEST_PUBKY}:${TEST_POST_ID}`,
      );
    });
  });
});
