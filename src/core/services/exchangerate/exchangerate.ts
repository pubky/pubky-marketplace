import { withBasePath } from '@/config/base-path';
import { getExchangeRateApi } from '@/config/network';
import { ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { httpResponseToError, safeFetch } from '@/libs/error/error.http';
import { ErrorService } from '@/libs/error/error.types';
import { HttpMethod } from '@/libs/http/http.types';
import { PARSE_JSON_WITH_BODY_EXCERPT, parseResponseOrThrow } from '@/libs/http/response.utils';
import { exchangerateQueryClient } from './exchangerate.query-client';
import type { BlockTankResponse, BlockTankTicker } from './exchangerate.types';

/**
 * Exchange rate service class.
 * Handles fetching BTC exchange rates (every listing currency) from the Blocktank feed.
 */
export class ExchangerateService {
  private constructor() {} // Prevent instantiation

  /**
   * Fetches the Blocktank `BTC<CCY>` tickers: one quote per currency, all from
   * one response so rates derived from them belong to the same moment.
   *
   * @throws {AppError} If the API request fails or the response has no ticker list
   */
  private static async fetchTickers(operation: string): Promise<BlockTankTicker[]> {
    // Browsers go through the same-origin `/api/fx-rate` proxy: the upstream
    // sends no CORS headers, so a direct browser fetch is blocked on every
    // deployed origin. Server-side callers (and the proxy route itself) hit
    // the configured upstream directly.
    const exchangeRateApi = typeof window === 'undefined' ? getExchangeRateApi() : withBasePath('/api/fx-rate');
    const response = await safeFetch(exchangeRateApi, { method: HttpMethod.GET }, ErrorService.Exchangerate, operation);

    if (!response.ok) {
      throw httpResponseToError(response, ErrorService.Exchangerate, operation, exchangeRateApi);
    }

    const data = await parseResponseOrThrow<BlockTankResponse>(
      response,
      ErrorService.Exchangerate,
      operation,
      exchangeRateApi,
      PARSE_JSON_WITH_BODY_EXCERPT,
    );

    if (!data.tickers || !Array.isArray(data.tickers)) {
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'Invalid response format from exchange rate API', {
        service: ErrorService.Exchangerate,
        operation,
        context: { endpoint: exchangeRateApi },
      });
    }

    return data.tickers;
  }

  /**
   * The Blocktank tickers behind indicative marketplace price estimates, in
   * every listing currency. Refetched when older than five minutes: an "≈"
   * estimate shown beside every listing price should not be half an hour stale.
   *
   * @throws {AppError} If the API request fails or the response is invalid —
   * callers must render NO estimate in that case, never a fallback number.
   */
  static async getIndicativeTickers(): Promise<BlockTankTicker[]> {
    return exchangerateQueryClient.fetchQuery({
      queryKey: ['exchangerate', 'btc-tickers'],
      queryFn: () => ExchangerateService.fetchTickers('getIndicativeTickers'),
      staleTime: 5 * 60 * 1000,
    });
  }
}
