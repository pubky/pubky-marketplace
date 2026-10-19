'use client';

import { CheckCircle2, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Typography } from '@/atoms/Typography/Typography';
import type { useConnectorCatalogImport } from '@/hooks/useConnectorCatalogImport/useConnectorCatalogImport';
import type { ConnectorConnection } from '@/libs/commerce/connectors';
import { MarketplaceConnectorImportSettings } from './MarketplaceConnectorImportSettings';
import { MarketplaceInventoryImport } from './MarketplaceInventoryImport';
import { MarketplaceInventoryImportLossReport } from './MarketplaceInventoryImportLossReport';

type MarketplaceConnectorImportProps = {
  flow: ReturnType<typeof useConnectorCatalogImport>;
  connection: Pick<ConnectorConnection, 'provider' | 'domain'> & { variantMode?: ConnectorConnection['variantMode'] };
  /** Back to the product list. */
  onBack: () => void;
};

/**
 * Publishing the chosen store products: the settings every product needs, then
 * the Studio's own dry run, publish and result, then the link to the store.
 */
export function MarketplaceConnectorImport({ flow, connection, onBack }: MarketplaceConnectorImportProps) {
  const { importer, stage, linkState } = flow;

  if (stage === 'loading') {
    return (
      <Card className="rounded-md p-0" data-testid="connector-import-loading">
        <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground" role="status">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Reading your chosen products from the store.
        </CardContent>
      </Card>
    );
  }

  if (stage === 'settings') {
    return (
      <MarketplaceConnectorImportSettings
        control={flow.form.control}
        provider={connection.provider}
        domain={connection.domain}
        currency={flow.currency ?? ''}
        productCount={flow.productCount}
        untrackedVariants={flow.untrackedVariants}
        madeToOrderVariants={flow.madeToOrderVariants}
        conditionOptions={importer.conditionOptions}
        variantMode={connection.variantMode ?? 'native'}
        busy={importer.busy}
        onReview={() => void flow.review()}
        onChooseFreeShipping={() => void flow.chooseFreeShipping()}
        onBack={onBack}
      />
    );
  }

  if (stage === 'review') {
    return (
      <Card
        className="rounded-md p-0 shadow-lg"
        data-surface="store-import-review"
        data-testid="connector-import-review"
      >
        <CardContent className="grid gap-4 p-6">
          {flow.nothingToImport ? (
            <>
              <Typography as="p" className="text-sm" role="alert" data-testid="connector-import-nothing">
                None of the chosen products could be listed on Pubky. The report below says why for each one.
              </Typography>
              {importer.lossSummary && (
                <MarketplaceInventoryImportLossReport
                  summary={importer.lossSummary}
                  onDownload={importer.downloadLossReport}
                />
              )}
            </>
          ) : (
            <MarketplaceInventoryImport
              step={importer.step}
              scene={importer.scene}
              fileName={`${connection.domain}, ${flow.productCount} ${flow.productCount === 1 ? 'product' : 'products'}`}
              {...(importer.message ? { message: importer.message } : {})}
              {...(importer.counts ? { counts: importer.counts } : {})}
              {...(importer.progress ? { progress: importer.progress } : {})}
              {...(importer.lossSummary ? { lossSummary: importer.lossSummary } : {})}
              {...(importer.publishNotice ? { publishNotice: importer.publishNotice } : {})}
              {...(importer.publishDisabledReason ? { publishDisabledReason: importer.publishDisabledReason } : {})}
              busy={importer.busy}
              onPublish={() => void flow.publish()}
              onResume={() => void flow.resume()}
              onConfirmConflict={() => void importer.confirmConflict()}
              onDiscardConflict={() => void importer.discardConflict()}
              onDownloadResult={() => void importer.downloadResult()}
              onDownloadLossReport={importer.downloadLossReport}
            />
          )}

          {linkState.status === 'linked' && (
            <div className="flex items-start gap-2 text-sm" role="status" data-testid="connector-import-linked">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
              <Typography as="p">
                {linkState.products} {linkState.products === 1 ? 'product is' : 'products are'} linked to your store. A
                Pubky order for {linkState.products === 1 ? 'it' : 'them'} is created in the store, and the store&apos;s
                stock follows to Pubky.
                {linkState.skipped > 0
                  ? ` ${linkState.skipped} ${linkState.skipped === 1 ? 'listing was' : 'listings were'} not published yet, so ${linkState.skipped === 1 ? 'it is' : 'they are'} not linked. Publish again to link ${linkState.skipped === 1 ? 'it' : 'them'}.`
                  : ''}
              </Typography>
            </div>
          )}
          {linkState.status === 'failed' && (
            <div className="grid gap-2 text-sm" role="alert" data-testid="connector-import-link-failed">
              <Typography as="p">
                The listings are published, but they are not linked to your store yet, so orders for them will not reach
                it. {linkState.message}
              </Typography>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-fit rounded-full"
                onClick={() => void flow.link()}
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                Link again
              </Button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" className="rounded-full" onClick={flow.changeSettings}>
              Change settings
            </Button>
            <Button type="button" variant="secondary" size="sm" className="rounded-full" onClick={onBack}>
              Back to products
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}
