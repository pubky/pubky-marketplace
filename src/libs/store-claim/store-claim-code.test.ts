import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildStoreClaimCodeIntakeScript,
  isValidStoreClaimCode,
  normalizeStoreClaimCode,
  normalizeValidStoreClaimCode,
  STORE_CLAIM_CODE_SESSION_KEY,
} from './store-claim-code';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

describe('store claim code', () => {
  it.each([
    ['0123-4567-89ab-cdef-ghjk-mnpq-rstv-wxyz', CROCKFORD],
    ['abcd efgh', 'ABCDEFGH'],
    ['oil', '011'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeStoreClaimCode(input)).toBe(expected);
  });

  it('accepts Crockford base32 after normalizing hyphens and lowercase', () => {
    const grouped = CROCKFORD.toLowerCase().match(/.{4}/g)?.join('-') ?? '';
    expect(normalizeValidStoreClaimCode(grouped)).toBe(CROCKFORD);
  });

  it('accepts 64 hexadecimal characters after normalizing case', () => {
    expect(normalizeValidStoreClaimCode('a'.repeat(64))).toBe('A'.repeat(64));
  });

  it.each(['A'.repeat(26), 'A'.repeat(40), `${CROCKFORD.slice(0, 31)}U`, 'G'.repeat(64)])(
    'rejects malformed code %s',
    (code) => {
      expect(isValidStoreClaimCode(normalizeStoreClaimCode(code))).toBe(false);
    },
  );
});

describe('store claim code intake script', () => {
  beforeEach(() => {
    vi.stubGlobal('isSecureContext', true);
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/setup');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stores the decoded code and removes the fragment synchronously', () => {
    window.history.replaceState(null, '', '/setup?from=link#claim=abc%20def');

    new Function(buildStoreClaimCodeIntakeScript())();

    expect(window.sessionStorage.getItem(STORE_CLAIM_CODE_SESSION_KEY)).toBe('abc def');
    expect(window.location.pathname).toBe('/setup');
    expect(window.location.search).toBe('?from=link');
    expect(window.location.hash).toBe('');
  });

  it('does not store the code in an insecure context but still removes the fragment', () => {
    vi.stubGlobal('isSecureContext', false);
    window.history.replaceState(null, '', '/setup?from=link#claim=abc');

    new Function(buildStoreClaimCodeIntakeScript())();

    expect(window.sessionStorage.getItem(STORE_CLAIM_CODE_SESSION_KEY)).toBeNull();
    expect(window.location.search).toBe('?from=link');
    expect(window.location.hash).toBe('');
  });

  it('leaves storage untouched without a fragment', () => {
    new Function(buildStoreClaimCodeIntakeScript())();
    expect(window.sessionStorage.getItem(STORE_CLAIM_CODE_SESSION_KEY)).toBeNull();
  });

  it('scrubs the fragment when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    window.history.replaceState(null, '', '/setup#claim=abc');

    new Function(buildStoreClaimCodeIntakeScript())();

    expect(window.location.hash).toBe('');
  });

  it('leaves a non-claim fragment alone', () => {
    window.history.replaceState(null, '', '/setup#section=identity');
    new Function(buildStoreClaimCodeIntakeScript())();
    expect(window.location.hash).toBe('#section=identity');
    expect(window.sessionStorage.getItem(STORE_CLAIM_CODE_SESSION_KEY)).toBeNull();
  });
});
