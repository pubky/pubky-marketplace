import { describe, expect, it } from 'vitest';
import { buildFxRateSnapshot, fxRateSnapshotFromBtcRate } from './money.rates';

function ticker(symbol: string, lastPrice: string) {
  return { symbol, lastPrice };
}

describe('buildFxRateSnapshot', () => {
  it('reads the seven listing currencies', () => {
    const snapshot = buildFxRateSnapshot([
      ticker('BTCUSD', '81248'),
      ticker('BTCEUR', '70123.5'),
      ticker('BTCCHF', '65000'),
      ticker('BTCGBP', '60500'),
      ticker('BTCJPY', '12000000'),
      ticker('BTCCAD', '115345'),
      ticker('BTCAUD', '117287'),
    ]);

    expect(snapshot).toEqual({
      fiatPerBtc: {
        USD: '81248',
        EUR: '70123.5',
        CHF: '65000',
        GBP: '60500',
        JPY: '12000000',
        CAD: '115345',
        AUD: '117287',
      },
    });
  });

  it('ignores tickers outside the listing currencies', () => {
    const snapshot = buildFxRateSnapshot([ticker('BTCSEK', '900000'), ticker('BTCUSD', '81248')]);
    expect(Object.keys(snapshot.fiatPerBtc)).toEqual(['USD']);
  });

  it('matches symbols exactly, so BTCUSDT is not the dollar rate', () => {
    const snapshot = buildFxRateSnapshot([ticker('BTCUSDT', '81000'), ticker('BTCEUT', '70000')]);
    expect(snapshot.fiatPerBtc).toEqual({});
  });

  it('leaves a currency out when its price is unusable rather than inventing one', () => {
    const snapshot = buildFxRateSnapshot([
      ticker('BTCUSD', '0'),
      ticker('BTCEUR', '-5'),
      ticker('BTCCHF', 'NaN'),
      ticker('BTCGBP', ''),
      ticker('BTCJPY', '1e7'),
      ticker('BTCCAD', '0.0'),
      ticker('BTCAUD', '117287'),
    ]);
    expect(snapshot.fiatPerBtc).toEqual({ AUD: '117287' });
  });

  it('trims whitespace around a quoted price', () => {
    expect(buildFxRateSnapshot([ticker('BTCUSD', ' 81248 ')]).fiatPerBtc).toEqual({ USD: '81248' });
  });

  it('produces an empty snapshot from an empty feed', () => {
    expect(buildFxRateSnapshot([]).fiatPerBtc).toEqual({});
  });

  it('takes the last quote when a symbol repeats', () => {
    expect(buildFxRateSnapshot([ticker('BTCUSD', '1'), ticker('BTCUSD', '2')]).fiatPerBtc).toEqual({ USD: '2' });
  });
});

describe('fxRateSnapshotFromBtcRate', () => {
  it('uses every currency a rate carries', () => {
    const fiatPerBtc = { USD: '100000', EUR: '90000' };

    expect(fxRateSnapshotFromBtcRate({ btcUsd: 100_000, fiatPerBtc })).toEqual({ fiatPerBtc });
  });

  it('falls back to the dollar price alone for a rate read for USD only', () => {
    expect(fxRateSnapshotFromBtcRate({ btcUsd: 100_000 })).toEqual({ fiatPerBtc: { USD: '100000' } });
    expect(fxRateSnapshotFromBtcRate({ btcUsd: 81_248.5 })).toEqual({ fiatPerBtc: { USD: '81248.5' } });
  });

  it('offers no price for an unusable dollar rate', () => {
    expect(fxRateSnapshotFromBtcRate({ btcUsd: 0 })).toEqual({ fiatPerBtc: {} });
    expect(fxRateSnapshotFromBtcRate({ btcUsd: Number.NaN })).toEqual({ fiatPerBtc: {} });
    expect(fxRateSnapshotFromBtcRate({ btcUsd: Number.POSITIVE_INFINITY })).toEqual({ fiatPerBtc: {} });
  });
});
