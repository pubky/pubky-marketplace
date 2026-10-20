import { Typography } from '@/atoms/Typography/Typography';
import { PRIVATE_SELLER_NOTICE, ROLE_STATEMENT, type SellerDeclaration } from '@/libs/commerce/eu-region';

/** The private-seller notice (legal launch plan C5; CRD Art. 6a(1)(c)), optionally naming whose it is. */
export function PrivateSellerNotice({ sellerName }: { sellerName?: string }) {
  return (
    <Typography as="p" size="xs" className="text-muted-foreground" data-testid="private-seller-notice">
      {sellerName ? `${sellerName}: ` : ''}
      {PRIVATE_SELLER_NOTICE}
    </Typography>
  );
}

/** The role statement (legal launch plan C5; CRD Art. 6a(1)(d)). */
export function RoleStatement() {
  return (
    <Typography as="p" size="xs" className="text-muted-foreground" data-testid="role-statement">
      {ROLE_STATEMENT}
    </Typography>
  );
}

/**
 * The consumer-law lines for one seller (legal launch plan C5): the private-seller notice when the
 * seller declared they sell privately, and the role statement.
 */
export function SellerSaleTerms({ declaration }: { declaration: SellerDeclaration }) {
  return (
    <div className="grid gap-1" data-testid="seller-sale-terms">
      {declaration === 'private' && <PrivateSellerNotice />}
      <RoleStatement />
    </div>
  );
}
