'use client';

import { useState } from 'react';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { useMarketplaceInventoryImport } from '@/hooks/useMarketplaceInventoryImport/useMarketplaceInventoryImport';
import {
  IMPORT_CURRENCY_OPTIONS,
  IMPORT_SETTINGS_FIELDS,
  type ImportSettingsFormData,
  shippingFormValues,
  toImportSettings,
} from '@/hooks/useMarketplaceInventoryImport/useMarketplaceInventoryImport.types';
import {
  type ConnectorCatalogProduct,
  type ConnectorConnection,
  connectorErrorMessage,
  type VariantMode,
} from '@/libs/commerce/connectors';
import { toast } from '@/molecules/Toaster/use-toast';
import {
  type ConnectorImportLink,
  connectorMappingsFor,
  connectorStoreCurrency,
  mapConnectorCatalog,
} from '@/pipes/commerce/connector-catalog-rows';
import { type ImportLossReport, lossReportToCsv, summarizeLossReport } from '@/pipes/commerce/import-loss-report';
import { useAuthStore } from '@/stores/auth/auth.store';

export type ConnectorImportStage = 'idle' | 'loading' | 'settings' | 'review' | 'blocked';

export type ConnectorLinkState =
  | { status: 'none' }
  | { status: 'linked'; products: number; skipped: number }
  | { status: 'failed'; message: string };

type ImportConnection = Pick<ConnectorConnection, 'id' | 'provider' | 'domain'> & { variantMode?: VariantMode };

const NO_SELECTION = 'Choose at least one product and save your choice first.';
const LOAD_FAILED = 'The chosen products could not be read from your store. Check the connection and try again.';

function download(content: string, type: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Publishes the products the seller chose in a connected store through the
 * Studio's own import: the chosen products become the same canonical rows the
 * CSV presets make, then go through plan, dry-run, publish with
 * `useMarketplaceInventoryImport` unchanged (its photo step, publish gates and
 * result file included). After a publish the listings are linked to the store
 * variants, which is what lets the store's stock reach Pubky and Pubky's orders
 * reach the store.
 */
export function useConnectorCatalogImport(connection: ImportConnection | null) {
  const sellerPubky = useAuthStore((state) => state.currentUserPubky) ?? null;
  const importer = useMarketplaceInventoryImport(sellerPubky);
  const [stage, setStage] = useState<ConnectorImportStage>('idle');
  const [products, setProducts] = useState<readonly ConnectorCatalogProduct[]>([]);
  const [report, setReport] = useState<ImportLossReport | undefined>();
  const [links, setLinks] = useState<readonly ConnectorImportLink[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [linkState, setLinkState] = useState<ConnectorLinkState>({ status: 'none' });
  const [planning, setPlanning] = useState(false);
  const [nothingToImport, setNothingToImport] = useState(false);

  const form = importer.form;
  const currency = connectorStoreCurrency(products);
  const untrackedVariants = products.reduce(
    (total, product) => total + product.variants.filter((variant) => typeof variant.stock !== 'number').length,
    0,
  );

  const prefillFromShop = async (storeCurrency: string) => {
    if (!sellerPubky) return;
    try {
      const defaults = await CommerceController.inventoryImportDefaults(sellerPubky);
      if (defaults.countryCode) form.setValue(IMPORT_SETTINGS_FIELDS.COUNTRY_CODE, defaults.countryCode);
      if (defaults.shipping && (defaults.shipping.mode === 'free' || defaults.currency === storeCurrency)) {
        const values = shippingFormValues(defaults.shipping, storeCurrency);
        form.setValue(IMPORT_SETTINGS_FIELDS.SHIPPING_MODE, values.shippingMode);
        form.setValue(IMPORT_SETTINGS_FIELDS.SHIPPING_PRICE, values.shippingPrice);
        form.setValue(IMPORT_SETTINGS_FIELDS.SHIPPING_MIN_DAYS, values.shippingMinDays);
        form.setValue(IMPORT_SETTINGS_FIELDS.SHIPPING_MAX_DAYS, values.shippingMaxDays);
      }
    } catch {
      // Nothing to prefill: the settings ask for both.
    }
  };

  /** Reads the chosen products and opens the settings. */
  const start = async (): Promise<boolean> => {
    if (!connection || !sellerPubky) return false;
    setStage('loading');
    setMessage(null);
    setLinkState({ status: 'none' });
    setNothingToImport(false);
    try {
      const selected = await ConnectorsController.fetchSelectedProducts(connection.id);
      if (selected.length === 0) {
        setMessage(NO_SELECTION);
        setStage('idle');
        return false;
      }
      const storeCurrency = connectorStoreCurrency(selected);
      if (!storeCurrency || !IMPORT_CURRENCY_OPTIONS.includes(storeCurrency)) {
        setMessage(
          `Your store prices in ${storeCurrency ?? 'a currency'} that Pubky listings do not support yet, so nothing was imported.`,
        );
        setStage('blocked');
        return false;
      }
      importer.reset();
      form.setValue(IMPORT_SETTINGS_FIELDS.CURRENCY, storeCurrency as ImportSettingsFormData['currency']);
      await prefillFromShop(storeCurrency);
      setProducts(selected);
      setStage('settings');
      return true;
    } catch (error) {
      setMessage(connectorErrorMessage(error, LOAD_FAILED));
      setStage('idle');
      return false;
    }
  };

  /** Maps the products with the settings now in the form and plans them; the dry run follows. */
  const review = async (): Promise<boolean> => {
    if (!connection || !sellerPubky) return false;
    if (!(await form.trigger())) return false;
    const settings = toImportSettings(form.getValues());
    const mapped = mapConnectorCatalog({
      products,
      provider: connection.provider,
      sellerPubky,
      settings,
      variantMode: connection.variantMode ?? 'native',
    });
    setReport(mapped.report);
    setLinks(mapped.links);
    setNothingToImport(mapped.rows.length === 0);
    setStage('review');
    if (mapped.rows.length === 0) return false;
    setPlanning(true);
    try {
      const file = new File([JSON.stringify(mapped.rows)], `${connection.domain}.json`, {
        type: 'application/json',
      });
      await importer.planFile(file);
      return true;
    } finally {
      setPlanning(false);
    }
  };

  const chooseFreeShipping = async (): Promise<boolean> => {
    form.setValue(IMPORT_SETTINGS_FIELDS.SHIPPING_MODE, 'free', { shouldDirty: true, shouldValidate: true });
    return review();
  };

  const changeSettings = () => setStage('settings');

  /** Links the listings that were published to the store variants they came from. */
  const link = async (): Promise<boolean> => {
    if (!connection || links.length === 0) return false;
    const additions = connectorMappingsFor(links);
    try {
      const { skippedListingIds } = await ConnectorsController.commitMappings(connection.id, additions);
      const skipped = new Set(skippedListingIds);
      const linkedProducts = new Set(
        links.filter((entry) => !skipped.has(entry.listingId)).map((entry) => entry.providerProductId),
      );
      setLinkState({ status: 'linked', products: linkedProducts.size, skipped: skipped.size });
      return true;
    } catch (error) {
      const failure = connectorErrorMessage(error, 'Try again in a moment.');
      setLinkState({ status: 'failed', message: failure });
      toast({ variant: 'error', title: 'Could not link to your store', description: failure });
      return false;
    }
  };

  // A publish or resume that stops part-way has still synced some listings; they get linked either way.
  const publish = async () => {
    try {
      await importer.publish();
    } finally {
      await link();
    }
  };

  const resume = async () => {
    try {
      await importer.resume();
    } finally {
      await link();
    }
  };

  const downloadReport = () => {
    if (report) download(lossReportToCsv(report), 'text/csv', 'store-import-loss-report.csv');
  };

  return {
    stage,
    message,
    planning,
    nothingToImport,
    productCount: products.length,
    currency,
    untrackedVariants,
    linkState,
    importer: {
      ...importer,
      busy: importer.busy || planning,
      lossSummary: report ? summarizeLossReport(report) : undefined,
      downloadLossReport: downloadReport,
    },
    form,
    start,
    review,
    chooseFreeShipping,
    changeSettings,
    publish,
    resume,
    link,
    reset: () => {
      importer.reset();
      setStage('idle');
      setMessage(null);
      setLinkState({ status: 'none' });
    },
  };
}
