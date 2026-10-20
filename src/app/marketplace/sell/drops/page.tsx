import { gatedMarketplaceMetadata } from '@/app/marketplace/gated-metadata';
import { MARKETPLACE_ROUTES } from '@/app/routes';

export { DropStudioHome as default } from '@/organisms/Marketplace/DropStudioHome';

export function generateMetadata() {
  return gatedMarketplaceMetadata(
    'Drops | Pubky Market',
    'Compose and run timed, limited releases on Pubky Market.',
    MARKETPLACE_ROUTES.SELL_DROPS,
  );
}
