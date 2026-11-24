import { UserApplication } from '@/application/user/user';
import { getModerationId } from '@/config/moderation';
import { isAppError } from '@/libs/error/error.utils';
import { Logger } from '@/libs/logger/logger';
import type { Pubky } from '@/models/models.types';

export class BootstrapApplication {
  private static moderationFollowAbortController: AbortController | null = null;

  private constructor() {}

  /** Cancel detached moderation-follow work before account-local state changes ownership. */
  static cancelModerationFollow(): void {
    this.moderationFollowAbortController?.abort();
    this.moderationFollowAbortController = null;
  }

  /** The Shop starts its follow independently of sign-in. Each Market surface fetches the data it displays. */
  static async initialize({ pubky, signal }: { pubky: Pubky; signal?: AbortSignal }): Promise<void> {
    this.cancelModerationFollow();
    if (signal?.aborted) return;
    const controller = new AbortController();
    this.moderationFollowAbortController = controller;
    const followSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    void this.ensureModerationFollow(pubky, controller, followSignal);
  }

  /** Keep the one-time default follow off the authentication critical path. */
  private static async ensureModerationFollow(
    pubky: Pubky,
    controller: AbortController,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await UserApplication.ensureModerationFollow({
        follower: pubky,
        moderationId: getModerationId(),
        signal,
      });
    } catch (error) {
      // AppError factories already report at their origin. Only unexpected raw failures need a warning.
      if (!signal.aborted && !isAppError(error)) {
        Logger.warn('Unexpected moderation-follow bootstrap failure', { error });
      }
    } finally {
      if (this.moderationFollowAbortController === controller) this.moderationFollowAbortController = null;
    }
  }
}
