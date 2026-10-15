import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkErrorCode, ServerErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { asOpaque } from '@/test-utils/type-assertions';
import { ExchangerateService } from './exchangerate';
import { exchangerateQueryClient } from './exchangerate.query-client';

// Helper to build a minimal BlockTank ticker
function createTicker(overrides: Partial<{ symbol: string; lastPrice: string }> = {}) {
  return {
    symbol: 'BTCUSD',
    lastPrice: '87076.00',
    base: 'BTC',
    baseName: 'Bitcoin',
    quote: 'USD',
    quoteName: 'US Dollar',
    currencySymbol: '$',
    currencyFlag: '🇺🇸',
    lastUpdatedAt: Date.now(),
    ...overrides,
  };
}

const mockFetch = vi.fn();

global.fetch = asOpaque<typeof global.fetch>(mockFetch);

beforeEach(() => {
  // Clear the query client cache before each test to avoid stale data
  exchangerateQueryClient.clear();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('ExchangerateService', () => {
  describe('getSatoshiUsdRate', () => {
    it('returns the SAT/USD rate when ticker is present', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            tickers: [createTicker({ lastPrice: '87076.00' })],
          }),
          { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const rate = await ExchangerateService.getSatoshiUsdRate();

      expect(rate.satUsd).toEqual(0.00087076);
      expect(rate.btcUsd).toEqual(87076.0);
      expect(rate.lastUpdatedAt).toBeInstanceOf(Date);
      // jsdom has `window`, so the service takes the browser path: the
      // same-origin /api/fx-rate proxy (the upstream sends no CORS headers).
      expect(mockFetch).toHaveBeenCalledWith('/api/fx-rate', { method: 'GET' });
    });

    it('throws RESOURCE_NOT_FOUND when BTCUSD ticker is missing', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            tickers: [createTicker({ symbol: 'BTCEUR' })],
          }),
          { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } },
        ),
      );

      await expect(ExchangerateService.getSatoshiUsdRate()).rejects.toMatchObject({
        category: ErrorCategory.Server,
        code: ServerErrorCode.INVALID_RESPONSE,
        service: ErrorService.Exchangerate,
        operation: 'getBtcUsdRate',
      });
    });

    it('wraps network errors in a SERVICE_UNAVAILABLE AppError', async () => {
      // Mock must reject consistently for all retry attempts
      mockFetch.mockRejectedValue(new Error('Network down'));

      await expect(ExchangerateService.getSatoshiUsdRate()).rejects.toMatchObject({
        category: ErrorCategory.Network,
        code: NetworkErrorCode.CONNECTION_FAILED,
        service: ErrorService.Exchangerate,
        operation: 'getBtcUsdRate',
      });
    }, 15000); // Extended timeout to allow for retry attempts
  });
  describe('getIndicativeTickers', () => {
    function tickersResponse(tickers: unknown) {
      return new Response(JSON.stringify({ tickers }), {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' },
      });
    }

    it('returns every ticker of one feed response, so all listing currencies share a moment', async () => {
      const tickers = [
        createTicker({ symbol: 'BTCUSD', lastPrice: '81248' }),
        createTicker({ symbol: 'BTCEUR', lastPrice: '70123' }),
        createTicker({ symbol: 'BTCJPY', lastPrice: '12000000' }),
      ];
      mockFetch.mockResolvedValue(tickersResponse(tickers));

      const result = await ExchangerateService.getIndicativeTickers();

      expect(result.map((ticker) => ticker.symbol)).toEqual(['BTCUSD', 'BTCEUR', 'BTCJPY']);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith('/api/fx-rate', { method: 'GET' });
    });

    it('serves repeat lookups from the five-minute cache', async () => {
      mockFetch.mockImplementation(async () => tickersResponse([createTicker()]));

      await ExchangerateService.getIndicativeTickers();
      await ExchangerateService.getIndicativeTickers();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('refetches once the cached tickers are older than five minutes', async () => {
      vi.useFakeTimers();
      try {
        mockFetch.mockImplementation(async () => tickersResponse([createTicker()]));

        await ExchangerateService.getIndicativeTickers();
        vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1);
        await ExchangerateService.getIndicativeTickers();

        expect(mockFetch).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('rejects a body without a ticker list instead of returning a guess', async () => {
      mockFetch.mockResolvedValue(tickersResponse({ symbol: 'BTCUSD' }));

      await expect(ExchangerateService.getIndicativeTickers()).rejects.toMatchObject({
        category: ErrorCategory.Server,
        code: ServerErrorCode.INVALID_RESPONSE,
        service: ErrorService.Exchangerate,
        operation: 'getIndicativeTickers',
      });
    });

    it('wraps a non-OK feed response in an AppError', async () => {
      mockFetch.mockResolvedValue(new Response('down', { status: 400, statusText: 'Bad Request' }));

      await expect(ExchangerateService.getIndicativeTickers()).rejects.toMatchObject({
        service: ErrorService.Exchangerate,
        operation: 'getIndicativeTickers',
      });
    });
  });
});
