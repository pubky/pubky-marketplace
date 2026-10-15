import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportLossReport } from '@/pipes/commerce/import-loss-report';
import { useMarketplaceInventoryImport } from './useMarketplaceInventoryImport';
import {
  IMPORT_CONDITION_OPTIONS,
  IMPORT_CURRENCY_OPTIONS,
  IMPORT_SETTINGS_FIELDS,
  importSettingsFormDefaults,
  importSettingsFormSchema,
  toImportSettings,
} from './useMarketplaceInventoryImport.types';

const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
  publish: vi.fn(),
  resume: vi.fn(),
  targets: vi.fn(),
  attach: vi.fn(),
  upload: vi.fn(),
  defaults: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    planInventoryImport: (...args: unknown[]) => mocks.plan(...args),
    publishInventoryImport: (...args: unknown[]) => mocks.publish(...args),
    resumeInventoryImport: (...args: unknown[]) => mocks.resume(...args),
    inventoryImportImageTargets: (...args: unknown[]) => mocks.targets(...args),
    attachInventoryImportImages: (...args: unknown[]) => mocks.attach(...args),
    inventoryImportDefaults: (...args: unknown[]) => mocks.defaults(...args),
    confirmInventoryImportConflict: vi.fn(),
    discardInventoryImportConflict: vi.fn(),
    inventoryImportResultCsv: vi.fn(),
    exportInventoryListingsCsv: vi.fn(),
    exportInventoryOrdersJson: vi.fn(),
  },
}));

vi.mock('@/hooks/useImportImageUpload/useImportImageUpload', () => ({
  uploadImportImages: (...args: unknown[]) => mocks.upload(...args),
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({
  toast: (...args: unknown[]) => mocks.toast(...args),
}));

const REPORT: ImportLossReport = {
  format: 'woocommerce',
  listingsRead: 2,
  listingsImported: 1,
  listingsSkipped: 1,
  losses: [
    { code: 'unsupported_type', severity: 'skipped', source: 'Type', detail: 'Grouped', listing: 'Group', count: 1 },
  ],
};

function planned(extra: Record<string, unknown> = {}) {
  return {
    status: 'planned',
    manifestId: 'manifest_1',
    rowCount: 1,
    counts: { create: 1, update: 0, end: 0, unchanged: 0, conflict: 0 },
    format: 'woocommerce',
    lossReport: REPORT,
    publishGate: { reason: null, ships: true },
    ...extra,
  };
}

const FILE = new File(['x'], 'products.csv', { type: 'text/csv' });

describe('import settings form schema', () => {
  it('offers the currencies and conditions of the listing schema', () => {
    expect(IMPORT_CURRENCY_OPTIONS).toEqual(expect.arrayContaining(['USD', 'BTC']));
    expect(IMPORT_CONDITION_OPTIONS).toEqual(['new', 'like_new', 'excellent', 'good', 'fair', 'for_parts']);
  });

  it('starts with no shipping and no ships-from, and refuses to apply until both are chosen', () => {
    const result = importSettingsFormSchema.safeParse(importSettingsFormDefaults);
    expect(result.success).toBe(false);
    const fields = new Set(result.error?.issues.map((issue) => issue.path[0]));
    expect(fields).toEqual(new Set(['countryCode', 'shippingMode']));
    expect(toImportSettings(importSettingsFormDefaults)).toEqual({
      currency: 'USD',
      countryCode: null,
      condition: 'new',
      shipping: null,
      useCsvQuantities: false,
      unmanagedStock: 1,
    });
  });

  it('converts a completed form to importer settings', () => {
    const complete = { ...importSettingsFormDefaults, countryCode: 'ch', shippingMode: 'free' as const };
    expect(importSettingsFormSchema.safeParse(complete).success).toBe(true);
    expect(toImportSettings(complete)).toMatchObject({
      countryCode: 'CH',
      shipping: { mode: 'free', minDays: 3, maxDays: 10 },
    });
  });

  it('requires a flat price in the currency, valid delivery days and a two-letter country', () => {
    const flat = { ...importSettingsFormDefaults, countryCode: 'US', shippingMode: 'flat' as const };
    expect(importSettingsFormSchema.safeParse(flat).success).toBe(false);
    expect(importSettingsFormSchema.safeParse({ ...flat, shippingPrice: '7.90' }).success).toBe(true);
    expect(importSettingsFormSchema.safeParse({ ...flat, shippingPrice: '7.905' }).success).toBe(false);
    expect(importSettingsFormSchema.safeParse({ ...flat, shippingPrice: '0' }).success).toBe(false);
    expect(toImportSettings({ ...flat, shippingPrice: '7.90', countryCode: 'ch' })).toMatchObject({
      countryCode: 'CH',
      shipping: { mode: 'flat', priceMinor: 790 },
    });

    const base = { ...importSettingsFormDefaults, countryCode: 'US', shippingMode: 'free' as const };
    expect(importSettingsFormSchema.safeParse({ ...base, countryCode: 'USA' }).success).toBe(false);
    expect(importSettingsFormSchema.safeParse({ ...base, shippingMinDays: '5', shippingMaxDays: '2' }).success).toBe(
      false,
    );
    expect(importSettingsFormSchema.safeParse({ ...base, unmanagedStock: '0' }).success).toBe(false);
    expect(importSettingsFormSchema.safeParse({ ...base, unmanagedStock: '1000000' }).success).toBe(false);
  });
});

describe('useMarketplaceInventoryImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.plan.mockResolvedValue(planned());
    mocks.targets.mockResolvedValue([]);
    mocks.attach.mockResolvedValue(undefined);
    mocks.defaults.mockResolvedValue({ countryCode: null, shipping: null, currency: null });
  });

  function choose(result: { current: ReturnType<typeof useMarketplaceInventoryImport> }) {
    act(() => {
      result.current.form.setValue(IMPORT_SETTINGS_FIELDS.COUNTRY_CODE, 'CH');
      result.current.form.setValue(IMPORT_SETTINGS_FIELDS.SHIPPING_MODE, 'free');
    });
  }

  it('plans a file with the default settings and exposes the format and loss summary', async () => {
    const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
    await act(async () => {
      await result.current.planFile(FILE);
    });
    expect(mocks.plan).toHaveBeenCalledWith(
      'seller',
      FILE,
      expect.objectContaining({ currency: 'USD', countryCode: null, shipping: null }),
    );
    expect(result.current.scene).toBe('dry-run');
    expect(result.current.format).toBe('woocommerce');
    expect(result.current.lossSummary).toMatchObject({ listingsSkipped: 1, skipped: 1 });
  });

  it('re-plans the same file with changed settings when they are applied', async () => {
    const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
    await act(async () => {
      await result.current.planFile(FILE);
    });
    choose(result);
    act(() => {
      result.current.form.setValue(IMPORT_SETTINGS_FIELDS.CURRENCY, 'BTC');
      result.current.form.setValue(IMPORT_SETTINGS_FIELDS.CONDITION, 'good');
    });
    let applied = false;
    await act(async () => {
      applied = await result.current.applySettings();
    });
    expect(applied).toBe(true);
    expect(mocks.plan).toHaveBeenCalledTimes(2);
    expect(mocks.plan).toHaveBeenLastCalledWith(
      'seller',
      FILE,
      expect.objectContaining({ currency: 'BTC', condition: 'good', countryCode: 'CH', shipping: expect.anything() }),
    );
  });

  it('does not re-plan while the settings are invalid', async () => {
    const { result } = renderHook(() => {
      const hook = useMarketplaceInventoryImport('seller');
      void hook.form.formState.errors;
      return hook;
    });
    await act(async () => {
      await result.current.planFile(FILE);
    });
    act(() => {
      result.current.form.setValue(IMPORT_SETTINGS_FIELDS.SHIPPING_MODE, 'flat');
    });
    let applied = true;
    await act(async () => {
      applied = await result.current.applySettings();
    });
    expect(applied).toBe(false);
    expect(mocks.plan).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.form.formState.errors.shippingPrice).toBeDefined());
  });

  it('shows an error toast and the parse-fail scene when re-planning fails', async () => {
    const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
    await act(async () => {
      await result.current.planFile(FILE);
    });
    choose(result);
    mocks.plan.mockResolvedValue({ status: 'parse-failed', message: 'This file could not be planned.', puts: 0 });
    await act(async () => {
      await result.current.applySettings();
    });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }));
    expect(result.current.scene).toBe('parse-fail');
  });

  it('keeps canonical files free of settings and loss report', async () => {
    mocks.plan.mockResolvedValue(planned({ format: undefined, lossReport: undefined }));
    const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
    await act(async () => {
      await result.current.planFile(FILE);
    });
    expect(result.current.format).toBeUndefined();
    expect(result.current.lossSummary).toBeUndefined();
  });

  it('shows the per-listing failure message after publishing', async () => {
    mocks.publish.mockResolvedValue({
      status: 'complete',
      published: 0,
      synced: 0,
      failed: 2,
      mixed: false,
      message: '1 listing needs a photo before it can be published. Download the result to see which.',
    });
    const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
    await act(async () => {
      await result.current.planFile(FILE);
    });
    await act(async () => {
      await result.current.publish();
    });
    expect(result.current.scene).toBe('result');
    expect(result.current.message).toMatch(/needs a photo/);
  });

  it('resets the form, file and report', async () => {
    const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
    await act(async () => {
      await result.current.planFile(FILE);
    });
    act(() => {
      result.current.form.setValue(IMPORT_SETTINGS_FIELDS.CURRENCY, 'BTC');
      result.current.reset();
    });
    expect(result.current.scene).toBe('upload');
    expect(result.current.format).toBeUndefined();
    expect(result.current.form.getValues(IMPORT_SETTINGS_FIELDS.CURRENCY)).toBe('USD');
    let applied = true;
    await act(async () => {
      applied = await result.current.applySettings();
    });
    expect(applied).toBe(false);
  });

  describe('photo phase', () => {
    const TARGETS = [
      {
        listingId: '7718',
        images: [
          { url: 'https://dezentralshop.ch/wp-content/uploads/2025/12/Socken-I-scaled-1.jpg', alt: 'Socks' },
          { url: 'https://dezentralshop.ch/wp-content/uploads/2025/12/Socken-II-scaled-1.jpg', alt: 'Socks' },
        ],
      },
      {
        listingId: '8106',
        images: [{ url: 'https://dezentralshop.ch/wp-content/uploads/2025/12/Formel.jpg', alt: 'Formel T-Shirt Men' }],
      },
    ];
    const COMPLETE = { status: 'complete', published: 2, synced: 3, failed: 0, mixed: false };

    function uploadResults(urls: string[]) {
      return {
        fetchedBytes: 10,
        results: urls.map((url, index) =>
          index === 1
            ? { url, status: 'failed', reason: 'http_error' }
            : { url, status: 'uploaded', media: { id: `m${index}`, altText: 'x' } },
        ),
      };
    }

    it('uploads between plan and publish with progress, attaches the media, then publishes', async () => {
      const order: string[] = [];
      mocks.targets.mockImplementation(async () => {
        order.push('targets');
        return TARGETS;
      });
      mocks.upload.mockImplementation(
        async (params: { urls: string[]; onProgress: (p: { done: number; total: number }) => void }) => {
          order.push('upload');
          params.onProgress({ done: 1, total: params.urls.length });
          return uploadResults(params.urls);
        },
      );
      mocks.attach.mockImplementation(async () => order.push('attach'));
      mocks.publish.mockImplementation(async () => {
        order.push('publish');
        return COMPLETE;
      });
      const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
      await act(async () => {
        await result.current.planFile(FILE);
      });

      await act(async () => {
        await result.current.publish();
      });

      expect(order).toEqual(['targets', 'upload', 'attach', 'publish']);
      expect(mocks.upload).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerPubky: 'seller',
          urls: TARGETS.flatMap((target) => target.images.map((image) => image.url)),
        }),
      );
      const { altText } = mocks.upload.mock.calls[0]?.[0] as { altText: (url: string) => string };
      expect(altText('https://dezentralshop.ch/wp-content/uploads/2025/12/Formel.jpg')).toBe('Formel T-Shirt Men');
      const [, , outcomes] = mocks.attach.mock.calls[0] as [
        string,
        string,
        { listingId: string; media: unknown[]; results: { status: string }[] }[],
      ];
      expect(outcomes.map((outcome) => [outcome.listingId, outcome.media.length])).toEqual([
        ['7718', 1],
        ['8106', 1],
      ]);
      expect(outcomes[0]?.results.map((entry) => entry.status)).toEqual(['uploaded', 'failed']);
      expect(result.current.scene).toBe('result');
    });

    it('shows photo progress first and then listing progress', async () => {
      let release: () => void = () => undefined;
      mocks.targets.mockResolvedValue(TARGETS);
      mocks.upload.mockImplementation(
        (params: { urls: string[]; onProgress: (p: { done: number; total: number }) => void }) =>
          new Promise((resolveUpload) => {
            params.onProgress({ done: 2, total: params.urls.length });
            release = () => resolveUpload(uploadResults(params.urls));
          }),
      );
      mocks.publish.mockResolvedValue(COMPLETE);
      const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
      await act(async () => {
        await result.current.planFile(FILE);
      });

      let publishing: Promise<void> = Promise.resolve();
      await act(async () => {
        publishing = result.current.publish();
        await Promise.resolve();
      });
      await waitFor(() => expect(result.current.progressPhase).toBe('photos'));
      expect(result.current.scene).toBe('progress');
      expect(result.current.progress).toEqual({ done: 2, total: 3 });

      await act(async () => {
        release();
        await publishing;
      });
      expect(result.current.progressPhase).toBe('listings');
    });

    it('skips the photo phase when no listing needs photos', async () => {
      mocks.publish.mockResolvedValue(COMPLETE);
      const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
      await act(async () => {
        await result.current.planFile(FILE);
      });
      await act(async () => {
        await result.current.publish();
      });
      expect(mocks.upload).not.toHaveBeenCalled();
      expect(mocks.attach).not.toHaveBeenCalled();
      expect(mocks.publish).toHaveBeenCalledTimes(1);
    });

    it('runs the photo phase again on resume, which skips listings that already hold media', async () => {
      mocks.targets.mockResolvedValueOnce(TARGETS).mockResolvedValueOnce([]);
      mocks.upload.mockImplementation(async (params: { urls: string[] }) => uploadResults(params.urls));
      mocks.publish.mockResolvedValue({ ...COMPLETE, mixed: true });
      mocks.resume.mockResolvedValue(COMPLETE);
      const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
      await act(async () => {
        await result.current.planFile(FILE);
      });
      await act(async () => {
        await result.current.publish();
      });
      await act(async () => {
        await result.current.resume();
      });
      expect(mocks.targets).toHaveBeenCalledTimes(2);
      expect(mocks.upload).toHaveBeenCalledTimes(1);
      expect(mocks.resume).toHaveBeenCalledTimes(1);
    });

    it('still publishes, and says so, when the photos cannot be saved', async () => {
      mocks.targets.mockResolvedValue(TARGETS);
      mocks.upload.mockRejectedValue(new Error('disk'));
      mocks.publish.mockResolvedValue(COMPLETE);
      const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
      await act(async () => {
        await result.current.planFile(FILE);
      });
      await act(async () => {
        await result.current.publish();
      });
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }));
      expect(mocks.publish).toHaveBeenCalledTimes(1);
    });

    it('stops without publishing when the dialog closes during the photo phase', async () => {
      mocks.targets.mockResolvedValue(TARGETS);
      mocks.upload.mockImplementation(
        (params: { urls: string[]; signal: AbortSignal }) =>
          new Promise((resolveUpload) => {
            params.signal.addEventListener('abort', () => resolveUpload(uploadResults(params.urls)));
          }),
      );
      const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
      await act(async () => {
        await result.current.planFile(FILE);
      });
      let publishing: Promise<void> = Promise.resolve();
      await act(async () => {
        publishing = result.current.publish();
        await Promise.resolve();
      });
      await act(async () => {
        result.current.reset();
        await publishing;
      });
      expect(mocks.attach).not.toHaveBeenCalled();
      expect(mocks.publish).not.toHaveBeenCalled();
      expect(result.current.scene).toBe('upload');
    });
  });
});

function choose(result: { current: ReturnType<typeof useMarketplaceInventoryImport> }) {
  act(() => {
    result.current.form.setValue(IMPORT_SETTINGS_FIELDS.COUNTRY_CODE, 'CH');
    result.current.form.setValue(IMPORT_SETTINGS_FIELDS.SHIPPING_MODE, 'free');
  });
}

describe('shipping and ships-from (C10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.plan.mockResolvedValue(planned());
    mocks.defaults.mockResolvedValue({ countryCode: null, shipping: null, currency: null });
  });

  it('prefills the country and shipping from the shop and the latest listing, in fields the seller has not touched', async () => {
    mocks.defaults.mockResolvedValue({
      countryCode: 'CH',
      shipping: { mode: 'flat', priceMinor: 790, minDays: 2, maxDays: 4 },
      currency: 'USD',
    });
    const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
    await act(async () => {
      await result.current.planFile(FILE);
    });
    expect(mocks.defaults).toHaveBeenCalledWith('seller');
    expect(result.current.form.getValues()).toMatchObject({
      countryCode: 'CH',
      shippingMode: 'flat',
      shippingPrice: '7.90',
      shippingMinDays: '2',
      shippingMaxDays: '4',
    });
    expect(mocks.plan).toHaveBeenCalledWith(
      'seller',
      FILE,
      expect.objectContaining({
        countryCode: 'CH',
        shipping: { mode: 'flat', priceMinor: 790, minDays: 2, maxDays: 4 },
      }),
    );
    expect(result.current.publishDisabledReason).toBeUndefined();
  });

  it('keeps what the seller already typed, and asks once per import', async () => {
    mocks.defaults.mockResolvedValue({ countryCode: 'CH', shipping: null, currency: null });
    const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
    act(() => {
      result.current.form.setValue(IMPORT_SETTINGS_FIELDS.COUNTRY_CODE, 'DE', { shouldDirty: true });
    });
    await act(async () => {
      await result.current.planFile(FILE);
      await result.current.planFile(FILE);
    });
    expect(result.current.form.getValues('countryCode')).toBe('DE');
    expect(mocks.defaults).toHaveBeenCalledTimes(1);
  });

  it('does not offer a flat price in another currency than the form uses', async () => {
    mocks.defaults.mockResolvedValue({
      countryCode: null,
      shipping: { mode: 'flat', priceMinor: 500, minDays: 1, maxDays: 2 },
      currency: 'CHF',
    });
    const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
    await act(async () => {
      await result.current.planFile(FILE);
    });
    expect(result.current.form.getValues('shippingMode')).toBe('');
  });

  it('requires both choices in the dry run: Publish stays off, with the reason, until they are applied', async () => {
    const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
    await act(async () => {
      await result.current.planFile(FILE);
    });
    expect(result.current.publishDisabledReason).toBe(
      'Choose a shipping option and where your listings ship from, then apply the settings.',
    );

    act(() => {
      result.current.form.setValue(IMPORT_SETTINGS_FIELDS.COUNTRY_CODE, 'CH');
    });
    expect(result.current.publishDisabledReason).toMatch(/shipping option, then apply/);

    choose(result);
    expect(result.current.publishDisabledReason).toBe('Apply your changed settings before publishing.');

    await act(async () => {
      await result.current.applySettings();
    });
    expect(result.current.publishDisabledReason).toBeUndefined();
  });

  it('lets one click choose free shipping and apply, when the country is set', async () => {
    mocks.defaults.mockResolvedValue({ countryCode: 'CH', shipping: null, currency: null });
    const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
    await act(async () => {
      await result.current.planFile(FILE);
    });
    expect(result.current.publishDisabledReason).toMatch(/shipping option, then apply/);
    let applied = false;
    await act(async () => {
      applied = await result.current.chooseFreeShipping();
    });
    expect(applied).toBe(true);
    expect(mocks.plan).toHaveBeenLastCalledWith(
      'seller',
      FILE,
      expect.objectContaining({ shipping: { mode: 'free', minDays: 3, maxDays: 10 }, countryCode: 'CH' }),
    );
    expect(result.current.publishDisabledReason).toBeUndefined();
  });

  it('does not hold a canonical file back for settings it does not use', async () => {
    mocks.plan.mockResolvedValue(planned({ format: undefined, lossReport: undefined }));
    const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
    await act(async () => {
      await result.current.planFile(FILE);
    });
    expect(result.current.publishDisabledReason).toBeUndefined();
  });
});

describe('publish gates (C11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.targets.mockResolvedValue([]);
    mocks.attach.mockResolvedValue(undefined);
    mocks.defaults.mockResolvedValue({
      countryCode: 'CH',
      shipping: { mode: 'free', minDays: 3, maxDays: 10 },
      currency: null,
    });
  });

  it('shows why listings will be saved paused when a gate blocks, and nothing when they pass', async () => {
    mocks.plan.mockResolvedValue(planned({ publishGate: { reason: 'no-method', ships: true } }));
    const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
    await act(async () => {
      await result.current.planFile(FILE);
    });
    expect(result.current.publishNotice?.title).toMatch(
      /^Listings will be saved as paused\. Configure a payment method/,
    );

    mocks.plan.mockResolvedValue(planned({ publishGate: { reason: 'no-delivery-key', ships: true } }));
    await act(async () => {
      await result.current.planFile(FILE);
    });
    expect(result.current.publishNotice?.body).toMatch(/delivery key/);

    mocks.plan.mockResolvedValue(planned());
    await act(async () => {
      await result.current.planFile(FILE);
    });
    expect(result.current.publishNotice).toBeUndefined();
  });

  it('shows the paused count and reason after publishing', async () => {
    mocks.plan.mockResolvedValue(planned({ publishGate: { reason: 'no-method', ships: true } }));
    mocks.publish.mockResolvedValue({
      status: 'complete',
      published: 2,
      synced: 2,
      failed: 0,
      mixed: false,
      paused: 2,
      pausedReason: 'no-method',
      message: '2 listings were saved as paused: no payment method set up.',
    });
    const { result } = renderHook(() => useMarketplaceInventoryImport('seller'));
    await act(async () => {
      await result.current.planFile(FILE);
    });
    await act(async () => {
      await result.current.publish();
    });
    expect(result.current.scene).toBe('result');
    expect(result.current.message).toBe('2 listings were saved as paused: no payment method set up.');
  });
});
