// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { describe, expect, it } from 'vitest';
import { expectVrtSurface, renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { MarketplaceConnectorImport } from '@/organisms/Marketplace/MarketplaceConnectorImport';
import type { useConnectorCatalogImport } from '@/hooks/useConnectorCatalogImport/useConnectorCatalogImport';
import {
  IMPORT_CONDITION_OPTIONS,
  type ImportSettingsFormData,
  importSettingsFormDefaults,
  importSettingsFormSchema,
} from '@/hooks/useMarketplaceInventoryImport/useMarketplaceInventoryImport.types';
import { summarizeLossReport } from '@/pipes/commerce/import-loss-report';
import { asOpaque } from '@/test-utils/type-assertions';

type Flow = ReturnType<typeof useConnectorCatalogImport>;

const SUMMARY = summarizeLossReport({
  format: 'woocommerce',
  listingsRead: 5,
  listingsImported: 4,
  listingsSkipped: 1,
  losses: [
    {
      code: 'price_currency',
      severity: 'skipped',
      source: 'Price',
      detail: 'This product is priced in EUR, but the rest of this import is in CHF. Nothing is converted.',
      listing: 'Hodler Tee (EU shop)',
      count: 1,
    },
    {
      code: 'stock_unmanaged',
      severity: 'changed',
      source: 'Stock',
      detail: 'Stock unknown, set to 3.',
      listing: 'Satoshi Notebook, A5, dotted',
      count: 2,
    },
    {
      code: 'category_absent',
      severity: 'changed',
      source: 'Categories',
      detail: 'Your store catalog has no Pubky category, so listings are uncategorized.',
      count: 4,
    },
    {
      code: 'image_not_loaded',
      severity: 'dropped',
      source: 'Images',
      detail: '3 photo links kept for photo import. The photos are not loaded yet.',
      listing: 'The Little Hodler Socks Bundle',
      count: 3,
    },
  ],
});

function Harness({
  flow,
  values = {},
}: {
  flow: Partial<Record<string, unknown>>;
  values?: Partial<ImportSettingsFormData>;
}) {
  const form = useForm<ImportSettingsFormData>({
    resolver: zodResolver(importSettingsFormSchema),
    defaultValues: { ...importSettingsFormDefaults, currency: 'USD', ...values },
    mode: 'onChange',
  });
  const value = asOpaque<Flow>({
    stage: 'settings',
    message: null,
    planning: false,
    nothingToImport: false,
    productCount: 5,
    currency: 'CHF',
    untrackedVariants: 0,
    linkState: { status: 'none' },
    form,
    review: async () => true,
    chooseFreeShipping: async () => true,
    changeSettings: () => {},
    publish: async () => {},
    resume: async () => {},
    link: async () => true,
    ...flow,
    importer: {
      scene: 'dry-run',
      step: 4,
      busy: false,
      counts: { create: 3, update: 1, end: 0, unchanged: 0, conflict: 0 },
      conditionOptions: IMPORT_CONDITION_OPTIONS,
      lossSummary: SUMMARY,
      publishNotice: undefined,
      publishDisabledReason: undefined,
      downloadLossReport: () => {},
      downloadResult: async () => {},
      confirmConflict: async () => {},
      discardConflict: async () => {},
      ...(flow.importer as object | undefined),
    },
  });
  return (
    <main className="w-full py-6">
      <MarketplaceConnectorImport
        flow={value}
        connection={{ provider: 'woocommerce', domain: 'dezentralshop.ch' }}
        onBack={() => {}}
      />
    </main>
  );
}

describe('Publish store products — visual regression', () => {
  it('renders the settings with shipping and ships-from still to choose at desktop viewport', async () => {
    await renderForVRT(<Harness flow={{}} />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(await expectVrtSurface('store-import-settings')).toMatchScreenshot(
      'connector-import-settings-required-desktop',
    );
  });

  it('renders the settings prefilled from the shop with untracked stock at desktop viewport', async () => {
    await renderForVRT(
      <Harness
        flow={{ untrackedVariants: 2 }}
        values={{
          currency: 'USD',
          countryCode: 'CH',
          shippingMode: 'flat',
          shippingPrice: '9.90',
          shippingMinDays: '2',
          shippingMaxDays: '5',
        }}
      />,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true },
    );
    await expect(await expectVrtSurface('store-import-settings')).toMatchScreenshot(
      'connector-import-settings-prefilled-desktop',
    );
  });

  it('renders the settings at mobile viewport', async () => {
    await renderForVRT(<Harness flow={{ untrackedVariants: 2 }} />, {
      viewport: VRT_VIEWPORT_MOBILE,
      disableHover: true,
    });
    await expect(await expectVrtSurface('store-import-settings')).toMatchScreenshot('connector-import-settings-mobile');
  });

  it('renders the dry run with the store loss report at desktop viewport', async () => {
    await renderForVRT(<Harness flow={{ stage: 'review' }} />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(await expectVrtSurface('store-import-review')).toMatchScreenshot('connector-import-review-desktop');
  });

  it('renders the finished import linked to the store at desktop viewport', async () => {
    await renderForVRT(
      <Harness
        flow={{
          stage: 'review',
          linkState: { status: 'linked', products: 4, skipped: 0 },
          importer: {
            scene: 'result',
            step: 6,
            message: 'Import finished.',
            counts: { create: 3, update: 1, end: 0, unchanged: 0, conflict: 0 },
          },
        }}
      />,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true },
    );
    await expect(await expectVrtSurface('store-import-review')).toMatchScreenshot('connector-import-linked-desktop');
  });

  it('renders the dry run at mobile viewport', async () => {
    await renderForVRT(<Harness flow={{ stage: 'review' }} />, { viewport: VRT_VIEWPORT_MOBILE, disableHover: true });
    await expect(await expectVrtSurface('store-import-review')).toMatchScreenshot('connector-import-review-mobile');
  });

  it('renders nothing could be listed with the reasons at desktop viewport', async () => {
    await renderForVRT(<Harness flow={{ stage: 'review', nothingToImport: true }} />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });
    await expect(await expectVrtSurface('store-import-review')).toMatchScreenshot('connector-import-nothing-desktop');
  });
});
