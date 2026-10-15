import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { type ConnectorCatalogProduct, connectorCatalogProductSchema } from '@/libs/commerce/connectors';
import { toast } from '@/molecules/Toaster/use-toast';
import { connectorRefusal } from '@/test-utils/connector-errors';
import { useConnectorCatalogImport } from './useConnectorCatalogImport';

const importerFns = vi.hoisted(() => ({
  planFile: vi.fn(async (_file: File) => {}),
  publish: vi.fn(async () => {}),
  resume: vi.fn(async () => {}),
  reset: vi.fn(),
  confirmConflict: vi.fn(),
  discardConflict: vi.fn(),
  downloadResult: vi.fn(),
}));

vi.mock('@/hooks/useMarketplaceInventoryImport/useMarketplaceInventoryImport', async () => {
  const { zodResolver } = await import('@hookform/resolvers/zod');
  const { useForm } = await import('react-hook-form');
  const types = await import('@/hooks/useMarketplaceInventoryImport/useMarketplaceInventoryImport.types');
  return {
    useMarketplaceInventoryImport: () => {
      const form = useForm({
        resolver: zodResolver(types.importSettingsFormSchema),
        defaultValues: types.importSettingsFormDefaults,
        mode: 'onChange',
      });
      return {
        scene: 'upload',
        step: 1,
        busy: false,
        form,
        conditionOptions: types.IMPORT_CONDITION_OPTIONS,
        currencyOptions: types.IMPORT_CURRENCY_OPTIONS,
        ...importerFns,
      };
    },
  };
});

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { inventoryImportDefaults: vi.fn() },
}));

vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: { fetchSelectedProducts: vi.fn(), commitMappings: vi.fn() },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: 'y'.repeat(52) }),
}));

const CONNECTION = { id: 'c1', provider: 'woocommerce' as const, domain: 'dezentralshop.ch' };

function product(id: string, stock: number | null = 5, currency = 'USD'): ConnectorCatalogProduct {
  return connectorCatalogProductSchema.parse({
    providerProductId: id,
    title: `Product ${id}`,
    imageUrls: ['https://dezentralshop.ch/a.jpg'],
    variants: [
      { providerVariantId: `${id}1`, sku: `SKU-${id}`, price: { amountMinor: 2500, currency, exponent: 2 }, stock },
    ],
  });
}

type PlannedRow = {
  listingId: string;
  shippingOptions: unknown[];
  extraFields: Record<string, string>;
  variantQuantity: number;
};

async function planned(): Promise<PlannedRow[]> {
  const file = importerFns.planFile.mock.calls.at(-1)?.[0];
  return JSON.parse((await file?.text()) ?? '[]');
}

describe('useConnectorCatalogImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ConnectorsController.fetchSelectedProducts).mockResolvedValue([product('1'), product('2', null)]);
    vi.mocked(CommerceController.inventoryImportDefaults).mockResolvedValue({
      countryCode: 'CH',
      shipping: { mode: 'flat', priceMinor: 990, minDays: 2, maxDays: 5 },
      currency: 'USD',
    });
  });

  it('reads the chosen products and fills the settings from the shop', async () => {
    const { result } = renderHook(() => useConnectorCatalogImport(CONNECTION));

    await act(async () => {
      expect(await result.current.start()).toBe(true);
    });

    expect(result.current.stage).toBe('settings');
    expect(result.current.productCount).toBe(2);
    expect(result.current.currency).toBe('USD');
    expect(result.current.untrackedVariants).toBe(1);
    expect(result.current.form.getValues()).toMatchObject({
      currency: 'USD',
      countryCode: 'CH',
      shippingMode: 'flat',
      shippingPrice: '9.90',
      shippingMinDays: '2',
      shippingMaxDays: '5',
    });
  });

  it('leaves shipping and ships-from empty when the shop has neither', async () => {
    vi.mocked(CommerceController.inventoryImportDefaults).mockResolvedValue({
      countryCode: null,
      shipping: null,
      currency: null,
    });
    const { result } = renderHook(() => useConnectorCatalogImport(CONNECTION));
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.form.getValues('countryCode')).toBe('');
    expect(result.current.form.getValues('shippingMode')).toBe('');
  });

  it('will not review until shipping and ships-from are chosen, and plans nothing', async () => {
    vi.mocked(CommerceController.inventoryImportDefaults).mockResolvedValue({
      countryCode: null,
      shipping: null,
      currency: null,
    });
    const { result } = renderHook(() => useConnectorCatalogImport(CONNECTION));
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      expect(await result.current.review()).toBe(false);
    });

    expect(importerFns.planFile).not.toHaveBeenCalled();
    expect(result.current.stage).toBe('settings');
    expect(result.current.form.formState.errors).toBeDefined();
  });

  it('plans the chosen products as canonical rows with the chosen settings', async () => {
    const { result } = renderHook(() => useConnectorCatalogImport(CONNECTION));
    await act(async () => {
      await result.current.start();
    });
    act(() => result.current.form.setValue('unmanagedStock', '3'));

    await act(async () => {
      expect(await result.current.review()).toBe(true);
    });

    const rows = await planned();
    expect(rows.map((row) => row.listingId)).toEqual(['woo-1', 'woo-2']);
    expect(rows.every((row) => row.shippingOptions.length === 1)).toBe(true);
    expect(rows.every((row) => row.extraFields.country_code === 'CH')).toBe(true);
    expect(rows[1]?.variantQuantity).toBe(3);
    expect(result.current.stage).toBe('review');
    expect(result.current.importer.lossSummary?.listingsImported).toBe(2);
    expect(importerFns.planFile.mock.calls.at(-1)?.[0]).toBeInstanceOf(File);
  });

  it('plans one listing per store variant when the connection is set to one listing per variant', async () => {
    vi.mocked(ConnectorsController.fetchSelectedProducts).mockResolvedValue([
      connectorCatalogProductSchema.parse({
        providerProductId: '7',
        title: 'Socks',
        variants: [
          {
            providerVariantId: '71',
            optionValues: [{ name: 'Size', value: 'S' }],
            price: { amountMinor: 2500, currency: 'USD', exponent: 2 },
            stock: 3,
          },
          {
            providerVariantId: '72',
            optionValues: [{ name: 'Size', value: 'M' }],
            price: { amountMinor: 2500, currency: 'USD', exponent: 2 },
            stock: 2,
          },
        ],
      }),
    ]);
    const { result } = renderHook(() => useConnectorCatalogImport({ ...CONNECTION, variantMode: 'split' }));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.review();
    });

    const rows = await planned();
    expect(rows.map((row) => row.listingId)).toEqual(['woo-7-71', 'woo-7-72']);

    vi.mocked(ConnectorsController.commitMappings).mockResolvedValue({ mappings: [], skippedListingIds: [] });
    await act(async () => {
      await result.current.publish();
    });
    expect(ConnectorsController.commitMappings).toHaveBeenCalledWith('c1', [
      { listingId: 'woo-7-71', variantId: 'v71', providerProductId: '7', providerVariantId: '71' },
      { listingId: 'woo-7-72', variantId: 'v72', providerProductId: '7', providerVariantId: '72' },
    ]);
  });

  it('keeps one listing per product when the connection is not split', async () => {
    vi.mocked(ConnectorsController.fetchSelectedProducts).mockResolvedValue([
      connectorCatalogProductSchema.parse({
        providerProductId: '7',
        title: 'Socks',
        variants: [
          { providerVariantId: '71', price: { amountMinor: 2500, currency: 'USD', exponent: 2 }, stock: 3 },
          { providerVariantId: '72', price: { amountMinor: 2500, currency: 'USD', exponent: 2 }, stock: 2 },
        ],
      }),
    ]);
    const { result } = renderHook(() => useConnectorCatalogImport({ ...CONNECTION, variantMode: 'native' }));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.review();
    });
    expect(new Set((await planned()).map((row) => row.listingId))).toEqual(new Set(['woo-7']));
  });

  it('uses free shipping in one click', async () => {
    vi.mocked(CommerceController.inventoryImportDefaults).mockResolvedValue({
      countryCode: 'CH',
      shipping: null,
      currency: null,
    });
    const { result } = renderHook(() => useConnectorCatalogImport(CONNECTION));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.form.getValues('shippingMode')).toBe('');

    await act(async () => {
      expect(await result.current.chooseFreeShipping()).toBe(true);
    });

    const rows = await planned();
    expect(rows[0]?.shippingOptions).toEqual([
      { id: 'standard', pricing: 'free', label: 'Free shipping', estimatedMinDays: 3, estimatedMaxDays: 10 },
    ]);
  });

  it('says nothing could be imported instead of planning an empty file', async () => {
    vi.mocked(ConnectorsController.fetchSelectedProducts).mockResolvedValue([
      connectorCatalogProductSchema.parse({
        providerProductId: '1',
        title: 'Free sample',
        variants: [{ providerVariantId: '11', price: { amountMinor: 0, currency: 'USD', exponent: 2 }, stock: 1 }],
      }),
    ]);
    const { result } = renderHook(() => useConnectorCatalogImport(CONNECTION));
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      expect(await result.current.review()).toBe(false);
    });

    expect(result.current.stage).toBe('review');
    expect(result.current.nothingToImport).toBe(true);
    expect(importerFns.planFile).not.toHaveBeenCalled();
    expect(result.current.importer.lossSummary?.groups[0]?.code).toBe('price_zero');
  });

  it('blocks a selection that has no priced variant at all', async () => {
    vi.mocked(ConnectorsController.fetchSelectedProducts).mockResolvedValue([
      connectorCatalogProductSchema.parse({ providerProductId: '3', title: 'Empty', variants: [] }),
    ]);
    const { result } = renderHook(() => useConnectorCatalogImport(CONNECTION));
    await act(async () => {
      expect(await result.current.start()).toBe(false);
    });
    expect(result.current.stage).toBe('blocked');
  });

  it('asks for a choice first when nothing is selected', async () => {
    vi.mocked(ConnectorsController.fetchSelectedProducts).mockResolvedValue([]);
    const { result } = renderHook(() => useConnectorCatalogImport(CONNECTION));
    await act(async () => {
      expect(await result.current.start()).toBe(false);
    });
    expect(result.current.stage).toBe('idle');
    expect(result.current.message).toBe('Choose at least one product and save your choice first.');
  });

  it('refuses a store currency Pubky listings do not support', async () => {
    vi.mocked(ConnectorsController.fetchSelectedProducts).mockResolvedValue([product('1', 5, 'SEK')]);
    const { result } = renderHook(() => useConnectorCatalogImport(CONNECTION));
    await act(async () => {
      expect(await result.current.start()).toBe(false);
    });
    expect(result.current.stage).toBe('blocked');
    expect(result.current.message).toContain('SEK');
  });

  it('says the store could not be read', async () => {
    vi.mocked(ConnectorsController.fetchSelectedProducts).mockRejectedValue(connectorRefusal('credentials_rejected'));
    const { result } = renderHook(() => useConnectorCatalogImport(CONNECTION));
    await act(async () => {
      expect(await result.current.start()).toBe(false);
    });
    expect(result.current.message).toBe('The store did not accept those keys. Check them and try again.');
  });

  describe('after publishing', () => {
    async function reviewed() {
      vi.mocked(ConnectorsController.commitMappings).mockResolvedValue({ mappings: [], skippedListingIds: [] });
      const hook = renderHook(() => useConnectorCatalogImport(CONNECTION));
      await act(async () => {
        await hook.result.current.start();
      });
      await act(async () => {
        await hook.result.current.review();
      });
      return hook;
    }

    it('links the published listings to their store variants', async () => {
      const { result } = await reviewed();

      await act(async () => {
        await result.current.publish();
      });

      expect(importerFns.publish).toHaveBeenCalledTimes(1);
      expect(ConnectorsController.commitMappings).toHaveBeenCalledWith('c1', [
        { listingId: 'woo-1', variantId: 'v11', providerProductId: '1', providerVariantId: '11', sku: 'SKU-1' },
        { listingId: 'woo-2', variantId: 'v21', providerProductId: '2', providerVariantId: '21', sku: 'SKU-2' },
      ]);
      expect(result.current.linkState).toEqual({ status: 'linked', products: 2, skipped: 0 });
    });

    it('links again after resume', async () => {
      const { result } = await reviewed();
      await act(async () => {
        await result.current.resume();
      });
      expect(importerFns.resume).toHaveBeenCalledTimes(1);
      expect(ConnectorsController.commitMappings).toHaveBeenCalledTimes(1);
    });

    it('counts the listings that were not published as not linked', async () => {
      const { result } = await reviewed();
      vi.mocked(ConnectorsController.commitMappings).mockResolvedValue({ mappings: [], skippedListingIds: ['woo-2'] });

      await act(async () => {
        await result.current.publish();
      });

      expect(result.current.linkState).toEqual({ status: 'linked', products: 1, skipped: 1 });
    });

    it('says the listings are published but not linked when the service refuses, and links again on request', async () => {
      const { result } = await reviewed();
      vi.mocked(ConnectorsController.commitMappings).mockRejectedValueOnce(
        connectorRefusal('provider_unavailable', 502),
      );

      await act(async () => {
        await result.current.publish();
      });
      expect(result.current.linkState.status).toBe('failed');
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'error', title: 'Could not link to your store' }),
      );

      await act(async () => {
        expect(await result.current.link()).toBe(true);
      });
      expect(result.current.linkState).toEqual({ status: 'linked', products: 2, skipped: 0 });
    });

    it('goes back to settings and can be reset', async () => {
      const { result } = await reviewed();
      act(() => result.current.changeSettings());
      expect(result.current.stage).toBe('settings');
      act(() => result.current.reset());
      expect(result.current.stage).toBe('idle');
      expect(importerFns.reset).toHaveBeenCalled();
    });
  });
});
