import { DEFAULT_IMPORT_SETTINGS, type ImportSettings } from '@/pipes/commerce/import-settings';

/** Import settings with shipping and ships-from chosen: what the dry run holds once the seller has answered both. */
export const IMPORT_SETTINGS_COMPLETE: ImportSettings = {
  ...DEFAULT_IMPORT_SETTINGS,
  countryCode: 'US',
  shipping: { mode: 'free', minDays: 3, maxDays: 10 },
};

/** Host overrides under which both of the sell composer's publish gates pass. */
export const IMPORT_GATES_PASSING = {
  loadPaymentConfig: async () => ({ bitcoinAvailable: true, bitcoinOfferAvailable: true, paypalAvailable: false }),
  loadDeliveryKeyPublication: async () => 'matches' as const,
  loadShop: async () => null,
};
