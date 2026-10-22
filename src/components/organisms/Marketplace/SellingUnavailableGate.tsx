'use client';

import { Store } from 'lucide-react';
import type { ReactNode } from 'react';
import { APP_ROUTES } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Container } from '@/atoms/Container/Container';
import { Heading } from '@/atoms/Heading/Heading';
import { Link } from '@/atoms/Link/Link';
import { useSellingAvailability } from '@/hooks/useSellingAvailability/useSellingAvailability';
import { BACK_TO_MARKET_LABEL, COMMERCE_BLOCKED_INFO_LABEL } from '@/libs/commerce/region-modes';
import { InfoHint } from '@/molecules/InfoHint/InfoHint';
import { ContentLayout } from '@/organisms/ContentLayout/ContentLayout';

/**
 * Wraps a seller page (the studio, Sell, drops, store connections, Get paid). Where selling is
 * blocked it shows the one line, the info icon and a way back to the Market instead of the page;
 * everywhere else it renders the page untouched. While the visitor's region is still being read it
 * shows nothing rather than flashing the studio.
 */
export function SellingUnavailableGate({
  children,
  byShopCountry = true,
}: {
  children: ReactNode;
  /** Off for the page where the seller changes the shop country, so a blocked shop country is no dead end. */
  byShopCountry?: boolean;
}) {
  const selling = useSellingAvailability({ byShopCountry });

  if (!selling.held) return <>{children}</>;

  return (
    <ContentLayout
      className="marketplace-surface"
      showLeftSidebar={false}
      showRightSidebar={false}
      showLeftMobileButton={false}
      showRightMobileButton={false}
    >
      {selling.blocked && selling.sellingMessage && selling.info && (
        <Container overrideDefaults className="w-full">
          <Card className="rounded-md p-0" data-testid="selling-unavailable">
            <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
              <Store className="size-10 text-muted-foreground" aria-hidden="true" />
              <div role="status" className="flex items-center gap-2">
                <Heading level={1} size="md">
                  {selling.sellingMessage}
                </Heading>
                <InfoHint label={COMMERCE_BLOCKED_INFO_LABEL}>{selling.info}</InfoHint>
              </div>
              <Button asChild variant="secondary" className="rounded-full">
                <Link href={APP_ROUTES.MARKETPLACE} overrideDefaults>
                  {BACK_TO_MARKET_LABEL}
                </Link>
              </Button>
            </CardContent>
          </Card>
        </Container>
      )}
    </ContentLayout>
  );
}
