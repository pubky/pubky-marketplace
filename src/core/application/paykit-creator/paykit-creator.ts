import type { TPaykitCreatorLookupParams } from '@/application/paykit-creator/paykit-creator.types';
import { RateLimitErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { NextJsPaykitCreatorService } from '@/services/nextjs/paykit-creator/paykit-creator';
import { PaykitCreatorRateLimiter } from '@/services/nextjs/paykit-creator/paykit-creator.rate-limit';

/** Whether the Paykit Server already holds a creator. */
export class PaykitCreatorApplication {
  private constructor() {}

  /**
   * Counts the lookup against each of the caller's limiter keys, then asks.
   *
   * @returns `true` when Paykit holds the creator (so only a reconnect can set it up again), `false`
   * when it does not.
   * @throws AppError (rate limit, with `retryAfter`) when the caller is out of lookups, or when Paykit
   * cannot answer.
   */
  static async isCreatorHeld({ creator, rateLimitKeys }: TPaykitCreatorLookupParams): Promise<boolean> {
    for (const key of rateLimitKeys) {
      const decision = PaykitCreatorRateLimiter.admit(key);
      if (!decision.ok) {
        throw Err.rateLimit(RateLimitErrorCode.RATE_LIMITED, 'Too many creator lookups', {
          service: ErrorService.Local,
          operation: 'PaykitCreatorApplication.isCreatorHeld',
          context: { retryAfter: decision.retryAfterSeconds },
        });
      }
    }
    return NextJsPaykitCreatorService.isCreatorHeld({ creator });
  }
}
