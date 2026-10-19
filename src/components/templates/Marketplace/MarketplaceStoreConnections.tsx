'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Plug } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Container } from '@/atoms/Container/Container';
import { Heading } from '@/atoms/Heading/Heading';
import { Skeleton } from '@/atoms/Skeleton/Skeleton';
import { Typography } from '@/atoms/Typography/Typography';
import { useConnectionStatusCheck } from '@/hooks/useConnectionStatusCheck/useConnectionStatusCheck';
import { useConnectShopify } from '@/hooks/useConnectShopify/useConnectShopify';
import { useConnectWooCommerce } from '@/hooks/useConnectWooCommerce/useConnectWooCommerce';
import { useStoreConnections } from '@/hooks/useStoreConnections/useStoreConnections';
import {
  type ConnectionReturn,
  CONNECTOR_MAX_CONNECTIONS,
  connectorAlertCopy,
  type ConnectorProvider,
  parseConnectionReturn,
  shopifyReturnErrorCopy,
} from '@/libs/commerce/connectors';
import { BackToMyShop } from '@/molecules/Marketplace/BackToMyShop';
import { ContentLayout } from '@/organisms/ContentLayout/ContentLayout';
import { MarketplaceConnectionStatusCheck } from '@/organisms/Marketplace/MarketplaceConnectionStatusCheck';
import { MarketplaceConnectorListingLinks } from '@/organisms/Marketplace/MarketplaceConnectorListingLinks';
import { MarketplaceConnectShopify } from '@/organisms/Marketplace/MarketplaceConnectShopify';
import { MarketplaceConnectWooCommerce } from '@/organisms/Marketplace/MarketplaceConnectWooCommerce';
import { MarketplaceSectionNav } from '@/organisms/Marketplace/MarketplaceSectionNav';
import { MarketplaceSessionRequiredCard } from '@/organisms/Marketplace/MarketplaceSessionRequiredCard';
import { MarketplaceStoreAccessNotes } from '@/organisms/Marketplace/MarketplaceStoreAccessNotes';
import { MarketplaceStoreConnectionList } from '@/organisms/Marketplace/MarketplaceStoreConnectionList';
import { MarketplaceUnmappedListingsNotice } from '@/organisms/Marketplace/MarketplaceUnmappedListingsNotice';
import { useAuthStore } from '@/stores/auth/auth.store';

const PROVIDER_TABS: readonly { id: ConnectorProvider; label: string }[] = [
  { id: 'woocommerce', label: 'WooCommerce' },
  { id: 'shopify', label: 'Shopify' },
];

function returnNoticeCopy(returned: ConnectionReturn | null): string | null {
  if (!returned) return null;
  if (returned.kind === 'error') return shopifyReturnErrorCopy(returned.code);
  return null;
}

/** Settings, Store connections: the seller's WooCommerce and Shopify stores. */
export function MarketplaceStoreConnections() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const connections = useStoreConnections();
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const statusCheck = useConnectionStatusCheck();
  const [returned] = useState<ConnectionReturn | null>(() => parseConnectionReturn(searchParams));
  const [provider, setProvider] = useState<ConnectorProvider>(() => {
    if (returned?.kind === 'connected' || returned?.kind === 'error') return 'shopify';
    return 'woocommerce';
  });
  const handledReturn = useRef(false);

  const checkAndRefresh = async (request: Parameters<typeof statusCheck.run>[0]) => {
    await statusCheck.run(request);
    await connections.refresh();
  };

  const woo = useConnectWooCommerce({
    onKeysSaved: (connectionId) => checkAndRefresh({ connectionId, provider: 'woocommerce', attempts: 1 }),
  });
  const unfinishedShopify =
    connections.connections.find((connection) => connection.provider === 'shopify' && connection.status === 'draft') ??
    null;
  const shopify = useConnectShopify({ resume: unfinishedShopify });

  useEffect(() => {
    if (handledReturn.current || !returned || connections.isLoading || !connections.enabled) return;
    handledReturn.current = true;
    router.replace(pathname);
    if (returned.kind === 'connected') {
      void checkAndRefresh({
        connectionId: returned.connectionId,
        provider: returned.connectionId ? null : 'shopify',
        attempts: 3,
      });
    } else if (returned.kind === 'woo_returned' && returned.approved) {
      void checkAndRefresh({ provider: 'woocommerce', attempts: 5 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returned, connections.isLoading, connections.enabled]);

  const liveCount = connections.connections.length;
  const atLimit = liveCount >= CONNECTOR_MAX_CONNECTIONS;
  const notice = returnNoticeCopy(returned);

  const onCheckShopify = () => {
    const id = shopify.draft?.id;
    void checkAndRefresh({ connectionId: id ?? null, provider: 'shopify', attempts: 3, delayMs: 1_500 });
  };
  const onCheckWoo = () => void checkAndRefresh({ provider: 'woocommerce', attempts: 3, delayMs: 1_500 });

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
        <BackToMyShop />
        <div>
          <Heading level={1} size="xl" className="text-4xl sm:text-6xl">
            Store connections
          </Heading>
          <Typography as="p" className="mt-2 text-muted-foreground">
            Connect your WooCommerce or Shopify store to publish its products on Pubky and receive Pubky orders in it.
          </Typography>
        </div>

        {notice && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 p-4 text-sm"
            data-testid="store-connections-notice"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            {notice}
          </div>
        )}

        {returned?.kind === 'connected' && statusCheck.phase !== 'idle' && !shopify.draft && (
          <Card className="rounded-md p-0 shadow-lg" data-testid="store-connections-return-check">
            <CardContent className="p-6">
              <MarketplaceConnectionStatusCheck
                phase={statusCheck.phase}
                result={statusCheck.result}
                onCheck={() =>
                  void checkAndRefresh({
                    connectionId: returned.connectionId,
                    provider: returned.connectionId ? null : 'shopify',
                  })
                }
                storeLabel={statusCheck.result?.connection?.provider === 'woocommerce' ? 'WooCommerce' : 'Shopify'}
              />
            </CardContent>
          </Card>
        )}

        {connections.lostAlerts.map((alert) => (
          <div
            key={alert.id}
            role="alert"
            className="flex flex-col gap-3 rounded-md border border-destructive/40 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
            data-testid="store-connections-lost"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              {connectorAlertCopy(alert.kind)} Connect the store again below to resume.
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="shrink-0 rounded-full"
              onClick={() => void connections.dismissLostAlert(alert.id)}
            >
              Dismiss
            </Button>
          </div>
        ))}

        {connections.unmapped && (
          <MarketplaceUnmappedListingsNotice
            notice={connections.unmapped}
            sellerPubky={currentUserPubky}
            onDismiss={connections.dismissUnmapped}
          />
        )}

        {connections.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : connections.needsSession ? (
          <MarketplaceSessionRequiredCard intent="sell" onConnected={connections.refresh} />
        ) : !connections.enabled ? (
          <Card className="rounded-md p-0">
            <CardContent className="p-6 text-sm text-muted-foreground">
              Store connections need your Pubky shop to be signed in to the live marketplace.
            </CardContent>
          </Card>
        ) : connections.unavailable ? (
          <Card className="rounded-md p-0" data-testid="store-connections-unavailable">
            <CardContent className="flex items-start gap-3 p-6">
              <Plug className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="grid gap-1">
                <Heading level={2} size="md">
                  Not available on this server yet
                </Heading>
                <Typography as="p" className="text-sm text-muted-foreground">
                  {connections.error} Nothing is wrong with your shop. Connecting a store will work here as soon as the
                  server supports it.
                </Typography>
              </div>
            </CardContent>
          </Card>
        ) : connections.error ? (
          <div role="alert" className="rounded-md border border-destructive/40 p-4 text-sm">
            {connections.error}
          </div>
        ) : (
          <>
            {connections.rows.length > 0 ? (
              <>
                <MarketplaceStoreConnectionList
                  rows={connections.rows}
                  workingId={connections.workingId}
                  onDisconnect={connections.disconnect}
                  onVariantMode={connections.setVariantMode}
                  onReplaced={(connection) =>
                    checkAndRefresh({ connectionId: connection.id, provider: connection.provider, attempts: 1 })
                  }
                />
                {connections.rows
                  .filter((row) => row.health.state !== 'disconnected')
                  .map((row) => (
                    <MarketplaceConnectorListingLinks key={row.connection.id} connection={row.connection} />
                  ))}
              </>
            ) : (
              <Card className="rounded-md p-0" data-testid="store-connections-empty">
                <CardContent className="flex min-h-32 flex-col items-center justify-center gap-1 p-6 text-center">
                  <Plug className="mb-2 size-8 text-muted-foreground" aria-hidden="true" />
                  <Heading level={2} size="md">
                    No store connected yet
                  </Heading>
                  <Typography as="p" className="text-sm text-muted-foreground">
                    Connect a store below to choose which of its products to also publish on Pubky.
                  </Typography>
                </CardContent>
              </Card>
            )}

            {atLimit ? (
              <Typography as="p" className="text-sm text-muted-foreground">
                You have {CONNECTOR_MAX_CONNECTIONS} store connections, the most a shop can have. Disconnect one to add
                another.
              </Typography>
            ) : (
              <>
                <div role="tablist" aria-label="Store type" className="flex flex-wrap gap-2">
                  {PROVIDER_TABS.map((tab) => (
                    <Button
                      key={tab.id}
                      type="button"
                      size="sm"
                      variant={provider === tab.id ? 'default' : 'secondary'}
                      role="tab"
                      aria-selected={provider === tab.id}
                      className="rounded-full"
                      onClick={() => setProvider(tab.id)}
                    >
                      {tab.label}
                    </Button>
                  ))}
                </div>
                {provider === 'woocommerce' ? (
                  <MarketplaceConnectWooCommerce
                    woo={woo}
                    statusCheck={statusCheck}
                    onCheck={onCheckWoo}
                    returnNotice={returned?.kind === 'woo_returned' ? { approved: returned.approved } : null}
                  />
                ) : (
                  <MarketplaceConnectShopify shopify={shopify} statusCheck={statusCheck} onCheck={onCheckShopify} />
                )}
                <MarketplaceStoreAccessNotes provider={provider} />
              </>
            )}
          </>
        )}
      </Container>
    </ContentLayout>
  );
}
