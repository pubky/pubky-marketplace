import { gatedMarketplaceMetadata } from '@/app/marketplace/gated-metadata';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { DropStudioHome } from '@/organisms/Marketplace/DropStudioHome';
import { SellingUnavailableGate } from '@/organisms/Marketplace/SellingUnavailableGate';

export function generateMetadata() {
  return gatedMarketplaceMetadata(
    'Drops | Pubky Market',
    'Compose and run timed, limited releases on Pubky Market.',
    MARKETPLACE_ROUTES.SELL_DROPS,
  );
}

export default function DropStudioPage() {
  return (
    <SellingUnavailableGate>
      <DropStudioHome />
    </SellingUnavailableGate>
  );
}
