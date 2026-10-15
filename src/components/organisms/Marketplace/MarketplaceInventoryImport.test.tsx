import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  IMPORT_SETTINGS_FIELDS,
  type ImportSettingsFormData,
  importSettingsFormDefaults,
} from '@/hooks/useMarketplaceInventoryImport/useMarketplaceInventoryImport.types';
import {
  type ImportLossReport,
  type ImportSourceFormat,
  summarizeLossReport,
} from '@/pipes/commerce/import-loss-report';
import { MarketplaceInventoryImport, type MarketplaceInventoryImportProps } from './MarketplaceInventoryImport';

const REPORT: ImportLossReport = {
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
      code: 'stock_unmanaged',
      severity: 'changed',
      source: 'Stock',
      detail: 'In stock without a count, so stock is set to 1.',
      listing: 'Beanie',
      count: 21,
    },
    { code: 'tax', severity: 'dropped', source: 'Tax status', detail: 'Tax settings are not imported.', count: 23 },
  ],
};

type HarnessProps = {
  format?: ImportSourceFormat;
  withReport?: boolean;
  counts?: MarketplaceInventoryImportProps['counts'];
  defaults?: Partial<ImportSettingsFormData>;
  onApply?: () => void;
  onPublish?: () => void;
  onDownloadLossReport?: () => void;
  currencyOptions?: readonly string[];
};

function Harness({
  format,
  withReport = true,
  counts = { create: 3, update: 0, end: 0, unchanged: 0, conflict: 0 },
  defaults,
  onApply,
  onPublish,
  onDownloadLossReport,
  currencyOptions = ['USD', 'BTC'],
}: HarnessProps) {
  const form = useForm<ImportSettingsFormData>({ defaultValues: { ...importSettingsFormDefaults, ...defaults } });
  return (
    <MarketplaceInventoryImport
      step={4}
      scene="dry-run"
      fileName="products.csv"
      counts={counts}
      lossSummary={withReport ? summarizeLossReport(REPORT) : undefined}
      settings={
        format
          ? {
              control: form.control,
              currencyOptions,
              conditionOptions: ['new', 'like_new', 'excellent', 'good', 'fair', 'for_parts'],
              format,
              onApply,
            }
          : undefined
      }
      onPublish={onPublish}
      onDownloadLossReport={onDownloadLossReport}
    />
  );
}

beforeAll(() => {
  // Radix Select reads pointer capture and scrolls the active item into view; jsdom has neither.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

describe('MarketplaceInventoryImport upload scene', () => {
  it('invites a WooCommerce or Shopify export as well as the canonical files', () => {
    render(<MarketplaceInventoryImport step={1} scene="upload" />);
    expect(screen.getByText(/WooCommerce or Shopify product export/)).toBeInTheDocument();
    expect(screen.getByLabelText('Import file')).toHaveAttribute('accept', expect.stringContaining('.csv'));
  });
});

describe('MarketplaceInventoryImport dry run with a shop-system export', () => {
  it('shows the detected format, the settings and the loss report', () => {
    render(<Harness format="woocommerce" />);
    const settings = screen.getByTestId('inventory-import-settings');
    expect(within(settings).getByText(/WooCommerce export detected/)).toBeInTheDocument();
    expect(within(settings).getByLabelText('Listing currency')).toBeInTheDocument();
    expect(within(settings).getByLabelText('Condition')).toBeInTheDocument();
    expect(within(settings).getByLabelText('Default shipping')).toBeInTheDocument();
    expect(within(settings).getByLabelText('Default quantity')).toBeInTheDocument();
    expect(within(settings).queryByLabelText('Use CSV quantities as total stock')).not.toBeInTheDocument();

    expect(screen.getByTestId('inventory-import-loss-headline')).toHaveTextContent(
      '16 of 18 listings ready, 2 skipped.',
    );
    const report = screen.getByTestId('inventory-import-loss-report');
    expect(within(report).getByText('Not imported')).toBeInTheDocument();
    expect(within(report).getByText('Product type not supported')).toBeInTheDocument();
    expect(within(report).getByText('e.g. Logo Collection')).toBeInTheDocument();
    expect(within(report).getByText('Stock unknown')).toBeInTheDocument();
    expect(within(report).getByText('Tax settings')).toBeInTheDocument();
  });

  it('shows the quantity switch for Shopify only', () => {
    render(<Harness format="shopify" />);
    const settings = screen.getByTestId('inventory-import-settings');
    expect(within(settings).getByRole('switch', { name: 'Use CSV quantities as total stock' })).toBeInTheDocument();
    expect(within(settings).queryByLabelText('Default quantity')).not.toBeInTheDocument();
    expect(within(settings).getByText(/Shopify export detected/)).toBeInTheDocument();
  });

  it('offers exactly the currencies it is given, so a wider listing enum needs no edit here', async () => {
    const user = userEvent.setup();
    render(<Harness format="woocommerce" currencyOptions={['USD', 'EUR', 'CHF', 'GBP', 'JPY', 'CAD', 'AUD', 'BTC']} />);
    await user.click(screen.getByLabelText('Listing currency'));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['USD', 'EUR', 'CHF', 'GBP', 'JPY', 'CAD', 'AUD', 'BTC']);
  });

  it('asks for a flat rate only when flat shipping is chosen, in the chosen currency', () => {
    const { rerender } = render(<Harness format="woocommerce" />);
    expect(screen.queryByLabelText(/Flat rate/)).not.toBeInTheDocument();
    rerender(
      <Harness
        key="flat"
        format="woocommerce"
        defaults={{ [IMPORT_SETTINGS_FIELDS.SHIPPING_MODE]: 'flat', [IMPORT_SETTINGS_FIELDS.CURRENCY]: 'BTC' }}
      />,
    );
    expect(screen.getByLabelText('Flat rate (BTC)')).toBeInTheDocument();
  });

  it('applies the settings, downloads the report and publishes on request', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onPublish = vi.fn();
    const onDownloadLossReport = vi.fn();
    render(
      <Harness
        format="woocommerce"
        onApply={onApply}
        onPublish={onPublish}
        onDownloadLossReport={onDownloadLossReport}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Apply settings' }));
    await user.click(screen.getByRole('button', { name: 'Download loss report' }));
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onDownloadLossReport).toHaveBeenCalledTimes(1);
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it('says so when nothing was left behind', () => {
    render(
      <MarketplaceInventoryImport
        step={4}
        scene="dry-run"
        counts={{ create: 1, update: 0, end: 0, unchanged: 0, conflict: 0 }}
        lossSummary={summarizeLossReport({ ...REPORT, listingsImported: 18, listingsSkipped: 0, losses: [] })}
      />,
    );
    expect(screen.getByText('Nothing was left behind.')).toBeInTheDocument();
    expect(screen.getByTestId('inventory-import-loss-headline')).toHaveTextContent('18 of 18 listings ready.');
  });

  it('disables Publish when there is nothing to publish', () => {
    render(<Harness format="woocommerce" counts={{ create: 0, update: 0, end: 0, unchanged: 2, conflict: 0 }} />);
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });
});

describe('MarketplaceInventoryImport dry run with a canonical file', () => {
  it('shows neither settings nor a loss report', () => {
    render(<Harness withReport={false} />);
    expect(screen.queryByTestId('inventory-import-settings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('inventory-import-loss-report')).not.toBeInTheDocument();
    expect(screen.getByTestId('inventory-import-dry-run')).toHaveTextContent('Create 3');
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
  });
});

describe('MarketplaceInventoryImport required choices and publish gates', () => {
  it('asks for shipping with a one-click free option, and says why Publish is off', async () => {
    const user = userEvent.setup();
    const onChooseFreeShipping = vi.fn();
    const onPublish = vi.fn();
    function Required() {
      const form = useForm<ImportSettingsFormData>({ defaultValues: importSettingsFormDefaults });
      return (
        <MarketplaceInventoryImport
          step={4}
          scene="dry-run"
          counts={{ create: 3, update: 0, end: 0, unchanged: 0, conflict: 0 }}
          publishDisabledReason="Choose a shipping option and where your listings ship from, then apply the settings."
          onPublish={onPublish}
          settings={{
            control: form.control,
            currencyOptions: ['USD'],
            conditionOptions: ['new'],
            format: 'woocommerce',
            onChooseFreeShipping,
          }}
        />
      );
    }
    render(<Required />);
    expect(screen.getByText('Required. Every imported listing needs a shipping option.')).toBeInTheDocument();
    expect(screen.getByLabelText('Ships from (country code)')).toHaveValue('');
    expect(screen.getByTestId('inventory-import-publish-hint')).toHaveTextContent(/Choose a shipping option and where/);
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Use free shipping (3–10 days)' }));
    expect(onChooseFreeShipping).toHaveBeenCalledTimes(1);
    expect(onPublish).not.toHaveBeenCalled();
  });

  it('hides the free-shipping shortcut once a shipping option is chosen', () => {
    render(<Harness format="woocommerce" defaults={{ shippingMode: 'free', countryCode: 'CH' }} />);
    expect(screen.queryByRole('button', { name: /Use free shipping/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ships from (country code)')).toHaveValue('CH');
  });

  it('shows why listings will be saved paused, and still lets the seller publish', async () => {
    const user = userEvent.setup();
    const onPublish = vi.fn();
    render(
      <MarketplaceInventoryImport
        step={4}
        scene="dry-run"
        counts={{ create: 2, update: 0, end: 0, unchanged: 0, conflict: 0 }}
        publishNotice={{
          title: 'Listings will be saved as paused. Configure a payment method before publishing',
          body: 'Buyers cannot pay for a published listing until you add at least one payment method.',
        }}
        onPublish={onPublish}
      />,
    );
    const notice = screen.getByTestId('inventory-import-gate-notice');
    expect(notice).toHaveTextContent('Listings will be saved as paused.');
    expect(notice).toHaveTextContent('Buyers cannot pay');
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it('lists the listings that stay live with what to fix, and how many more there are', () => {
    render(
      <MarketplaceInventoryImport
        step={4}
        scene="dry-run"
        counts={{ create: 2, update: 6, end: 0, unchanged: 0, conflict: 0 }}
        publishNotice={{
          title: 'New and paused listings will be saved as paused. Configure a payment method before publishing',
          body: 'Buyers cannot pay for a published listing until you add at least one payment method.',
          keptLive: {
            line: 'kept live; fix payment method to keep publishing',
            titles: ['Vintage leather boots', 'Wool hat'],
            total: 4,
          },
        }}
      />,
    );
    const live = screen.getByTestId('inventory-import-kept-live');
    expect(live).toHaveTextContent('4 listings are live: kept live; fix payment method to keep publishing');
    expect(live).toHaveTextContent('Vintage leather boots');
    expect(live).toHaveTextContent('and 2 more');
  });
});
