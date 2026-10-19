import { Typography } from '@/atoms/Typography/Typography';
import { PRIVATE_SELLER_NOTICE, ROLE_STATEMENT, type SellerDeclaration } from '@/libs/commerce/eu-region';

/**
 * The consumer-law lines for one seller (legal launch plan C5; CRD Art. 6a(1)(c) and (d)): the
 * private-seller notice when the seller declared they sell privately, and the role statement.
 */
export function SellerSaleTerms({ declaration }: { declaration: SellerDeclaration }) {
  return (
    <div className="grid gap-1" data-testid="seller-sale-terms">
      {declaration === 'private' && (
        <Typography as="p" size="xs" className="text-muted-foreground" data-testid="private-seller-notice">
          {PRIVATE_SELLER_NOTICE}
        </Typography>
      )}
      <Typography as="p" size="xs" className="text-muted-foreground" data-testid="role-statement">
        {ROLE_STATEMENT}
      </Typography>
    </div>
  );
}
