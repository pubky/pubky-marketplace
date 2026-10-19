import { Badge } from '@/atoms/Badge/Badge';
import { SELLER_STATUS_COPY, type SellerDeclaration } from '@/libs/commerce/eu-region';

/** "Private seller" or "Business seller" from the seller's own declaration (legal launch plan C1). */
export function SellerStatusBadge({ declaration }: { declaration: SellerDeclaration }) {
  if (declaration === 'undeclared' || declaration === 'unknown') return null;
  return (
    <Badge variant="outline" data-testid={`seller-status-badge-${declaration}`}>
      {SELLER_STATUS_COPY[declaration].label}
    </Badge>
  );
}
