import { PublicKey } from '@synonymdev/pubky';
import { commercePubkySchema } from '@/libs/commerce/transaction-contracts';
import { HttpStatusCode } from '@/libs/http/http.types';
import { stripPubkyPrefix } from '@/libs/utils/utils';

type TPaykitCreatorValidationResult =
  | { ok: true; creator: string }
  | { ok: false; message: string; statusCode: HttpStatusCode.BAD_REQUEST };

const isZ32Pubky = (value: string): boolean => commercePubkySchema.safeParse(value).success;

/**
 * Paykit parses the key and refuses it unless its canonical rendering is the input, so a spelling that only
 * looks right (set spare bits in the last character, or no point on the curve) is refused here instead.
 */
const isCanonicalKey = (z32: string): boolean => {
  try {
    return PublicKey.from(z32).z32() === z32;
  } catch {
    return false;
  }
};

/**
 * Validates the query of the Paykit creator lookup. Pure: the route hands in the raw `searchParams`
 * value, and what comes out is what the Paykit Server is allowed to see.
 *
 * `creator` must be a z-base-32 pubky (with or without the `pubky` prefix); it leaves in Paykit's canonical
 * `pubky<z32>` form, the only one `/setup/creator-held` parses, and only when it is the canonical spelling of
 * an Ed25519 public key. Anything else is refused here, so it never costs a read of the Paykit Server.
 */
export class PaykitCreatorValidators {
  private constructor() {}

  static validateSafe(creator: string | null): TPaykitCreatorValidationResult {
    const trimmed = (creator ?? '').trim();
    // A raw z32 key can itself start with "pubky"; only a display prefix is stripped.
    const bareCreator = isZ32Pubky(trimmed) ? trimmed : stripPubkyPrefix(trimmed);
    if (!isZ32Pubky(bareCreator) || !isCanonicalKey(bareCreator)) {
      return { ok: false, message: 'Invalid creator', statusCode: HttpStatusCode.BAD_REQUEST };
    }
    return { ok: true, creator: `pubky${bareCreator}` };
  }
}
