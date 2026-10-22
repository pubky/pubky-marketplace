import { gatedMarketplaceMetadata } from '@/app/marketplace/gated-metadata';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { SellingUnavailableGate } from '@/organisms/Marketplace/SellingUnavailableGate';
import { MarketplaceMyShop } from '@/templates/Marketplace/MarketplaceMyShop';

export function generateMetadata() {
  return gatedMarketplaceMetadata(
    'Storefront | Pubky Market',
    'Manage your storefront on Pubky Market.',
    MARKETPLACE_ROUTES.MY_SHOP,
  );
}

export default function MarketplaceStorefrontPage() {
  return (
    <SellingUnavailableGate byShopCountry={false}>
      <MarketplaceMyShop />
    </SellingUnavailableGate>
  );
}
