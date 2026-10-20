import { Typography } from '@/atoms/Typography/Typography';
import {
  namedPrivateSellerNotice,
  PRIVATE_SELLER_NOTICE,
  ROLE_STATEMENT,
  SALE_INFO_LABEL,
  SALE_INFO_PRIVATE,
  SALE_INFO_ROLE,
  type SellerDeclaration,
} from '@/libs/commerce/eu-region';
import { InfoHint } from '@/molecules/InfoHint/InfoHint';

/** The private-seller notice at checkout (legal launch plan C5; CRD Art. 6a(1)(c)), optionally naming whose it is. */
export function PrivateSellerNotice({ sellerName }: { sellerName?: string }) {
  return (
    <Typography as="p" size="xs" className="text-muted-foreground" data-testid="private-seller-notice">
      {sellerName ? namedPrivateSellerNotice(sellerName) : PRIVATE_SELLER_NOTICE}
    </Typography>
  );
}

/** The role statement at checkout (legal launch plan C5; CRD Art. 6a(1)(d)). */
export function RoleStatement() {
  return (
    <Typography as="p" size="xs" className="text-muted-foreground" data-testid="role-statement">
      {ROLE_STATEMENT}
    </Typography>
  );
}

/**
 * The consumer-law information for one seller on a listing (legal launch plan C5), behind an info
 * icon next to the seller's badge: the private-seller notice when the seller declared they sell
 * privately, and the role of the marketplace. Checkout keeps both in view next to Pay.
 */
export function SellerSaleTerms({ declaration }: { declaration: SellerDeclaration }) {
  return (
    <InfoHint label={SALE_INFO_LABEL} visibleLabel={SALE_INFO_LABEL} data-testid="seller-sale-terms">
      {declaration === 'private' ? `${SALE_INFO_PRIVATE} ${SALE_INFO_ROLE}` : SALE_INFO_ROLE}
    </InfoHint>
  );
}
