import { afterEach, describe, expect, it } from 'vitest';
import {
  isDurableCommerceMode,
  MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS,
  marketplaceTrustedAttestors,
  trustedMarketplaceAttestorAt,
  trustedMarketplaceAttestorAtRecordTime,
} from '@/config/commerce';
import { resetAttestorKeyWindows, setAttestorProfileKeyWindows } from '@/libs/commerce/attestor-key-windows';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { PUBKY_RUNTIME_ENV_NAMES } from '@/libs/runtime-config/runtime-config.schema';
import { TEST_TRUSTED_ATTESTOR } from '@/test/fixtures/commerce/trusted-attestors';

const ENV_NAME = PUBKY_RUNTIME_ENV_NAMES.marketplaceTrustedAttestors;
const SUITE_VALUE = process.env[ENV_NAME];
const RETIRED = 'h7hcm6mghujfn3hkyrdncxb7whcq19yf7t4fowq1brg3g1arbypp';
const CURRENT = '6tsjayz6t7qyjhzkipdcri3fbdqf5h85ewkdkf3466abfcoszau8';
const GCP_PROD_ATTESTOR = 'pstmi1bgg6dnrwmfabo9eqycm91esxx338awz1r5feaiub49934o';
const GCP_STAGING_ATTESTOR = 'mqasdxcixebjqmzdi15afo4ipsrfe9ecjfatgfyn1tmbz853zpey';

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
  it('compiles in only the Pubky Market production attestor', () => {
    expect(MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS).toEqual([
      { pubky: GCP_PROD_ATTESTOR, label: 'Pubky Market', validFrom: '2026-10-01' },
    ]);
  });

  it('does not trust the staging attestor without runtime config', () => {
    delete process.env[ENV_NAME];
    resetRuntimeConfigForTests();
    expect(trustedMarketplaceAttestorAt(GCP_STAGING_ATTESTOR, new Date('2026-10-21T10:00:00Z'))).toBeNull();
    expect(trustedMarketplaceAttestorAt(GCP_PROD_ATTESTOR, new Date('2026-10-21T10:00:00Z'))?.label).toBe(
      'Pubky Market',
    );
  });

  it('trusts the staging attestor once the staging deployment lists it', () => {
    withTrustList([{ pubky: GCP_STAGING_ATTESTOR, label: 'Pubky Market', validFrom: '2026-10-01' }]);
    expect(trustedMarketplaceAttestorAt(GCP_STAGING_ATTESTOR, new Date('2026-10-21T10:00:00Z'))?.label).toBe(
      'Pubky Market',
    );
  });
});

describe('marketplaceTrustedAttestors', () => {
  it('is the compiled defaults plus the runtime entries', () => {
    expect(marketplaceTrustedAttestors()).toEqual([...MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS, TEST_TRUSTED_ATTESTOR]);
  });

  it('is the compiled defaults alone when the deployment configures no runtime entries', () => {
    delete process.env[ENV_NAME];
    resetRuntimeConfigForTests();
    expect(marketplaceTrustedAttestors()).toEqual(MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS);
    expect(trustedMarketplaceAttestorAt(TEST_TRUSTED_ATTESTOR.pubky, new Date('2026-10-21T00:00:00Z'))).toBeNull();
  });
});

describe('marketplaceTrustedAttestors narrowed by an attestor profile', () => {
  afterEach(() => resetAttestorKeyWindows());

  it('ends a configured key at the profile bound, and leaves the others and the configured list as they were', () => {
    const compromisedFrom = Date.parse('2026-05-01T00:00:00Z') / 1000;
    setAttestorProfileKeyWindows(TEST_TRUSTED_ATTESTOR.pubky, [
      { pubky: TEST_TRUSTED_ATTESTOR.pubky, validUntil: null, compromisedFrom },
    ]);

    expect(marketplaceTrustedAttestors()).toEqual([
      ...MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS,
      { ...TEST_TRUSTED_ATTESTOR, validUntil: '2026-05-01T00:00:00.000Z' },
    ]);
    expect(trustedMarketplaceAttestorAt(TEST_TRUSTED_ATTESTOR.pubky, new Date('2026-04-30T23:59:59Z'))).not.toBeNull();
    expect(trustedMarketplaceAttestorAt(TEST_TRUSTED_ATTESTOR.pubky, new Date('2026-05-01T00:00:00Z'))).toBeNull();
  });

  it('never trusts a key the configuration lacks, however the profile lists it', () => {
    delete process.env[ENV_NAME];
    resetRuntimeConfigForTests();
    setAttestorProfileKeyWindows(TEST_TRUSTED_ATTESTOR.pubky, [
      { pubky: TEST_TRUSTED_ATTESTOR.pubky, validUntil: null, compromisedFrom: null },
    ]);

    expect(marketplaceTrustedAttestors()).toEqual(MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS);
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
