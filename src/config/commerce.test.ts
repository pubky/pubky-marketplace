import { afterEach, describe, expect, it } from 'vitest';
import {
  isDurableCommerceMode,
  MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS,
  marketplaceTrustedAttestors,
  trustedMarketplaceAttestorAt,
  trustedMarketplaceAttestorAtRecordTime,
} from '@/config/commerce';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { PUBKY_RUNTIME_ENV_NAMES } from '@/libs/runtime-config/runtime-config.schema';
import { TEST_TRUSTED_ATTESTOR } from '@/test/fixtures/commerce/trusted-attestors';

const ENV_NAME = PUBKY_RUNTIME_ENV_NAMES.marketplaceTrustedAttestors;
const SUITE_VALUE = process.env[ENV_NAME];
const RETIRED = 'h7hcm6mghujfn3hkyrdncxb7whcq19yf7t4fowq1brg3g1arbypp';
const CURRENT = '6tsjayz6t7qyjhzkipdcri3fbdqf5h85ewkdkf3466abfcoszau8';

function withTrustList(entries: unknown[]): void {
  process.env[ENV_NAME] = JSON.stringify(entries);
  resetRuntimeConfigForTests();
}

afterEach(() => {
  process.env[ENV_NAME] = SUITE_VALUE;
  resetRuntimeConfigForTests();
});

describe('isDurableCommerceMode', () => {
  it('treats the live production locks-paykit mode as durable', () => {
    expect(isDurableCommerceMode('locks-paykit')).toBe(true);
  });
});

describe('MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS', () => {
  it('compiles in no deployment-specific keys', () => {
    expect(MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS).toEqual([]);
  });
});

describe('marketplaceTrustedAttestors', () => {
  it('is the compiled defaults plus the runtime entries', () => {
    expect(marketplaceTrustedAttestors()).toEqual([...MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS, TEST_TRUSTED_ATTESTOR]);
  });

  it('is empty when the deployment configures no runtime entries', () => {
    delete process.env[ENV_NAME];
    resetRuntimeConfigForTests();
    expect(marketplaceTrustedAttestors()).toEqual([]);
    expect(trustedMarketplaceAttestorAt(TEST_TRUSTED_ATTESTOR.pubky, new Date('2026-10-21T00:00:00Z'))).toBeNull();
  });
});

describe('trustedMarketplaceAttestorAt', () => {
  it('rejects an attestation made before validFrom and accepts one at validFrom', () => {
    withTrustList([{ pubky: CURRENT, label: 'Pubky Market', validFrom: '2026-10-12T14:00:00Z' }]);

    expect(trustedMarketplaceAttestorAt(CURRENT, new Date('2026-10-12T13:59:59.999Z'))).toBeNull();
    expect(trustedMarketplaceAttestorAt(CURRENT, new Date('2026-10-12T14:00:00Z'))?.label).toBe('Pubky Market');
  });

  it('accepts an attestation just before validUntil and rejects one at validUntil', () => {
    withTrustList([{ pubky: RETIRED, label: 'Staging', validFrom: '2026-08-21', validUntil: '2026-10-12' }]);

    expect(trustedMarketplaceAttestorAt(RETIRED, new Date('2026-10-11T23:59:59.999Z'))?.label).toBe('Staging');
    expect(trustedMarketplaceAttestorAt(RETIRED, new Date('2026-10-12T00:00:00Z'))).toBeNull();
    expect(trustedMarketplaceAttestorAt(RETIRED, new Date('2026-11-01T00:00:00Z'))).toBeNull();
  });

  it('keeps an open-ended window open indefinitely', () => {
    withTrustList([{ pubky: CURRENT, label: 'Pubky Market', validFrom: '2026-10-12' }]);

    expect(trustedMarketplaceAttestorAt(CURRENT, new Date('2099-01-01T00:00:00Z'))?.pubky).toBe(CURRENT);
  });

  it('reads offset datetimes as the instant they name', () => {
    withTrustList([{ pubky: CURRENT, label: 'Pubky Market', validFrom: '2026-10-12T09:00:00+01:00' }]);

    expect(trustedMarketplaceAttestorAt(CURRENT, new Date('2026-10-12T07:59:59Z'))).toBeNull();
    expect(trustedMarketplaceAttestorAt(CURRENT, new Date('2026-10-12T08:00:00Z'))).not.toBeNull();
  });

  it('picks the entry whose window covers the attestation when a key has several', () => {
    withTrustList([
      { pubky: CURRENT, label: 'First epoch', validFrom: '2026-01-01', validUntil: '2026-06-01' },
      { pubky: CURRENT, label: 'Second epoch', validFrom: '2026-09-01' },
    ]);

    expect(trustedMarketplaceAttestorAt(CURRENT, new Date('2026-03-01T00:00:00Z'))?.label).toBe('First epoch');
    expect(trustedMarketplaceAttestorAt(CURRENT, new Date('2026-07-01T00:00:00Z'))).toBeNull();
    expect(trustedMarketplaceAttestorAt(CURRENT, new Date('2026-10-01T00:00:00Z'))?.label).toBe('Second epoch');
  });

  it('never trusts an unlisted key, a missing attestor or an invalid time', () => {
    withTrustList([{ pubky: CURRENT, label: 'Pubky Market', validFrom: '2026-10-12' }]);

    expect(trustedMarketplaceAttestorAt('x'.repeat(52), new Date('2026-10-20T00:00:00Z'))).toBeNull();
    expect(trustedMarketplaceAttestorAt(null, new Date('2026-10-20T00:00:00Z'))).toBeNull();
    expect(trustedMarketplaceAttestorAt(CURRENT, new Date('not a date'))).toBeNull();
  });
});

describe('trustedMarketplaceAttestorAtRecordTime', () => {
  it("does not vouch for a review backdated into a retired key's window", () => {
    withTrustList([{ pubky: RETIRED, label: 'Staging', validFrom: '2026-08-01', validUntil: '2026-10-12' }]);

    expect(trustedMarketplaceAttestorAtRecordTime(RETIRED, new Date('2026-09-15T12:00:00Z'))).toBeNull();
    expect(trustedMarketplaceAttestorAtRecordTime(RETIRED, new Date('2026-10-11T23:59:59.999Z'))).toBeNull();
  });

  it('vouches for the same key and time under an entry without validUntil', () => {
    withTrustList([{ pubky: RETIRED, label: 'Staging', validFrom: '2026-08-01' }]);

    expect(trustedMarketplaceAttestorAtRecordTime(RETIRED, new Date('2026-09-15T12:00:00Z'))?.label).toBe('Staging');
  });

  it('still checks validFrom against the record time', () => {
    withTrustList([{ pubky: CURRENT, label: 'Pubky Market', validFrom: '2026-10-12T14:00:00Z' }]);

    expect(trustedMarketplaceAttestorAtRecordTime(CURRENT, new Date('2026-10-12T13:59:59.999Z'))).toBeNull();
    expect(trustedMarketplaceAttestorAtRecordTime(CURRENT, new Date('2026-10-12T14:00:00Z'))?.label).toBe(
      'Pubky Market',
    );
  });

  it('uses an open-ended entry when the key also has a closed one', () => {
    withTrustList([
      { pubky: CURRENT, label: 'First epoch', validFrom: '2026-01-01', validUntil: '2026-06-01' },
      { pubky: CURRENT, label: 'Second epoch', validFrom: '2026-09-01' },
    ]);

    expect(trustedMarketplaceAttestorAtRecordTime(CURRENT, new Date('2026-03-01T00:00:00Z'))).toBeNull();
    expect(trustedMarketplaceAttestorAtRecordTime(CURRENT, new Date('2026-10-01T00:00:00Z'))?.label).toBe(
      'Second epoch',
    );
  });

  it('never trusts an unlisted key, a missing attestor or an invalid time', () => {
    withTrustList([{ pubky: CURRENT, label: 'Pubky Market', validFrom: '2026-10-12' }]);

    expect(trustedMarketplaceAttestorAtRecordTime('x'.repeat(52), new Date('2026-10-20T00:00:00Z'))).toBeNull();
    expect(trustedMarketplaceAttestorAtRecordTime(null, new Date('2026-10-20T00:00:00Z'))).toBeNull();
    expect(trustedMarketplaceAttestorAtRecordTime(CURRENT, new Date('not a date'))).toBeNull();
  });
});
