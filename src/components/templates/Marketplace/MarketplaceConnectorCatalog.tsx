'use client';

import { ArrowLeft } from 'lucide-react';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { Container } from '@/atoms/Container/Container';
import { Heading } from '@/atoms/Heading/Heading';
import { Link } from '@/atoms/Link/Link';
import { Skeleton } from '@/atoms/Skeleton/Skeleton';
import { Typography } from '@/atoms/Typography/Typography';
import { useConnectorCatalog } from '@/hooks/useConnectorCatalog/useConnectorCatalog';
import { useStoreConnections } from '@/hooks/useStoreConnections/useStoreConnections';
import { CONNECTOR_PROVIDER_LABELS } from '@/libs/commerce/connectors';
import { ContentLayout } from '@/organisms/ContentLayout/ContentLayout';
import { MarketplaceConnectorCatalogPicker } from '@/organisms/Marketplace/MarketplaceConnectorCatalogPicker';
import { MarketplaceSectionNav } from '@/organisms/Marketplace/MarketplaceSectionNav';
import { MarketplaceSessionRequiredCard } from '@/organisms/Marketplace/MarketplaceSessionRequiredCard';

/** Settings, Store connections, one store: choose the products to also publish on Pubky. */
export function MarketplaceConnectorCatalog({ connectionId }: { connectionId: string }) {
  const connections = useStoreConnections();
  const connection = connections.connections.find((entry) => entry.id === connectionId) ?? null;
  const catalog = useConnectorCatalog(connection);

  return (
    <ContentLayout
      showLeftSidebar={false}
      showRightSidebar={false}
      showLeftMobileButton={false}
      showRightMobileButton={false}
      className="pb-28"
    >
      <Container overrideDefaults className="flex w-full flex-col gap-6">
        <MarketplaceSectionNav />
        <Link
          href={MARKETPLACE_ROUTES.SETTINGS_STORE_CONNECTIONS}
          overrideDefaults
          className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Store connections
        </Link>
        <div>
          <Heading level={1} size="xl" className="text-4xl sm:text-6xl">
            Store products
          </Heading>
          <Typography as="p" className="mt-2 text-muted-foreground">
            {connection
              ? `Choose which products of ${connection.domain} (${CONNECTOR_PROVIDER_LABELS[connection.provider]}) to also publish on Pubky.`
              : 'Choose which products of your store to also publish on Pubky.'}
          </Typography>
        </div>
        {connections.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : connections.needsSession || catalog.needsSession ? (
          <MarketplaceSessionRequiredCard
            intent="sell"
            onConnected={async () => {
              await connections.refresh();
              await catalog.reload();
            }}
          />
        ) : !connection ? (
          <div role="alert" className="rounded-md border border-destructive/40 p-4 text-sm">
            {connections.error ?? 'This store connection was not found. Go back to Store connections.'}
          </div>
        ) : catalog.error ? (
          <div role="alert" className="rounded-md border border-destructive/40 p-4 text-sm">
            {catalog.error}
          </div>
        ) : (
          <MarketplaceConnectorCatalogPicker catalog={catalog} />
        )}
      </Container>
    </ContentLayout>
  );
}
