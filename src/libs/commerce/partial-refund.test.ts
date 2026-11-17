import { describe, expect, it } from 'vitest';
import { partialRefundLabel, plainRefundRefusal, satsRefundIsFull } from './partial-refund';

const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD', exponent: 2 });

describe('partialRefundLabel', () => {
  it('names a recorded amount below the order total', () => {
    expect(
      partialRefundLabel({
        state: 'refunded_external',
        total: usd(250),
        externalRefund: { amountMinor: 189 },
      }),
    ).toBe('Refunded $1.89 of $2.50');
  });

  it('names a partial-refund state even when the amounts match', () => {
    expect(
      partialRefundLabel({
        state: 'refunded_partial',
        total: usd(250),
        externalRefund: { amountMinor: 250 },
      }),
    ).toBe('Refunded $2.50 of $2.50');
  });

  it('leaves a full external refund on the existing copy', () => {
    expect(
      partialRefundLabel({
        state: 'refunded_external',
        total: usd(250),
        externalRefund: { amountMinor: 250 },
      }),
    ).toBeNull();
  });
});

describe('partialRefundLabel on a refund recorded in sats', () => {
  // The service leaves a partial refund `refunded_external` like a full one.
  const refunded = { state: 'refunded_external', total: usd(13_700) };
  const sats = (amountMinor: number) => ({ amountMinor, amountUnit: 'sat' as const });
  const received = { amountMinor: 51_637, unit: 'sat' as const, exponent: 0 };

  it("reads the seller's sats against the sats received, not the cents", () => {
    expect(
      partialRefundLabel({ ...refunded, externalRefund: sats(20_000), externalRefundFull: false, refundCap: received }),
    ).toBe('Refunded ₿20,000 of ₿51,637');
    expect(
      partialRefundLabel({ ...refunded, externalRefund: sats(51_637), externalRefundFull: true, refundCap: received }),
    ).toBeNull();
    // A service without the flag: the seller's cap still decides.
    expect(partialRefundLabel({ ...refunded, externalRefund: sats(20_000), refundCap: received })).toBe(
      'Refunded ₿20,000 of ₿51,637',
    );
  });

  it("names the buyer's partial refund from the service's flag, without the seller's figure", () => {
    expect(partialRefundLabel({ ...refunded, externalRefund: sats(25_819), externalRefundFull: false })).toBe(
      'Partly refunded ₿25,819',
    );
    // More sats than the order's cents, and all of them.
    expect(partialRefundLabel({ ...refunded, externalRefund: sats(53_000), externalRefundFull: true })).toBeNull();
    // Without the flag the buyer cannot tell: no partial claim.
    expect(partialRefundLabel({ ...refunded, externalRefund: sats(25_819) })).toBeNull();
  });

  it("reads a record that names no unit in the order's own units", () => {
    expect(
      partialRefundLabel({
        ...refunded,
        externalRefund: { amountMinor: 5_000 },
        externalRefundFull: null,
        refundCap: received,
      }),
    ).toBe('Refunded $50.00 of $137.00');
  });
});

describe('satsRefundIsFull', () => {
  const refunded = { state: 'refunded_external', total: usd(13_700) };
  const sats = (amountMinor: number) => ({ amountMinor, amountUnit: 'sat' as const });
  const received = { amountMinor: 51_637, unit: 'sat' as const, exponent: 0 };

  it("prefers the service's flag, then the seller's cap", () => {
    expect(satsRefundIsFull({ ...refunded, externalRefund: sats(51_637), externalRefundFull: true })).toBe(true);
    expect(satsRefundIsFull({ ...refunded, externalRefund: sats(20_000), externalRefundFull: false })).toBe(false);
    expect(satsRefundIsFull({ ...refunded, externalRefund: sats(51_637), refundCap: received })).toBe(true);
    expect(satsRefundIsFull({ ...refunded, externalRefund: sats(20_000), refundCap: received })).toBe(false);
  });

  it('is unknown without either, and for a record not in sats', () => {
    expect(satsRefundIsFull({ ...refunded, externalRefund: sats(20_000) })).toBeNull();
    expect(
      satsRefundIsFull({ ...refunded, externalRefund: { amountMinor: 13_700 }, externalRefundFull: true }),
    ).toBeNull();
  });
});

describe('plainRefundRefusal', () => {
  it('keeps the service refusal sentence', () => {
    expect(plainRefundRefusal('The external refund cannot be recorded.')).toBe(
      'The external refund cannot be recorded.',
    );
  });

  it('drops markup and empty text', () => {
    expect(plainRefundRefusal('<b>no</b>')).toBeNull();
    expect(plainRefundRefusal('  ')).toBeNull();
    expect(plainRefundRefusal(null)).toBeNull();
  });
});
