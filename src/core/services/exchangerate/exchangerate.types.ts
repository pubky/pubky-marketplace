import type { ListingFiatCurrencyCode } from '@/config/currencies';

/**
 * BlockTank API response types
 */
export interface BlockTankTicker {
  symbol: string;
  lastPrice: string;
  base: string;
  baseName: string;
  quote: string;
  quoteName: string;
  currencySymbol: string;
  currencyFlag: string;
  lastUpdatedAt: number;
}

export interface BlockTankResponse {
  tickers: BlockTankTicker[];
}

export interface BtcRate {
  /**
   * The current SAT/USD rate
   */
  satUsd: number;
  /**
   * The current BTC/USD rate
   */
  btcUsd: number;
  /**
   * The timestamp of the last update
   */
  lastUpdatedAt: Date;
  /**
   * The price of one bitcoin in each listing currency the feed quoted (USD
   * included), as decimal strings. Absent on a rate read for USD alone; USD is
   * then the only known price.
   */
  fiatPerBtc?: Readonly<Partial<Record<ListingFiatCurrencyCode, string>>>;
}
