import { describe, expect, it } from 'vitest';
import { MARKETPLACE_TRUSTED_ATTESTORS } from '@/config/commerce';
import { trustedAttestedReviewCount } from '@/libs/commerce/attestor-trust';

const UNKNOWN_ATTESTOR = 'x'.repeat(52);

describe('trustedAttestedReviewCount', () => {
  it('sums only the verified reviews signed by trusted attestors', () => {
    const [first, second] = MARKETPLACE_TRUSTED_ATTESTORS;

    expect(trustedAttestedReviewCount({ [first]: 3, [second]: 2, [UNKNOWN_ATTESTOR]: 7 })).toBe(5);
  });

  it('is zero when every verified review comes from an unrecognized key', () => {
    expect(trustedAttestedReviewCount({ [UNKNOWN_ATTESTOR]: 4 })).toBe(0);
    expect(trustedAttestedReviewCount({})).toBe(0);
  });
});
