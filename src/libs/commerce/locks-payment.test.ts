import { describe, expect, it } from 'vitest';
import {
  buyerVisiblePaymentStatus,
  lockMatchesPreparedTerms,
  lockPolicyCreator,
  locksCheckoutRoute,
  preparedLockResourceHash,
  toBareLockResource,
} from './locks-payment';
import { locksBareLockResourceSchema } from './transaction-commands';

const CREATOR = 'y'.repeat(52);
const LOCK_ID = '000G40R40M30E209185GR38E1W8124GK2GAHC5RR34D1P70X3RFG';

describe('toBareLockResource', () => {
  it('converts a policy URI into the bare form the service contract accepts', () => {
    const bare = toBareLockResource(`pubky://${CREATOR}/pub/locks.app/${LOCK_ID}.json`);
    expect(bare).toBe(`${CREATOR}/pub/locks.app/${LOCK_ID}.json`);
    expect(locksBareLockResourceSchema.safeParse(bare).success).toBe(true);
  });

  it('keeps the Locks rc10 /pub/app.locks/ prefix unchanged', () => {
    const bare = toBareLockResource(`pubky://${CREATOR}/pub/app.locks/${LOCK_ID}.json`);
    expect(bare).toBe(`${CREATOR}/pub/app.locks/${LOCK_ID}.json`);
    expect(locksBareLockResourceSchema.safeParse(bare).success).toBe(true);
    expect(lockPolicyCreator(`pubky://${CREATOR}/pub/app.locks/${LOCK_ID}.json`)).toBe(CREATOR);
  });

  it('rejects URIs outside the Locks namespace', () => {
    expect(toBareLockResource(`pubky://${CREATOR}/pub/pubky.app/marketplace/v1/listings/x`)).toBeNull();
    expect(toBareLockResource(`https://${CREATOR}/pub/locks.app/${LOCK_ID}.json`)).toBeNull();
    expect(toBareLockResource(`pubky://${CREATOR}/pub/locks.apps/${LOCK_ID}.json`)).toBeNull();
    expect(toBareLockResource('')).toBeNull();
    expect(locksBareLockResourceSchema.safeParse(`${CREATOR}/pub/locks/${LOCK_ID}.json`).success).toBe(false);
  });
});

describe('lockPolicyCreator', () => {
  it('extracts the creator pubky', () => {
    expect(lockPolicyCreator(`pubky://${CREATOR}/pub/locks.app/${LOCK_ID}.json`)).toBe(CREATOR);
    expect(lockPolicyCreator('not-a-policy-uri')).toBeNull();
  });
});

describe('buyerVisiblePaymentStatus', () => {
  it('folds detected into awaiting entitlement — detection stays internal', () => {
    expect(buyerVisiblePaymentStatus('detected')).toBe('awaiting_entitlement');
  });

  it('maps the buyer-visible states to themselves', () => {
    expect(buyerVisiblePaymentStatus('awaiting_entitlement')).toBe('awaiting_entitlement');
    expect(buyerVisiblePaymentStatus('confirmed')).toBe('confirmed');
    expect(buyerVisiblePaymentStatus('expired')).toBe('expired');
    expect(buyerVisiblePaymentStatus('manual_review')).toBe('manual_review');
  });
});

describe('locksCheckoutRoute', () => {
  const locked = { listing: { record: { digitalLock: {} } } };
  const plain = { listing: { record: {} } };

  it('routes an all-Locks cart to Locks only in locks-paykit mode on upstream Paykit', () => {
    expect(locksCheckoutRoute('locks-paykit', 'upstream', [locked, locked])).toBe('locks');
    expect(locksCheckoutRoute('locks-paykit', 'fork', [locked])).toBe('method');
    expect(locksCheckoutRoute('transaction-service', 'upstream', [locked])).toBe('method');
  });

  it('marks a mixed cart and leaves a cart without Locks lines on the method flow', () => {
    expect(locksCheckoutRoute('locks-paykit', 'upstream', [locked, plain])).toBe('mixed');
    expect(locksCheckoutRoute('locks-paykit', 'upstream', [plain])).toBe('method');
    expect(locksCheckoutRoute('locks-paykit', 'upstream', [])).toBe('method');
  });
});

describe('preparedLockResourceHash', () => {
  // BLAKE3 of the canonical bare resource, computed with the Rust `blake3` crate the service uses.
  const SERVICE_HASH = '3ef3c3e6614806ff38519648c8936b39691ef58121b02a9107eacb5bbf134e1e';

  it('equals the hash the service keeps for the same lock, whichever form the listing spells it in', () => {
    expect(preparedLockResourceHash(`pubky://${CREATOR}/pub/locks.app/${LOCK_ID}.json`)).toBe(SERVICE_HASH);
    expect(preparedLockResourceHash(`pubky://${CREATOR}/pub/locks.app/${LOCK_ID.toLowerCase()}.json`)).toBe(
      SERVICE_HASH,
    );
  });

  it('keeps the lock prefix as published, so the other prefix is another lock', () => {
    const other = preparedLockResourceHash(`pubky://${CREATOR}/pub/app.locks/${LOCK_ID}.json`);
    expect(other).toMatch(/^[a-f0-9]{64}$/);
    expect(other).not.toBe(SERVICE_HASH);
  });

  it('is null for a URI that is not a Locks policy URI', () => {
    expect(preparedLockResourceHash('')).toBeNull();
    expect(preparedLockResourceHash(`https://${CREATOR}/pub/locks.app/${LOCK_ID}.json`)).toBeNull();
  });
});

describe('lockMatchesPreparedTerms', () => {
  const prepared = {
    lockResourceHash: '3ef3c3e6614806ff38519648c8936b39691ef58121b02a9107eacb5bbf134e1e',
    criterionId: 'paykit',
  };
  const lock = { policyUri: `pubky://${CREATOR}/pub/locks.app/${LOCK_ID}.json`, criterionId: 'paykit' };

  it('matches the lock the payment was prepared against', () => {
    expect(lockMatchesPreparedTerms(prepared, lock)).toBe(true);
  });

  it('does not match a newer lock or another criterion of the same listing', () => {
    const newerLock = `pubky://${CREATOR}/pub/locks.app/${LOCK_ID.replace(/.$/, 'E')}.json`;
    expect(lockMatchesPreparedTerms(prepared, { ...lock, policyUri: newerLock })).toBe(false);
    expect(lockMatchesPreparedTerms(prepared, { ...lock, criterionId: 'other' })).toBe(false);
    expect(lockMatchesPreparedTerms(prepared, { ...lock, policyUri: 'not a policy uri' })).toBe(false);
  });
});
