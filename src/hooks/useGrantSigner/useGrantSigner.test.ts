import { describe, expect, it } from 'vitest';
import { readGrantSigner } from './useGrantSigner';

describe('readGrantSigner', () => {
  it('is null without a session and for a cookie session', () => {
    expect(readGrantSigner({ session: null, grantSigner: 'passport' })).toBeNull();
    expect(readGrantSigner({ session: { grant: undefined }, grantSigner: 'passport' })).toBeNull();
  });

  it('names Pubky Passport only when the grant session is marked Passport-approved', () => {
    expect(readGrantSigner({ session: { grant: {} }, grantSigner: 'passport' })).toBe('passport');
  });

  it('requires a signer choice for an unmarked grant session', () => {
    expect(readGrantSigner({ session: { grant: {} }, grantSigner: null })).toBe('host');
  });

  it.each(['ring', 'bitkit', 'passport', 'local-key', 'host'] as const)(
    'preserves the recorded %s signer',
    (signer) => {
      expect(readGrantSigner({ session: { grant: {} }, grantSigner: signer })).toBe(signer);
    },
  );
});
