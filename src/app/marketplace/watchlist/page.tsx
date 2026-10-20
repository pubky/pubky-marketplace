import { gatedMarketplaceMetadata } from '@/app/marketplace/gated-metadata';
import { MARKETPLACE_ROUTES } from '@/app/routes';

export { MarketplaceWatchlist as default } from '@/templates/Marketplace/MarketplaceWatchlist';

export function generateMetadata() {
  return gatedMarketplaceMetadata(
    'Watchlist | Pubky Market',
    'Items you are watching on the Pubky Market.',
    MARKETPLACE_ROUTES.WATCHLIST,
  );
}
