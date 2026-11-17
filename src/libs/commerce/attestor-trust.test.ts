import { afterEach, describe, expect, it } from 'vitest';
import { trustedAttestedReviewCount } from '@/libs/commerce/attestor-trust';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { PUBKY_RUNTIME_ENV_NAMES } from '@/libs/runtime-config/runtime-config.schema';
import { TEST_TRUSTED_ATTESTOR } from '@/test/fixtures/commerce/trusted-attestors';

const ENV_NAME = PUBKY_RUNTIME_ENV_NAMES.marketplaceTrustedAttestors;
const SUITE_VALUE = process.env[ENV_NAME];
const UNKNOWN_ATTESTOR = 'x'.repeat(52);
const RETIRED_ATTESTOR = 'y'.repeat(52);
const NOW = new Date('2026-10-21T09:00:00Z');

afterEach(() => {
  process.env[ENV_NAME] = SUITE_VALUE;
  resetRuntimeConfigForTests();
});

describe('trustedAttestedReviewCount', () => {
  it('sums only the verified reviews signed by trusted attestors', () => {
    expect(trustedAttestedReviewCount({ [TEST_TRUSTED_ATTESTOR.pubky]: 3, [UNKNOWN_ATTESTOR]: 7 }, NOW)).toBe(3);
  });

  it('is zero when every verified review comes from an unrecognized key', () => {
    expect(trustedAttestedReviewCount({ [UNKNOWN_ATTESTOR]: 4 }, NOW)).toBe(0);
    expect(trustedAttestedReviewCount({}, NOW)).toBe(0);
  });

  it('counts an attestor only while its window is open, since the aggregate carries no attestation times', () => {
    process.env[ENV_NAME] = JSON.stringify([
      TEST_TRUSTED_ATTESTOR,
      { pubky: RETIRED_ATTESTOR, label: 'Retired', validFrom: '2026-08-01', validUntil: '2026-10-12' },
    ]);
    resetRuntimeConfigForTests();
    const attestors = { [TEST_TRUSTED_ATTESTOR.pubky]: 2, [RETIRED_ATTESTOR]: 5 };

    expect(trustedAttestedReviewCount(attestors, new Date('2026-10-11T23:59:59Z'))).toBe(7);
    expect(trustedAttestedReviewCount(attestors, NOW)).toBe(2);
  });
});
