'use client';

import { useMemo } from 'react';
import { isStoreMode } from '@/config/store-mode';
import { FileController } from '@/controllers/file/file';
import { useProfileImageUrl } from '@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl';
import type { NexusUserDetails } from '@/services/nexus/nexus.types';

/**
 * Hook to compute avatar URL from user details.
 * Returns undefined if user has no image.
 *
 * The full Market serves avatars from the Nexus CDN. A store reads no CDN, so it resolves the
 * profile's image file record on the user's own homeserver instead, and returns undefined until that
 * read settles.
 *
 * @param userDetails - User details object (can be null/undefined)
 * @param version - Optional CDN cache-busting version (e.g. `userDetails.indexed_at`)
 * @returns Avatar URL string or undefined
 *
 * @example
 * ```tsx
 * const { userDetails } = useUserDetails(userId);
 * const avatarUrl = useAvatarUrl(userDetails);
 * return <Avatar src={avatarUrl} />;
 * ```
 */
export function useAvatarUrl(
  userDetails: NexusUserDetails | null | undefined,
  version?: string | number,
): string | undefined {
  const storeMode = isStoreMode();
  const homeserverAvatarUrl = useProfileImageUrl(storeMode ? userDetails?.image : null);
  const cdnAvatarUrl = useMemo(() => {
    if (storeMode || !userDetails?.image) return undefined;
    return FileController.getAvatarUrl(userDetails.id, version);
  }, [storeMode, userDetails, version]);
  return storeMode ? (homeserverAvatarUrl ?? undefined) : cdnAvatarUrl;
}
