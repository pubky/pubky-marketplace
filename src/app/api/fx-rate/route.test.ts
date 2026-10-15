import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LISTING_FIAT_CURRENCY_CODES } from '@/config/currencies';
import { getExchangeRateApi } from '@/config/network';
import { HttpStatusCode } from '@/libs/http/http.types';
import { asOpaque } from '@/test-utils/type-assertions';
import { GET } from './route';

const mockFetch = vi.fn();

function ticker(code: string, lastPrice: string) {
  return {
    symbol: `BTC${code}`,
    lastPrice,
    base: 'BTC',
    baseName: 'Bitcoin',
    quote: code,
    quoteName: code,
    currencySymbol: '$',
    currencyFlag: '',
    lastUpdatedAt: 1_792_057_204_198,
  };
}

const FEED = { tickers: [...LISTING_FIAT_CURRENCY_CODES, 'SEK'].map((code) => ticker(code, '81248')) };

describe('API Route: /api/fx-rate', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', asOpaque<typeof fetch>(mockFetch));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it('reads the Blocktank bitcoin rate feed', async () => {
    mockFetch.mockResolvedValue(Response.json(FEED));

    await GET();

    expect(getExchangeRateApi()).toBe('https://api1.blocktank.to/api/fx/rates/btc');
    expect(mockFetch).toHaveBeenCalledWith('https://api1.blocktank.to/api/fx/rates/btc', { method: 'GET' });
  });

  it('re-serves the feed verbatim, with a ticker for every listing currency', async () => {
    mockFetch.mockResolvedValue(Response.json(FEED));

    const response = await GET();
    const body = (await response.json()) as typeof FEED;

    expect(response.status).toBe(HttpStatusCode.OK);
    expect(body).toEqual(FEED);
    for (const code of LISTING_FIAT_CURRENCY_CODES) {
      expect(body.tickers.map((entry) => entry.symbol)).toContain(`BTC${code}`);
    }
  });

  it('lets the CDN cache the indicative rate for five minutes', async () => {
    mockFetch.mockResolvedValue(Response.json(FEED));

    const response = await GET();

    expect(response.headers.get('Cache-Control')).toBe('public, s-maxage=300, stale-while-revalidate=600');
  });

  it('answers with an error status, not a rate, when the feed is down', async () => {
    mockFetch.mockResolvedValue(new Response('down', { status: 503, statusText: 'Service Unavailable' }));

    const response = await GET();

    expect(response.ok).toBe(false);
    expect(response.headers.get('Cache-Control')).toBeNull();
  });
});
