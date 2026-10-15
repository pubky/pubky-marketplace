import { describe, expect, it } from 'vitest';
import { toCamelCaseWire } from '@/libs/commerce/wire-casing';
import { createFxConvertedOrderFixture, createOrderFixture } from '@/test/fixtures/commerce/orders';
import {
  marketplaceFxConversionSchema,
  marketplaceOrderSchema,
  marketplaceParticipantOrderSchema,
} from './marketplace-projections';

/** The service wire for a EUR order, snake_case as `usd_conversion_view` emits it. */
const FX_CONVERSION_WIRE = {
  pair: 'EURUSD',
  rate: '1.106106',
  usd_rate: '77197',
  currency_rate: '69789',
  source: 'blocktank',
  fetched_at: '2026-10-15T09:40:00.000Z',
  from: { amount_minor: 13_700, currency: 'EUR', exponent: 2 },
  to: { amount_minor: 15_154, currency: 'USD', exponent: 2 },
};

describe('order projection: fx_conversion (provisional service wire)', () => {
  it('parses the conversion the service records on a non-USD order', () => {
    const parsed = marketplaceFxConversionSchema.safeParse(toCamelCaseWire(FX_CONVERSION_WIRE));

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toMatchObject({
        pair: 'EURUSD',
        rate: '1.106106',
        usdRate: '77197',
        currencyRate: '69789',
        source: 'blocktank',
        fetchedAt: '2026-10-15T09:40:00.000Z',
        from: { amountMinor: 13_700, currency: 'EUR', exponent: 2 },
        to: { amountMinor: 15_154, currency: 'USD', exponent: 2 },
      });
    }
  });

  it('carries fxConversion and the bitcoin quote pair on the order', () => {
    const parsed = marketplaceOrderSchema.safeParse(createFxConvertedOrderFixture());

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.total).toMatchObject({ currency: 'EUR', amountMinor: 13_700 });
      expect(parsed.data.fxConversion?.to).toEqual({ amountMinor: 15_154, currency: 'USD', exponent: 2 });
      expect(parsed.data.bitcoinQuote?.pair).toBe('BTCEUR');
    }
  });

  it('reads the same fields on participant lists', () => {
    const parsed = marketplaceParticipantOrderSchema.safeParse(createFxConvertedOrderFixture());

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.fxConversion?.pair).toBe('EURUSD');
  });

  it('is absent on USD orders and orders from a service that predates it', () => {
    const parsed = marketplaceOrderSchema.safeParse(createOrderFixture('pending_payment'));

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.fxConversion).toBeUndefined();
  });

  it('accepts a null conversion', () => {
    const parsed = marketplaceOrderSchema.safeParse({ ...createFxConvertedOrderFixture(), fxConversion: null });

    expect(parsed.success).toBe(true);
  });

  it.each([
    ['a string', 'EURUSD'],
    ['a missing money', { pair: 'EURUSD', rate: '1.1', usdRate: '1', currencyRate: '1', source: 'x', fetchedAt: 'y' }],
    [
      'a non-numeric amount',
      { ...(toCamelCaseWire(FX_CONVERSION_WIRE) as object), to: { amountMinor: 'lots', currency: 'USD' } },
    ],
  ] as Array<[string, unknown]>)('drops a malformed conversion (%s) without failing the order', (_label, value) => {
    const parsed = marketplaceOrderSchema.safeParse({ ...createFxConvertedOrderFixture(), fxConversion: value });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.fxConversion).toBeUndefined();
  });

  it('keeps an order without a bitcoin quote pair parsing as before', () => {
    const fixture = createFxConvertedOrderFixture();
    const quote = { ...fixture.bitcoinQuote! };
    delete (quote as { pair?: string }).pair;

    const parsed = marketplaceOrderSchema.safeParse({ ...fixture, bitcoinQuote: quote });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.bitcoinQuote?.pair).toBeUndefined();
  });
});
