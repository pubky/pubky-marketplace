import { zodResolver } from '@hookform/resolvers/zod';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  IMPORT_SETTINGS_FIELDS,
  type ImportSettingsFormData,
  importSettingsFormDefaults,
  type ImportStoreUrlFormData,
  importStoreUrlFormDefaults,
  importStoreUrlFormSchema,
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

function StoreHarness({ onRead }: { onRead: (address: string) => void }) {
  const form = useForm<ImportStoreUrlFormData>({
    resolver: zodResolver(importStoreUrlFormSchema),
    defaultValues: importStoreUrlFormDefaults,
  });
  return (
    <MarketplaceInventoryImport
      step={1}
      scene="upload"
      store={{
        control: form.control,
        onSubmit: () => void form.handleSubmit((values) => onRead(values.storeUrl))(),
      }}
    />
  );
}

describe('MarketplaceInventoryImport reading a WooCommerce store', () => {
  it('offers a store address next to the file upload, with what it reads and what it cannot', () => {
    render(<StoreHarness onRead={vi.fn()} />);
    const section = screen.getByTestId('inventory-import-store');
    expect(within(section).getByText('From a WooCommerce store URL')).toBeInTheDocument();
    expect(within(section).getByText(/public product list, with no keys/)).toBeInTheDocument();
    expect(within(section).getByText(/Stock counts are not public/)).toBeInTheDocument();
    expect(screen.getByLabelText('Import file')).toBeInTheDocument();
    expect(within(section).getByLabelText('Store address')).toHaveAttribute('placeholder', 'https://myshop.com');
  });

  it('is not offered when the host does not provide it', () => {
    render(<MarketplaceInventoryImport step={1} scene="upload" />);
    expect(screen.queryByTestId('inventory-import-store')).not.toBeInTheDocument();
  });

  it('reads the address that was typed, and refuses one that is not a store address with a plain message', async () => {
    const user = userEvent.setup();
    const onRead = vi.fn();
    render(<StoreHarness onRead={onRead} />);
    await user.click(screen.getByRole('button', { name: 'Read my store' }));
    expect(await screen.findByText('Enter the address of your shop.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Store address'), 'http://shop.example.com');
    await user.click(screen.getByRole('button', { name: 'Read my store' }));
    expect(await screen.findByText('Use the https address of your shop, like https://myshop.com.')).toBeInTheDocument();
    expect(onRead).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('Store address'));
    await user.type(screen.getByLabelText('Store address'), 'shop.example.com');
    await user.click(screen.getByRole('button', { name: 'Read my store' }));
    await vi.waitFor(() => expect(onRead).toHaveBeenCalledWith('shop.example.com'));
  });

  it('shows how far the reading has got, for the product list and then for the options', () => {
    const { rerender } = render(
      <MarketplaceInventoryImport
        step={2}
        scene="fetch"
        fileName="shop.example.com"
        progress={{ done: 2, total: 3 }}
      />,
    );
    expect(screen.getByTestId('inventory-import-fetch')).toHaveTextContent(
      'Reading the product list of shop.example.com… 2 of 3.',
    );
    rerender(
      <MarketplaceInventoryImport
        step={2}
        scene="fetch"
        fileName="shop.example.com"
        fetchPhase="variations"
        progress={{ done: 12, total: 30 }}
      />,
    );
    expect(screen.getByTestId('inventory-import-fetch')).toHaveTextContent(
      'Reading product options of shop.example.com… 12 of 30.',
    );
  });

  it('locks the listing currency to the store, and explains the default quantity as the store gives no count', () => {
    render(<Harness format="woocommerce_store" defaults={{ [IMPORT_SETTINGS_FIELDS.CURRENCY]: 'BTC' }} />);
    const settings = screen.getByTestId('inventory-import-settings');
    expect(within(settings).getByText(/WooCommerce store read/)).toBeInTheDocument();
    expect(within(settings).getByLabelText('Listing currency')).toBeDisabled();
    expect(within(settings).getByText(/Set by your store/)).toBeInTheDocument();
    expect(within(settings).getByLabelText('Default quantity')).toBeInTheDocument();
    expect(within(settings).getByText(/A store shares a count only when stock is low/)).toBeInTheDocument();
    expect(within(settings).queryByLabelText('Use CSV quantities as total stock')).not.toBeInTheDocument();
  });

  it('keeps the currency choice open for a file export', () => {
    render(<Harness format="woocommerce" />);
    expect(screen.getByLabelText('Listing currency')).not.toBeDisabled();
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

describe('MarketplaceInventoryImport progress', () => {
  it('names the photo phase and the listing phase', () => {
    const { rerender } = render(
      <MarketplaceInventoryImport step={5} scene="progress" progressPhase="photos" progress={{ done: 3, total: 20 }} />,
    );
    expect(screen.getByTestId('inventory-import-progress')).toHaveTextContent('Loading photos… 3 of 20.');
    rerender(<MarketplaceInventoryImport step={5} scene="progress" progress={{ done: 2, total: 10 }} />);
    expect(screen.getByTestId('inventory-import-progress')).toHaveTextContent('Saving your listings… 2 of 10.');
  });
});

describe('MarketplaceInventoryImport resuming an unfinished import', () => {
  const unfinished = { listings: { done: 120, total: 279 }, photosLeft: 605 };

  it('offers to resume, with the listings done and the photos left, and a way to discard', async () => {
    const user = userEvent.setup();
    const onResume = vi.fn();
    const onDiscard = vi.fn();
    render(
      <MarketplaceInventoryImport
        step={1}
        scene="upload"
        unfinished={unfinished}
        onResumeUnfinished={onResume}
        onDiscardUnfinished={onDiscard}
      />,
    );
    const banner = screen.getByTestId('inventory-import-unfinished');
    expect(banner).toHaveTextContent('Resume your unfinished import (120 of 279 listings, 605 photos left)');
    expect(banner).toHaveTextContent('It carries on where it stopped. Photos already loaded are not loaded again.');
    await user.click(within(banner).getByRole('button', { name: 'Resume' }));
    await user.click(within(banner).getByRole('button', { name: 'Discard' }));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Import file')).toBeInTheDocument();
  });

  it('says one photo in the singular, and leaves the photos out when none are left', () => {
    const { rerender } = render(
      <MarketplaceInventoryImport step={1} scene="upload" unfinished={{ ...unfinished, photosLeft: 1 }} />,
    );
    expect(screen.getByTestId('inventory-import-unfinished')).toHaveTextContent('(120 of 279 listings, 1 photo left)');
    rerender(<MarketplaceInventoryImport step={1} scene="upload" unfinished={{ ...unfinished, photosLeft: 0 }} />);
    expect(screen.getByTestId('inventory-import-unfinished')).toHaveTextContent(
      'Resume your unfinished import (120 of 279 listings)',
    );
    expect(screen.getByTestId('inventory-import-unfinished')).not.toHaveTextContent('left');
  });

  it('is shown on the upload step only, and not at all when there is nothing to resume', () => {
    const { rerender } = render(<MarketplaceInventoryImport step={1} scene="upload" />);
    expect(screen.queryByTestId('inventory-import-unfinished')).not.toBeInTheDocument();
    rerender(
      <MarketplaceInventoryImport
        step={4}
        scene="dry-run"
        counts={{ create: 1, update: 0, end: 0, unchanged: 0, conflict: 0 }}
        unfinished={unfinished}
      />,
    );
    expect(screen.queryByTestId('inventory-import-unfinished')).not.toBeInTheDocument();
  });

  it('cannot be resumed or discarded twice while something is running', () => {
    render(<MarketplaceInventoryImport step={1} scene="upload" unfinished={unfinished} busy />);
    const banner = screen.getByTestId('inventory-import-unfinished');
    expect(within(banner).getByRole('button', { name: 'Resume' })).toBeDisabled();
    expect(within(banner).getByRole('button', { name: 'Discard' })).toBeDisabled();
  });
});

describe('MarketplaceInventoryImport photos in batches', () => {
  const counts = { create: 145, update: 0, end: 0, unchanged: 0, conflict: 0 };

  it('says in the dry run how many photos there are and how many batches they take', () => {
    const { rerender } = render(
      <MarketplaceInventoryImport step={4} scene="dry-run" counts={counts} photoPlan={{ count: 725, batches: 2 }} />,
    );
    const plan = screen.getByTestId('inventory-import-photo-plan');
    expect(plan).toHaveTextContent('725 photos will be loaded when you publish, in 2 batches.');
    expect(plan).toHaveTextContent('carries on by itself');
    expect(plan).toHaveTextContent(
      'If its allowance (150 MB every 10 minutes) runs out, it pauses for up to 10 minutes and continues.',
    );
    expect(plan).toHaveTextContent('If you close this window, the next time you open the import you can resume it.');
    rerender(
      <MarketplaceInventoryImport step={4} scene="dry-run" counts={counts} photoPlan={{ count: 40, batches: 1 }} />,
    );
    expect(screen.getByTestId('inventory-import-photo-plan')).toHaveTextContent(
      '40 photos will be loaded when you publish.',
    );
    expect(screen.getByTestId('inventory-import-photo-plan')).not.toHaveTextContent('batches');
    rerender(
      <MarketplaceInventoryImport step={4} scene="dry-run" counts={counts} photoPlan={{ count: 1, batches: 1 }} />,
    );
    expect(screen.getByTestId('inventory-import-photo-plan')).toHaveTextContent('1 photo will be loaded');
  });

  it('says nothing about photos when there are none to load', () => {
    render(<MarketplaceInventoryImport step={4} scene="dry-run" counts={counts} />);
    expect(screen.queryByTestId('inventory-import-photo-plan')).not.toBeInTheDocument();
  });

  it('shows photos loaded out of all, and the batch, while loading in more than one batch', () => {
    render(
      <MarketplaceInventoryImport
        step={5}
        scene="progress"
        progressPhase="photos"
        progress={{ done: 512, total: 725 }}
        batchInfo={{ batch: 2, batches: 2 }}
      />,
    );
    expect(screen.getByTestId('inventory-import-progress')).toHaveTextContent(
      'Loading photos… 512 of 725, batch 2 of 2.',
    );
    expect(screen.queryByTestId('inventory-import-photo-wait')).not.toBeInTheDocument();
  });

  it('shows that it is waiting for the photo service, with the seconds left, and that loading continues by itself', () => {
    const { rerender } = render(
      <MarketplaceInventoryImport
        step={5}
        scene="progress"
        progressPhase="photos"
        progress={{ done: 500, total: 725 }}
        batchInfo={{ batch: 1, batches: 2 }}
        waitSeconds={45}
      />,
    );
    expect(screen.getByTestId('inventory-import-photo-wait')).toHaveTextContent(
      'Waiting 45 s for the photo service to allow more. Loading continues by itself.',
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(
      <MarketplaceInventoryImport
        step={5}
        scene="progress"
        progressPhase="photos"
        progress={{ done: 500, total: 725 }}
        waitSeconds={null}
      />,
    );
    expect(screen.queryByTestId('inventory-import-photo-wait')).not.toBeInTheDocument();
  });

  it('keeps the plain progress line when there is a single batch, and never shows a wait while saving listings', () => {
    render(
      <MarketplaceInventoryImport step={5} scene="progress" progressPhase="photos" progress={{ done: 3, total: 20 }} />,
    );
    expect(screen.getByTestId('inventory-import-progress')).toHaveTextContent(/^Loading photos… 3 of 20\.$/);
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
