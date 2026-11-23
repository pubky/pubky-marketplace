import { z } from 'zod';
import {
  USER_BIO_MAX_LENGTH,
  USER_LINK_LABEL_MAX_LENGTH,
  USER_LINK_URL_MAX_LENGTH,
  USER_MAX_LINKS,
  USER_NAME_MAX_LENGTH,
  USER_NAME_MIN_LENGTH,
  USER_STATUS_MAX_LENGTH,
} from '@/config/user';
import { getProfileImageFileOwner, isProfileImageBlobUri } from '@/libs/commerce/media-url';
import { getSafeExternalUrl } from '@/libs/utils/safeExternalUrl';
import type { Pubky } from '@/models/models.types';
import type { NexusUserDetails, NexusUserLink } from '@/services/nexus/nexus.types';

const text = z
  .unknown()
  .optional()
  .transform((value) => (typeof value === 'string' ? value.trim() : ''));

const linksSchema = z
  .unknown()
  .optional()
  .transform((value): NexusUserLink[] => {
    if (!Array.isArray(value)) return [];
    return value
      .flatMap((entry) => {
        const parsed = z.object({ title: text, url: text }).safeParse(entry);
        if (!parsed.success) return [];
        const { title, url } = parsed.data;
        const safeUrl = url.length <= USER_LINK_URL_MAX_LENGTH ? getSafeExternalUrl(url) : null;
        return title && title.length <= USER_LINK_LABEL_MAX_LENGTH && safeUrl ? [{ title, url: safeUrl }] : [];
      })
      .slice(0, USER_MAX_LINKS);
  });

const profileSchema = z.object({
  name: z.string().trim().min(USER_NAME_MIN_LENGTH).max(USER_NAME_MAX_LENGTH),
  bio: text,
  image: z.unknown().optional(),
  links: linksSchema,
  status: text,
});

/**
 * A Pubky App `profile.json` read from its owner's homeserver, in the shape the Nexus index serves,
 * or null when it is not a usable profile (no valid name). Optional fields that break the Pubky App
 * limits are dropped instead of failing the profile. `image` survives only as a file record of the
 * same user, and `indexed_at` is when the Shop read the record.
 */
export function userDetailsFromHomeserverProfile(
  json: unknown,
  userId: Pubky,
  readAt: number,
): NexusUserDetails | null {
  const parsed = profileSchema.safeParse(json);
  if (!parsed.success) return null;
  const { name, bio, image, links, status } = parsed.data;
  return {
    id: userId,
    name,
    bio: bio.slice(0, USER_BIO_MAX_LENGTH),
    links,
    status: status && status.length <= USER_STATUS_MAX_LENGTH ? status : null,
    image: typeof image === 'string' && getProfileImageFileOwner(image) === userId ? image : null,
    indexed_at: readAt,
  };
}

/**
 * Whether a profile read from its owner's homeserver is older than `ttlMs`. A store has no index
 * or TTL coordinator to keep cached profiles fresh, so it re-reads them past this age.
 */
export function isHomeserverProfileStale(details: NexusUserDetails, ttlMs: number, now: number): boolean {
  return now - details.indexed_at > ttlMs;
}

const fileRecordSchema = z.object({ src: z.string(), content_type: z.string() });

/** The blob a profile image file record of `owner` points at, or null unless it is an image blob of `owner`. */
export function profileImageBlobFromFileRecord(json: unknown, owner: string): string | null {
  const parsed = fileRecordSchema.safeParse(json);
  if (!parsed.success) return null;
  const { src, content_type: contentType } = parsed.data;
  return contentType.startsWith('image/') && isProfileImageBlobUri(src, owner) ? src : null;
}
