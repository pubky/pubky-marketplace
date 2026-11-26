import { PaykitCreatorApplication } from '@/application/paykit-creator/paykit-creator';
import { HttpStatusCode } from '@/libs/http/http.types';
import { PaykitCreatorValidators } from '@/pipes/paykit-creator/paykit-creator.validators';
import type { TPaykitCreatorControllerResult } from './paykit-creator.types';

/**
 * Entry point of the Paykit creator probe, called from the API route.
 */
export class PaykitCreatorController {
  private constructor() {}

  /**
   * Asks Paykit over the network whether it already holds `creator`. The server-side service reuses a recent
   * answer for the same creator and shares one request between concurrent callers.
   *
   * @param params.creator - Raw `creator` query value (may be null)
   * @param params.rateLimitKeys - The caller's limiter keys (client address)
   * @returns The answer, a validation failure for a malformed query, or a 429 refusal with its retry hint
   * when a local limit is reached
   * @throws AppError when Paykit cannot answer.
   */
  static async fetchCreatorHeld(params: {
    creator: string | null;
    rateLimitKeys: string[];
  }): Promise<TPaykitCreatorControllerResult> {
    const validation = PaykitCreatorValidators.validateSafe(params.creator);
    if (!validation.ok) {
      return { ok: false, message: validation.message, statusCode: validation.statusCode };
    }
    const answer = await PaykitCreatorApplication.isCreatorHeld({
      creator: validation.creator,
      rateLimitKeys: params.rateLimitKeys,
    });
    if (!answer.ok) {
      return {
        ok: false,
        message: 'Too many requests',
        statusCode: HttpStatusCode.TOO_MANY_REQUESTS,
        retryAfterSeconds: answer.retryAfterSeconds,
      };
    }
    return { ok: true, held: answer.held };
  }
}
