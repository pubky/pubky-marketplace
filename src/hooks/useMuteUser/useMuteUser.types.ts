import type { Pubky } from '@/models/models.types';

export interface UseMuteUserResult {
  /** Toggles mute status for a user */
  toggleMute: (userId: Pubky, isCurrentlyMuted: boolean) => Promise<void>;
  /** Whether a mute/unmute action is in progress */
  isLoading: boolean;
  /** Helper to check if a specific user is loading */
  isUserLoading: (userId: Pubky) => boolean;
}
