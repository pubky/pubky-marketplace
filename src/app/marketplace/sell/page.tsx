import { gatedMarketplaceMetadata } from '@/app/marketplace/gated-metadata';
import { MARKETPLACE_ROUTES } from '@/app/routes';

export { MarketplaceSell as default } from '@/templates/Marketplace/MarketplaceSell';

export function generateMetadata() {
  return gatedMarketplaceMetadata('Sell | Pubky Market', 'Create a listing on Pubky Market.', MARKETPLACE_ROUTES.SELL);
}
