import { describe, expect, it } from 'vitest';
import { usdtMissingOptionExplanation } from './usdt-missing-option';

const A = 'a'.repeat(52);
const B = 'b'.repeat(52);

const base = {
  gateOpen: true,
  offered: false,
  refused: false,
  sellerAcceptsUsdt: new Map([[A, true]]),
  items: [{ title: 'Boots', sellerPubky: A, currency: 'BTC' }],
};

describe('usdtMissingOptionExplanation', () => {
  it('names a line priced in bitcoin as the reason USDT is missing', () => {
    expect(usdtMissingOptionExplanation(base)).toEqual({ bitcoinPricedTitles: ['Boots'], sellersWithoutUsdt: [] });
  });

  it('names a seller in a multi-seller cart who does not take USDT', () => {
    expect(
      usdtMissingOptionExplanation({
        ...base,
        sellerAcceptsUsdt: new Map([
          [A, true],
          [B, false],
        ]),
        items: [
          { title: 'Boots', sellerPubky: A, currency: 'USD' },
          { title: 'Camera', sellerPubky: B, currency: 'USD' },
        ],
      }),
    ).toEqual({ bitcoinPricedTitles: [], sellersWithoutUsdt: [B] });
  });

  it('gives both reasons when both apply, listing each title once', () => {
    expect(
      usdtMissingOptionExplanation({
        ...base,
        sellerAcceptsUsdt: new Map([
          [A, true],
          [B, false],
        ]),
        items: [
          { title: 'Boots', sellerPubky: A, currency: 'BTC' },
          { title: 'Boots', sellerPubky: A, currency: 'BTC' },
          { title: 'Camera', sellerPubky: B, currency: 'USD' },
        ],
      }),
    ).toEqual({ bitcoinPricedTitles: ['Boots'], sellersWithoutUsdt: [B] });
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
    ['the service just refused USDT', { refused: true }],
    ['the seller configs are not loaded', { sellerAcceptsUsdt: null }],
  ])('says nothing when %s', (_name, override) => {
    expect(usdtMissingOptionExplanation({ ...base, ...override })).toBeNull();
  });

  it('says nothing when neither reason applies', () => {
    expect(
      usdtMissingOptionExplanation({ ...base, items: [{ title: 'Boots', sellerPubky: A, currency: 'USD' }] }),
    ).toBeNull();
  });

  it('does not call a line without a fixed price bitcoin-priced', () => {
    expect(
      usdtMissingOptionExplanation({ ...base, items: [{ title: 'Auction lot', sellerPubky: A, currency: null }] }),
    ).toBeNull();
  });
});
