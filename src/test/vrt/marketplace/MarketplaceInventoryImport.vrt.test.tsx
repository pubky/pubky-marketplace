// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { describe, expect, it } from 'vitest';
import { renderForVRT, VRT_DENSE_CHROME_SCREENSHOT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { MarketplaceInventoryImport } from '@/organisms/Marketplace/MarketplaceInventoryImport';
import { useForm } from 'react-hook-form';
import {
  importSettingsFormDefaults,
  type ImportSettingsFormData,
} from '@/hooks/useMarketplaceInventoryImport/useMarketplaceInventoryImport.types';
import {
  summarizeLossReport,
  type ImportLossReport,
  type ImportSourceFormat,
} from '@/pipes/commerce/import-loss-report';

const VRT_CURRENCIES = ['USD', 'EUR', 'CHF', 'GBP', 'JPY', 'CAD', 'AUD', 'BTC'] as const;
const VRT_CONDITIONS = ['new', 'like_new', 'excellent', 'good', 'fair', 'for_parts'] as const;

const VRT_WOO_REPORT: ImportLossReport = {
  format: 'woocommerce',
  listingsRead: 18,
  listingsImported: 16,
  listingsSkipped: 2,
  losses: [
    {
      code: 'unsupported_type',
      severity: 'skipped',
      source: 'Type',
      detail: 'Grouped products have no price or stock of their own, so they are not imported.',
      listing: 'Logo Collection',
      count: 1,
    },
    {
      code: 'unsupported_type',
      severity: 'skipped',
      source: 'Type',
      detail: 'Grouped products have no price or stock of their own, so they are not imported.',
      listing: 'WordPress Pennant',
      count: 1,
    },
    {
      code: 'stock_unmanaged',
      severity: 'changed',
      source: 'Stock',
      detail: 'In stock without a count, so stock is set to 1.',
      listing: 'Beanie',
      count: 21,
    },
    {
      code: 'tax',
      severity: 'dropped',
      source: 'Tax status',
      detail: 'Tax settings are not imported. Prices are used as listed.',
      count: 23,
    },
    {
      code: 'image_not_loaded',
      severity: 'dropped',
      source: 'Images',
      detail: '3 photo links kept for photo import. The photos are not loaded yet.',
      listing: 'V-Neck T-Shirt',
      count: 21,
    },
  ],
};

type VrtDryRunPart = 'settings' | 'report';

/** The import dialog is about 512px wide; the desktop scenes mirror that. */
function VrtImportDryRun({
  format,
  part,
  narrow = false,
  defaults,
}: {
  format: ImportSourceFormat;
  part: VrtDryRunPart;
  narrow?: boolean;
  defaults?: Partial<ImportSettingsFormData>;
}) {
  const form = useForm<ImportSettingsFormData>({ defaultValues: { ...importSettingsFormDefaults, ...defaults } });
  return (
    <main className={narrow ? 'w-full py-6' : 'w-full max-w-lg py-6'}>
      <MarketplaceInventoryImport
        step={4}
        scene="dry-run"
        fileName={format === 'woocommerce' ? 'sample_products.csv' : 'products_export.csv'}
        counts={{ create: format === 'woocommerce' ? 21 : 2, update: 0, end: 0, unchanged: 0, conflict: 0 }}
        lossSummary={part === 'report' ? summarizeLossReport(VRT_WOO_REPORT) : undefined}
        publishDisabledReason={
          part === 'settings' && !defaults?.shippingMode
            ? 'Choose a shipping option and where your listings ship from, then apply the settings.'
            : undefined
        }
        settings={
          part === 'settings'
            ? {
                control: form.control,
                currencyOptions: VRT_CURRENCIES,
                conditionOptions: VRT_CONDITIONS,
                format,
                onChooseFreeShipping: () => undefined,
              }
            : undefined
        }
      />
    </main>
  );
}

describe('MarketplaceInventoryImport VRT', () => {
  it('renders the dry-run preview at desktop viewport', async () => {
    const screen = await renderForVRT(
      <main className="w-full py-6">
        <MarketplaceInventoryImport
          step={4}
          scene="dry-run"
          fileName="listings.csv"
          counts={{ create: 3, update: 1, end: 0, unchanged: 2, conflict: 0 }}
        />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-preview-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders publish progress at desktop viewport', async () => {
    const screen = await renderForVRT(
      <main className="w-full py-6">
        <MarketplaceInventoryImport step={5} scene="progress" progress={{ done: 2, total: 10 }} />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-progress-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders a CAS conflict at desktop viewport', async () => {
    const screen = await renderForVRT(
      <main className="w-full py-6">
        <MarketplaceInventoryImport
          step={5}
          scene="conflict"
          message="This listing changed since the plan. Confirm or discard; it will not be overwritten."
        />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-conflict-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders a parse failure at desktop viewport', async () => {
    const screen = await renderForVRT(
      <main className="w-full py-6">
        <MarketplaceInventoryImport
          step={2}
          scene="parse-fail"
          message="This file could not be planned. Nothing was published."
        />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-parse-fail-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders a mixed result at desktop viewport', async () => {
    const screen = await renderForVRT(
      <main className="w-full py-6">
        <MarketplaceInventoryImport
          step={6}
          scene="mixed"
          message="Some listings synced; some did not. Resume publishes only the unfinished rows."
        />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-mixed-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders the dry-run preview at mobile viewport', async () => {
    const screen = await renderForVRT(
      <main className="w-full py-6">
        <MarketplaceInventoryImport
          step={4}
          scene="dry-run"
          fileName="listings.csv"
          counts={{ create: 3, update: 1, end: 0, unchanged: 2, conflict: 0 }}
        />
      </main>,
      { viewport: VRT_VIEWPORT_MOBILE, disableHover: true },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-preview-mobile',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders a dry-run with conflicts at desktop viewport', async () => {
    const screen = await renderForVRT(
      <main className="w-full py-6">
        <MarketplaceInventoryImport
          step={4}
          scene="dry-run"
          fileName="listings.csv"
          counts={{ create: 1, update: 0, end: 0, unchanged: 0, conflict: 2 }}
        />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-dry-run-conflict-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders a dry-run with conflicts at mobile viewport', async () => {
    const screen = await renderForVRT(
      <main className="w-full py-6">
        <MarketplaceInventoryImport
          step={4}
          scene="dry-run"
          fileName="listings.csv"
          counts={{ create: 1, update: 0, end: 0, unchanged: 0, conflict: 2 }}
        />
      </main>,
      { viewport: VRT_VIEWPORT_MOBILE, disableHover: true },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-dry-run-conflict-mobile',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders publish progress at mobile viewport', async () => {
    const screen = await renderForVRT(
      <main className="w-full py-6">
        <MarketplaceInventoryImport step={5} scene="progress" progress={{ done: 2, total: 10 }} />
      </main>,
      { viewport: VRT_VIEWPORT_MOBILE, disableHover: true },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-progress-mobile',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders a CAS conflict at mobile viewport', async () => {
    const screen = await renderForVRT(
      <main className="w-full py-6">
        <MarketplaceInventoryImport
          step={5}
          scene="conflict"
          message="This listing changed since the plan. Confirm or discard; it will not be overwritten."
        />
      </main>,
      { viewport: VRT_VIEWPORT_MOBILE, disableHover: true },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-conflict-mobile',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders a parse failure at mobile viewport', async () => {
    const screen = await renderForVRT(
      <main className="w-full py-6">
        <MarketplaceInventoryImport
          step={2}
          scene="parse-fail"
          message="This file could not be planned. Nothing was published."
        />
      </main>,
      { viewport: VRT_VIEWPORT_MOBILE, disableHover: true },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-parse-fail-mobile',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders the WooCommerce import settings at desktop viewport', async () => {
    const screen = await renderForVRT(<VrtImportDryRun format="woocommerce" part="settings" />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-woo-settings-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders the WooCommerce import settings at mobile viewport', async () => {
    const screen = await renderForVRT(<VrtImportDryRun format="woocommerce" part="settings" narrow />, {
      viewport: VRT_VIEWPORT_MOBILE,
      disableHover: true,
    });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-woo-settings-mobile',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders the Shopify import settings with the stock switch and a flat rate at desktop viewport', async () => {
    const screen = await renderForVRT(
      <VrtImportDryRun
        format="shopify"
        part="settings"
        defaults={{
          currency: 'USD',
          countryCode: 'CH',
          shippingMode: 'flat',
          shippingPrice: '7.90',
          useCsvQuantities: true,
        }}
      />,
      {
        viewport: VRT_VIEWPORT_DESKTOP,
        disableHover: true,
      },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-shopify-settings-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders the Shopify import settings with the stock switch and a flat rate at mobile viewport', async () => {
    const screen = await renderForVRT(
      <VrtImportDryRun
        format="shopify"
        part="settings"
        narrow
        defaults={{
          currency: 'USD',
          countryCode: 'CH',
          shippingMode: 'flat',
          shippingPrice: '7.90',
          useCsvQuantities: true,
        }}
      />,
      {
        viewport: VRT_VIEWPORT_MOBILE,
        disableHover: true,
      },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-shopify-settings-mobile',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders the loss report at desktop viewport', async () => {
    const screen = await renderForVRT(<VrtImportDryRun format="woocommerce" part="report" />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-loss-report-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders the loss report at mobile viewport', async () => {
    const screen = await renderForVRT(<VrtImportDryRun format="woocommerce" part="report" narrow />, {
      viewport: VRT_VIEWPORT_MOBILE,
      disableHover: true,
    });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-loss-report-mobile',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders a result where listings need photos at desktop viewport', async () => {
    const screen = await renderForVRT(
      <main className="w-full max-w-lg py-6">
        <MarketplaceInventoryImport
          step={6}
          scene="result"
          message="14 listings need a photo before they can be published. Download the result to see which."
        />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-photos-needed-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders the paused-listings notice and the required settings hint at desktop viewport', async () => {
    const screen = await renderForVRT(
      <main className="w-full max-w-lg py-6">
        <MarketplaceInventoryImport
          step={4}
          scene="dry-run"
          fileName="sample_products.csv"
          counts={{ create: 21, update: 0, end: 0, unchanged: 0, conflict: 0 }}
          publishNotice={{
            title: 'New and paused listings will be saved as paused. Configure a payment method before publishing',
            body: 'Buyers cannot pay for a published listing until you add at least one payment method.',
            keptLive: {
              line: 'kept live; fix payment method to keep publishing',
              titles: ['Vintage leather boots', 'Wool hat'],
              total: 3,
            },
          }}
          publishDisabledReason="Choose a shipping option and where your listings ship from, then apply the settings."
        />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-gate-notice-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders the paused-listings notice and the required settings hint at mobile viewport', async () => {
    const screen = await renderForVRT(
      <main className="w-full py-6">
        <MarketplaceInventoryImport
          step={4}
          scene="dry-run"
          fileName="sample_products.csv"
          counts={{ create: 21, update: 0, end: 0, unchanged: 0, conflict: 0 }}
          publishNotice={{
            title: 'New and paused listings will be saved as paused. Configure a payment method before publishing',
            body: 'Buyers cannot pay for a published listing until you add at least one payment method.',
            keptLive: {
              line: 'kept live; fix payment method to keep publishing',
              titles: ['Vintage leather boots', 'Wool hat'],
              total: 3,
            },
          }}
          publishDisabledReason="Choose a shipping option and where your listings ship from, then apply the settings."
        />
      </main>,
      { viewport: VRT_VIEWPORT_MOBILE, disableHover: true },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-import-gate-notice-mobile',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });
});
