import { describe, expect, it } from 'vitest';
import { ARBISCAN_LOOKUP_LABEL, ARBISCAN_ORIGIN, arbiscanUrl } from './arbiscan';

const HASH = `0x${'ab'.repeat(32)}`;
const ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';

describe('arbiscanUrl', () => {
  it('builds the transaction page for a well-formed hash, in lowercase', () => {
    expect(arbiscanUrl('transaction', HASH)).toBe(`${ARBISCAN_ORIGIN}/tx/${HASH}`);
    expect(arbiscanUrl('transaction', HASH.toUpperCase().replace('0X', '0x'))).toBe(`${ARBISCAN_ORIGIN}/tx/${HASH}`);
  });

  it('builds the address page for a well-formed address, in lowercase', () => {
    expect(arbiscanUrl('address', ADDRESS)).toBe(`${ARBISCAN_ORIGIN}/address/${ADDRESS.toLowerCase()}`);
  });

  it.each([
    ['transaction', null],
    ['transaction', undefined],
    ['transaction', ''],
    ['transaction', '0x1234'],
    ['transaction', `${HASH}/../admin`],
    ['transaction', ADDRESS],
    ['transaction', 'bitcoin-ref-0001'],
    ['address', HASH],
    ['address', '0x1234'],
    ['address', `${ADDRESS}?x=1`],
    ['address', 'javascript:alert(1)'],
  ] as const)('links nothing for a %s value that is not exactly well-formed (%s)', (kind, value) => {
    expect(arbiscanUrl(kind, value)).toBeNull();
  });

  it('words the link as a lookup, never as verification', () => {
    for (const label of Object.values(ARBISCAN_LOOKUP_LABEL)) {
      expect(label).toMatch(/^Look up /);
      expect(label).not.toMatch(/verif|confirm|proof|checked/i);
    }
  });
});
