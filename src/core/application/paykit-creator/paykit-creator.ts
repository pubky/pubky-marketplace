import type {
  TPaykitCreatorAnswer,
  TPaykitCreatorLookupParams,
} from '@/application/paykit-creator/paykit-creator.types';
import { NextJsPaykitCreatorService } from '@/services/nextjs/paykit-creator/paykit-creator';
import { PaykitCreatorRateLimiter } from '@/services/nextjs/paykit-creator/paykit-creator.rate-limit';

/** Whether the Paykit Server already holds a creator. */
export class PaykitCreatorApplication {
  private constructor() {}

  /**
   * Counts the lookup against each of the caller's limiter keys, then asks.
   *
   * @returns `held: true` when Paykit holds the creator (so only a reconnect can set it up again), `held:
   * false` when it does not, or a `rate_limited` refusal with its retry hint when a local limit is reached.
   * @throws AppError when Paykit cannot answer.
   */
  static async isCreatorHeld({ creator, rateLimitKeys }: TPaykitCreatorLookupParams): Promise<TPaykitCreatorAnswer> {
    for (const key of rateLimitKeys) {
      const decision = PaykitCreatorRateLimiter.admit(key);
      if (!decision.ok) return { ok: false, reason: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds };
    }
    return NextJsPaykitCreatorService.isCreatorHeld({ creator });
  }
}
