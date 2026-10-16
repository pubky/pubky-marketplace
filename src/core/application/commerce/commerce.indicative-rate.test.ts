import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerErrorCode } from '@/libs/error/error.codes';
import { ErrorService } from '@/libs/error/error.types';
import { ExchangerateService } from '@/services/exchangerate/exchangerate';
import { CommerceApplication } from './commerce';

function ticker(symbol: string, lastPrice: string) {
  return {
    symbol,
    lastPrice,
    base: 'BTC',
    baseName: 'Bitcoin',
    quote: symbol.slice(3),
    quoteName: symbol.slice(3),
    currencySymbol: '$',
    currencyFlag: '',
    lastUpdatedAt: 1_792_057_204_198,
  };
}

describe('CommerceApplication.getIndicativeBtcRate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('carries the bitcoin price in every listing currency from one feed response', async () => {
    vi.spyOn(ExchangerateService, 'getIndicativeTickers').mockResolvedValue([
      ticker('BTCUSD', '100000'),
      ticker('BTCEUR', '90000'),
      ticker('BTCCHF', '80000'),
      ticker('BTCGBP', '75000'),
      ticker('BTCJPY', '15000000'),
      ticker('BTCCAD', '135000'),
      ticker('BTCAUD', '150000'),
      ticker('BTCSEK', '900000'),
    ]);

    const rate = await CommerceApplication.getIndicativeBtcRate();

    expect(rate.fiatPerBtc).toEqual({
      USD: '100000',
      EUR: '90000',
      CHF: '80000',
      GBP: '75000',
      JPY: '15000000',
      CAD: '135000',
      AUD: '150000',
    });
    expect(rate.btcUsd).toBe(100_000);
    expect(rate.satUsd).toBeCloseTo(0.001);
    expect(rate.lastUpdatedAt).toBeInstanceOf(Date);
  });

  it('keeps a currency out of the rate when its ticker is missing', async () => {
    vi.spyOn(ExchangerateService, 'getIndicativeTickers').mockResolvedValue([ticker('BTCUSD', '81248')]);

    const rate = await CommerceApplication.getIndicativeBtcRate();

    expect(rate.fiatPerBtc).toEqual({ USD: '81248' });
  });

  it.each([[[ticker('BTCEUR', '90000')]], [[ticker('BTCUSD', '0')]], [[ticker('BTCUSD', 'abc')]], [[]]])(
    'throws instead of inventing a rate when the dollar ticker is unusable (%j)',
    async (tickers) => {
      vi.spyOn(ExchangerateService, 'getIndicativeTickers').mockResolvedValue(tickers);

      await expect(CommerceApplication.getIndicativeBtcRate()).rejects.toMatchObject({
        code: ServerErrorCode.INVALID_RESPONSE,
        service: ErrorService.Exchangerate,
        operation: 'getIndicativeBtcRate',
      });
    },
  );

  it('passes a feed failure through so the UI shows no hint', async () => {
    vi.spyOn(ExchangerateService, 'getIndicativeTickers').mockRejectedValue(new Error('feed down'));

    await expect(CommerceApplication.getIndicativeBtcRate()).rejects.toThrow('feed down');
  });
});
