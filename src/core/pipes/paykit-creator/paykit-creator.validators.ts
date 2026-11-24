import { commercePubkySchema } from '@/libs/commerce/transaction-contracts';
import { HttpStatusCode } from '@/libs/http/http.types';
import { stripPubkyPrefix } from '@/libs/utils/utils';

type TPaykitCreatorValidationResult =
  | { ok: true; creator: string }
  | { ok: false; message: string; statusCode: HttpStatusCode.BAD_REQUEST };

const isZ32Pubky = (value: string): boolean => commercePubkySchema.safeParse(value).success;

/**
 * Validates the query of the Paykit creator lookup. Pure: the route hands in the raw `searchParams`
 * value, and what comes out is what the Paykit Server is allowed to see.
 *
 * `creator` must be a z-base-32 pubky (with or without the `pubky` prefix); it leaves in Paykit's canonical
 * `pubky<z32>` form, the only one `/setup/creator-held` parses. Anything else is refused here, so it never
 * costs a read of the Paykit Server.
 */
export class PaykitCreatorValidators {
  private constructor() {}

  static validateSafe(creator: string | null): TPaykitCreatorValidationResult {
    const trimmed = (creator ?? '').trim();
    // A raw z32 key can itself start with "pubky"; only a display prefix is stripped.
    const bareCreator = isZ32Pubky(trimmed) ? trimmed : stripPubkyPrefix(trimmed);
    if (!isZ32Pubky(bareCreator)) {
      return { ok: false, message: 'Invalid creator', statusCode: HttpStatusCode.BAD_REQUEST };
    }
    return { ok: true, creator: `pubky${bareCreator}` };
  }
}
