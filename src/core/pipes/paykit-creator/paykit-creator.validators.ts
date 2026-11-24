import { HttpStatusCode } from '@/libs/http/http.types';
import { isPubkyIdentifier, stripPubkyPrefix } from '@/libs/utils/utils';

type TPaykitCreatorValidationResult =
  | { ok: true; creator: string }
  | { ok: false; message: string; statusCode: HttpStatusCode.BAD_REQUEST };

/**
 * Validates the query of the Paykit creator lookup. Pure: the route hands in the raw `searchParams`
 * value, and what comes out is what the Paykit Server is allowed to see.
 *
 * `creator` must be a pubky (with or without the `pubky` prefix); it leaves in Paykit's canonical
 * `pubky<z32>` form, the only one `/setup/creator-held` parses.
 */
export class PaykitCreatorValidators {
  private constructor() {}

  static validateSafe(creator: string | null): TPaykitCreatorValidationResult {
    const trimmed = (creator ?? '').trim();
    // A raw z32 key can itself start with "pubky"; only a display prefix is stripped.
    const bareCreator = isPubkyIdentifier(trimmed) ? trimmed : stripPubkyPrefix(trimmed);
    if (!isPubkyIdentifier(bareCreator)) {
      return { ok: false, message: 'Invalid creator', statusCode: HttpStatusCode.BAD_REQUEST };
    }
    return { ok: true, creator: `pubky${bareCreator}` };
  }
}
