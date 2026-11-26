import {
  PAYKIT_CREATOR_GLOBAL_READS_PER_WINDOW,
  PAYKIT_CREATOR_RATE_LIMIT_MAX_KEYS,
  PAYKIT_CREATOR_RATE_LIMIT_REQUESTS,
  PAYKIT_CREATOR_RATE_LIMIT_WINDOW_MS,
} from '@/config/paykit-creator';
import { type TRateLimitDecision, WindowCounter } from '@/libs/api/window-counter';

const lookupCounter = new WindowCounter(
  PAYKIT_CREATOR_RATE_LIMIT_REQUESTS,
  PAYKIT_CREATOR_RATE_LIMIT_WINDOW_MS,
  PAYKIT_CREATOR_RATE_LIMIT_MAX_KEYS,
);

const GLOBAL_KEY = 'global';
const readCounter = new WindowCounter(PAYKIT_CREATOR_GLOBAL_READS_PER_WINDOW, PAYKIT_CREATOR_RATE_LIMIT_WINDOW_MS, 1);

export class PaykitCreatorRateLimiter {
  private constructor() {}

  /** Counts one lookup by a caller key (a client address) and refuses it when the key is out of lookups. */
  static admit(key: string): TRateLimitDecision {
    return lookupCounter.consume(key, 1);
  }

  /** Counts one read of the Paykit Server against the allowance every caller shares. */
  static admitRead(): TRateLimitDecision {
    return readCounter.consume(GLOBAL_KEY, 1);
  }

  static resetForTests(): void {
    lookupCounter.clear();
    readCounter.clear();
  }
}
