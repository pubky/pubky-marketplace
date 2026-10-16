import { describe, expect, it } from 'vitest';
import { usdtMissingOptionExplanation } from './usdt-missing-option';

const A = 'a'.repeat(52);
const B = 'b'.repeat(52);

const base = {
  gateOpen: true,
  offered: false,
  sellerAcceptsUsdt: new Map([
    [A, true],
    [B, false],
  ]),
};

describe('usdtMissingOptionExplanation', () => {
  it('names a seller in a multi-seller cart who does not take USDT', () => {
    expect(usdtMissingOptionExplanation(base)).toEqual({ sellersWithoutUsdt: [B] });
  });

  it('lists every seller who does not take USDT, in cart order', () => {
    const C = 'c'.repeat(52);
    expect(
      usdtMissingOptionExplanation({
        ...base,
        sellerAcceptsUsdt: new Map([
          [C, false],
          [A, true],
          [B, false],
        ]),
      }),
    ).toEqual({ sellersWithoutUsdt: [C, B] });
  });

  it('says nothing when no seller in the cart takes USDT, because nothing was offered', () => {
    expect(
      usdtMissingOptionExplanation({
        ...base,
        sellerAcceptsUsdt: new Map([
          [A, false],
          [B, false],
        ]),
      }),
    ).toBeNull();
  });

  it.each([
    ['the gate is closed', { gateOpen: false }],
    ['USDT is offered', { offered: true }],
    ['the seller configs are not loaded', { sellerAcceptsUsdt: null }],
    ['every seller takes USDT', { sellerAcceptsUsdt: new Map([[A, true]]) }],
  ])('says nothing when %s', (_name, override) => {
    expect(usdtMissingOptionExplanation({ ...base, ...override })).toBeNull();
  });
});
