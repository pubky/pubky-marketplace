import type { ListingCurrencyCode } from '@/config/currencies';
import type { MeasurementSystem } from '@/libs/commerce/units';

export interface MarketplaceDisplayState {
  /**
   * The buyer's preferred currency for the converted hint beside a listing price.
   * Indicative only: prices themselves always show in the listing currency.
   */
  displayCurrency: ListingCurrencyCode;
  /** Show the approximate converted hint beside listing prices. */
  showFxEstimate: boolean;
  /** Chosen measurement system; `null` means follow the browser locale (en-US → imperial, else metric). */
  measurementSystem: MeasurementSystem | null;
}

export interface MarketplaceDisplayActions {
  setDisplayCurrency: (currency: ListingCurrencyCode) => void;
  setShowFxEstimate: (showFxEstimate: boolean) => void;
  setMeasurementSystem: (measurementSystem: MeasurementSystem | null) => void;
}

export type MarketplaceDisplayStore = MarketplaceDisplayState & MarketplaceDisplayActions;

export const marketplaceDisplayInitialState: MarketplaceDisplayState = {
  displayCurrency: 'USD',
  showFxEstimate: true,
  measurementSystem: null,
};

export enum MarketplaceDisplayActionTypes {
  SET_SHOW_FX_ESTIMATE = 'marketplaceDisplay/setShowFxEstimate',
  SET_MEASUREMENT_SYSTEM = 'marketplaceDisplay/setMeasurementSystem',
}
