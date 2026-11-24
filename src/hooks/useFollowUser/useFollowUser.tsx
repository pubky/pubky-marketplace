'use client';

import { useCallback, useState } from 'react';
import { getProfileRoute, PROFILE_ROUTES } from '@/app/routes';
import { getSocialHostUrl } from '@/config/social';
import { UserController } from '@/controllers/user/user';
import { isAppError } from '@/libs/error/error.utils';
import { HttpMethod } from '@/libs/http/http.types';
import { Logger } from '@/libs/logger/logger';
import type { Pubky } from '@/models/models.types';
import { toast } from '@/molecules/Toaster/toast';
import { useAuthStore } from '@/stores/auth/auth.store';
import type { UseFollowUserResult } from './useFollowUser.types';
import { resolveFollowToastDisplayName } from './useFollowUser.utils';

/**
 * useFollowUser
 *
 * Hook for following/unfollowing users.
 * Handles the follow action through the UserController, which manages
 * local database updates and homeserver sync.
 *
 * @returns Follow action handler, loading state, and error state
 *
 * @example
 * ```tsx
 * const { toggleFollow, isLoading, isUserLoading, error } = useFollowUser();
 *
 * const handleFollow = async (userId: Pubky, isFollowing: boolean, displayName: string) => {
 *   await toggleFollow(userId, isFollowing, displayName);
 * };
 *
 * // Check if a specific user is loading
 * const showSpinner = isUserLoading(userId);
 * ```
 */
export function useFollowUser(): UseFollowUserResult {
  const { currentUserPubky } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<UseFollowUserResult['loadingAction']>(null);
  const [loadingUserId, setLoadingUserId] = useState<Pubky | null>(null);
  const [, setError] = useState<string | null>(null);

  const toggleFollow = useCallback(
    async (userId: Pubky, isCurrentlyFollowing: boolean, displayName?: string) => {
      if (!currentUserPubky) {
        setError('User not authenticated');
        return false;
      }

      if (userId === currentUserPubky) {
        setError('Cannot follow yourself');
        return false;
      }

      setLoadingAction(isCurrentlyFollowing ? 'unfollow' : 'follow');
      setIsLoading(true);
      setLoadingUserId(userId);
      setError(null);

      // Resolved up front so the failure toast can name the user too.
      const username = await resolveFollowToastDisplayName(userId, displayName);

      try {
        const action = isCurrentlyFollowing ? HttpMethod.DELETE : HttpMethod.PUT;

        await UserController.commitFollow(action, {
          follower: currentUserPubky,
          followee: userId,
        });

        toast({
          title: isCurrentlyFollowing ? `Unfollowed ${username}` : `Following ${username}`,
        });

        Logger.debug(`[useFollowUser] Successfully ${isCurrentlyFollowing ? 'unfollowed' : 'followed'} user`, {
          userId,
        });

        return true;
      } catch (err) {
        if (isAppError(err) && err.operation === 'socialWrite') {
          toast({
            variant: 'info',
            description: err.message,
            action: {
              label: 'Open Pubky App',
              altText: 'Open this profile in Pubky App',
              onClick: () =>
                window.open(
                  getSocialHostUrl(getProfileRoute(PROFILE_ROUTES.PROFILE, userId)),
                  '_blank',
                  'noopener,noreferrer',
                ),
            },
          });
          return false;
        }
        if (err instanceof DOMException && err.name === 'AbortError') return false;
        // Always a friendly, named message — raw transport/server text never reaches the user.
        const message = isCurrentlyFollowing ? `Failed to unfollow ${username}` : `Failed to follow ${username}`;
        setError(message);
        toast({
          variant: 'error',
          description: message,
        });
        Logger.error('[useFollowUser] Failed to toggle follow:', err);
        return false;
      } finally {
        setIsLoading(false);
        setLoadingAction(null);
        setLoadingUserId(null);
      }
    },
    [currentUserPubky],
  );

  const isUserLoading = useCallback(
    (userId: Pubky) => isLoading && loadingUserId === userId,
    [isLoading, loadingUserId],
  );

  return {
    toggleFollow,
    isLoading,
    loadingAction,
    isUserLoading,
  };
}
