import { act, renderHook, waitFor } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_MAX_RAW_SIZE } from '@/config/images';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { CommerceShopRecord } from '@/libs/commerce/marketplace-records';
import { AppError } from '@/libs/error/error';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { Logger } from '@/libs/logger/logger';
import { asInvalid, asOpaque } from '@/test-utils/type-assertions';
import { sellerStatusConfirmedAtToPublish, useMarketplaceShopSettings } from './useMarketplaceShopSettings';
import { marketplaceShopSettingsSchema } from './useMarketplaceShopSettings.types';

const OWNER = 'y'.repeat(52);
const AVATAR_MEDIA_URL = `pubky://${OWNER}/pub/pubky.app/marketplace/v1/media/avatar_media_id`;
const BANNER_MEDIA_URL = `pubky://${OWNER}/pub/pubky.app/marketplace/v1/media/banner_media_id`;

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) => selector({ currentUserPubky: OWNER }),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getShop: vi.fn(),
    getOrFetchShop: vi.fn(),
    refreshShop: vi.fn(),
    commitUpsertShop: vi.fn(),
    commitCreateMedia: vi.fn(),
  },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/libs/image/stripImageMetadata', () => ({
  stripImageMetadata: vi.fn((file: File) => file),
}));

vi.mock('@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl', async () => {
  return await import('@/test/mocks/marketplace-media-hooks');
});

const publishedShop = {
  schemaVersion: 1 as const,
  recordType: 'shop' as const,
  ownerPubky: OWNER,
  revision: 3,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-10T10:00:00.000Z',
  name: 'Satoshi Vintage',
  bio: 'Independent circular fashion.',
  location: { countryCode: 'US', region: 'NY' },
  shippingPolicy: 'Ships within three business days.',
  returnPolicy: 'Returns accepted within 30 days.',
  vacationMode: false,
  sellerStatus: 'private' as const,
  sellerStatusConfirmedAt: '2026-08-10T10:00:00.000Z',
};

function changeEvent(file: File): ChangeEvent<HTMLInputElement> {
  return asOpaque<ChangeEvent<HTMLInputElement>>({
    target: { files: [file] },
  });
}

function imageFile(name: string, bytes: number[] = [1, 2, 3]): File {
  const file = new File([new Uint8Array(bytes)], name, { type: 'image/png' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: vi.fn(async () => new Uint8Array(bytes).buffer),
  });
  return file;
}

describe('useMarketplaceShopSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const missing = new AppError({
      category: ErrorCategory.Client,
      code: ClientErrorCode.NOT_FOUND,
      message: 'No shop',
      service: ErrorService.Homeserver,
      operation: 'getOwnedResponse',
      context: { statusCode: 404 },
    });
    vi.mocked(CommerceController.getOrFetchShop).mockRejectedValue(missing);
    vi.mocked(CommerceController.refreshShop).mockRejectedValue(missing);
    vi.mocked(CommerceController.getShop).mockResolvedValue(null);
    vi.mocked(CommerceController.commitCreateMedia).mockResolvedValue(AVATAR_MEDIA_URL);
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
        revokeObjectURL: vi.fn(),
      }),
    );
  });

  it('publishes versioned owner-signed shop policies for a first-time seller', async () => {
    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasShop).toBe(false);

    act(() => {
      result.current.form.setValue('name', 'Satoshi Vintage');
      result.current.form.setValue('bio', 'Independent circular fashion.');
      result.current.form.setValue('countryCode', 'ch');
      result.current.form.setValue('shippingPolicy', 'Ships within a week.');
      result.current.form.setValue('returnPolicy', 'Returns within 14 days.');
      result.current.form.setValue('sellerStatus', 'private');
    });

    await act(() => result.current.submit());

    expect(CommerceController.commitUpsertShop).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerPubky: OWNER,
        revision: 1,
        sellerStatus: 'private',
        sellerStatusConfirmedAt: expect.any(String),
        name: 'Satoshi Vintage',
        avatarUrl: undefined,
        bannerUrl: undefined,
        location: { countryCode: 'CH', region: undefined },
        shippingPolicy: 'Ships within a week.',
        returnPolicy: 'Returns within 14 days.',
        vacationMode: false,
      }),
    );
    expect(CommerceController.commitCreateMedia).not.toHaveBeenCalled();
    expect(result.current.hasShop).toBe(true);
  });

  it('refuses to publish a first shop until the seller has chosen a country and written the policies', async () => {
    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.form.getValues()).toMatchObject({ countryCode: '', shippingPolicy: '', returnPolicy: '' });

    act(() => {
      result.current.form.setValue('name', 'Satoshi Vintage');
      result.current.form.setValue('sellerStatus', 'private');
    });
    const succeeded = await act(() => result.current.submit());

    expect(succeeded).toBe(false);
    expect(CommerceController.commitUpsertShop).not.toHaveBeenCalled();
    expect(result.current.form.getFieldState('countryCode').error?.message).toBe('Country is required.');
    expect(result.current.form.getFieldState('shippingPolicy').error?.message).toBe('Shipping policy is required.');
    expect(result.current.form.getFieldState('returnPolicy').error?.message).toBe('Return policy is required.');
  });

  it('edits the published shop record network-first instead of restarting at revision 1', async () => {
    vi.mocked(CommerceController.refreshShop).mockResolvedValue(publishedShop);

    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.hasShop).toBe(true));
    expect(result.current.form.getValues('name')).toBe('Satoshi Vintage');

    await act(() => result.current.submit());

    expect(CommerceController.commitUpsertShop).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 4, createdAt: publishedShop.createdAt }),
    );
  });

  it('does not save a replacement shop after a failed read with no cache and can retry', async () => {
    vi.mocked(CommerceController.refreshShop).mockRejectedValue(new TypeError('offline'));
    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.loadError).toBe(true);
    act(() => result.current.form.setValue('name', 'Replacement shop'));
    await act(async () => expect(await result.current.submit()).toBe(false));
    expect(CommerceController.commitUpsertShop).not.toHaveBeenCalled();
    vi.mocked(CommerceController.refreshShop).mockResolvedValue(publishedShop);
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.loadError).toBe(false);
    expect(result.current.form.getValues('name')).toBe(publishedShop.name);
    expect(result.current.revision).toBe(3);
  });

  it('uses the current published revision even when an older record is cached', async () => {
    vi.mocked(CommerceController.getOrFetchShop).mockResolvedValue({
      ...publishedShop,
      revision: 1,
      name: 'Stale shop',
    });
    vi.mocked(CommerceController.getShop).mockResolvedValue({ record: { ...publishedShop, revision: 1 } } as never);
    vi.mocked(CommerceController.refreshShop).mockResolvedValue(publishedShop);
    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.form.getValues('name')).toBe(publishedShop.name);
    await act(() => result.current.submit());
    expect(CommerceController.commitUpsertShop).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }));
    expect(CommerceController.getOrFetchShop).not.toHaveBeenCalled();
  });

  it('round-trips unedited and unknown record members through a save (open-world records)', async () => {
    // transactionService is a real optional field this form does not edit;
    // futureField stands in for a member added by a newer writer. Both must
    // survive the read-modify-write untouched (social/v1 alignment).
    vi.mocked(CommerceController.refreshShop).mockResolvedValue({
      ...publishedShop,
      transactionService: 'https://service.example',
      futureField: { promo: true },
    } as never);

    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.hasShop).toBe(true));
    await act(() => result.current.submit());

    expect(CommerceController.commitUpsertShop).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionService: 'https://service.example',
        futureField: { promo: true },
        revision: 4,
      }),
    );
  });

  it('publishes the seller-set delivery periods and hydrates them back into the form', async () => {
    vi.mocked(CommerceController.refreshShop).mockResolvedValue({
      ...publishedShop,
      deliveryAssumeDays: 5,
      autoCompleteDays: 30,
    });

    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.hasShop).toBe(true));
    expect(result.current.form.getValues('deliveryAssumeDays')).toBe('5');
    expect(result.current.form.getValues('autoCompleteDays')).toBe('30');

    act(() => {
      result.current.form.setValue('deliveryAssumeDays', '7');
      result.current.form.setValue('autoCompleteDays', ' 21 ');
    });
    await act(() => result.current.submit());

    expect(CommerceController.commitUpsertShop).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryAssumeDays: 7, autoCompleteDays: 21 }),
    );
  });

  it('publishes cleared periods as absent, not as the previously published values', async () => {
    vi.mocked(CommerceController.refreshShop).mockResolvedValue({
      ...publishedShop,
      deliveryAssumeDays: 5,
      autoCompleteDays: 30,
    });

    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.hasShop).toBe(true));
    act(() => {
      result.current.form.setValue('deliveryAssumeDays', '');
      result.current.form.setValue('autoCompleteDays', '');
    });
    await act(() => result.current.submit());

    const published = vi.mocked(CommerceController.commitUpsertShop).mock.calls[0]?.[0] as
      | CommerceShopRecord
      | undefined;
    expect(published?.deliveryAssumeDays).toBeUndefined();
    expect(published?.autoCompleteDays).toBeUndefined();
  });

  it('refuses periods outside 1 to 60 whole days and does not publish', async () => {
    vi.mocked(CommerceController.refreshShop).mockResolvedValue(publishedShop);

    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.hasShop).toBe(true));

    for (const invalid of ['0', '61', '1.5', 'abc', '-3']) {
      act(() => result.current.form.setValue('deliveryAssumeDays', invalid));
      await act(async () => expect(await result.current.submit()).toBe(false));
    }
    act(() => {
      result.current.form.setValue('deliveryAssumeDays', '');
      result.current.form.setValue('autoCompleteDays', '99');
    });
    await act(async () => expect(await result.current.submit()).toBe(false));
    expect(CommerceController.commitUpsertShop).not.toHaveBeenCalled();
    const parsed = marketplaceShopSettingsSchema.safeParse({
      ...result.current.form.getValues(),
      autoCompleteDays: '99',
    });
    expect(parsed.error?.issues[0]?.message).toContain('1 to 60');
  });

  it('publishes no shipsToCountries for a seller who leaves it empty, so the shop keeps shipping anywhere', async () => {
    vi.mocked(CommerceController.refreshShop).mockResolvedValue(publishedShop);
    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.hasShop).toBe(true));
    expect(result.current.form.getValues('shipsToCountries')).toBe('');

    await act(() => result.current.submit());

    const published = vi.mocked(CommerceController.commitUpsertShop).mock.calls[0]?.[0] as CommerceShopRecord;
    expect(published.shipsToCountries).toBeUndefined();
    expect(JSON.parse(JSON.stringify(published))).not.toHaveProperty('shipsToCountries');
  });

  it('publishes the destination countries as normalized codes and hydrates them back', async () => {
    vi.mocked(CommerceController.refreshShop).mockResolvedValue({ ...publishedShop, shipsToCountries: ['CH'] });
    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.hasShop).toBe(true));
    expect(result.current.form.getValues('shipsToCountries')).toBe('CH');

    act(() => result.current.form.setValue('shipsToCountries', ' ch, li li '));
    await act(() => result.current.submit());

    expect(CommerceController.commitUpsertShop).toHaveBeenCalledWith(
      expect.objectContaining({ shipsToCountries: ['CH', 'LI'], shippingPolicy: publishedShop.shippingPolicy }),
    );
  });

  it('publishes an alias as its canonical code, so UK buyers (GB) still match', async () => {
    vi.mocked(CommerceController.refreshShop).mockResolvedValue(publishedShop);
    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.hasShop).toBe(true));

    act(() => result.current.form.setValue('shipsToCountries', 'UK, el'));
    await act(() => result.current.submit());

    expect(CommerceController.commitUpsertShop).toHaveBeenCalledWith(
      expect.objectContaining({ shipsToCountries: ['GB', 'GR'] }),
    );
  });

  it('flags an unusable published list as soon as it loads, so the seller can fix it', async () => {
    vi.mocked(CommerceController.refreshShop).mockResolvedValue({ ...publishedShop, shipsToCountries: ['CHE'] });
    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.hasShop).toBe(true));

    expect(result.current.form.getValues('shipsToCountries')).toBe('CHE');
    await waitFor(() =>
      expect(result.current.form.getFieldState('shipsToCountries').error?.message).toBe(
        'Not a two-letter country code: CHE.',
      ),
    );
    await act(async () => expect(await result.current.submit()).toBe(false));
    expect(CommerceController.commitUpsertShop).not.toHaveBeenCalled();
  });

  it('publishes a cleared destination list as absent', async () => {
    vi.mocked(CommerceController.refreshShop).mockResolvedValue({ ...publishedShop, shipsToCountries: ['CH'] });
    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.hasShop).toBe(true));

    act(() => result.current.form.setValue('shipsToCountries', ''));
    await act(() => result.current.submit());

    const published = vi.mocked(CommerceController.commitUpsertShop).mock.calls[0]?.[0] as CommerceShopRecord;
    expect(published.shipsToCountries).toBeUndefined();
  });

  it('refuses unknown country codes and does not publish', async () => {
    vi.mocked(CommerceController.refreshShop).mockResolvedValue(publishedShop);
    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.hasShop).toBe(true));

    act(() => result.current.form.setValue('shipsToCountries', 'CH, Switzerland'));
    await act(async () => expect(await result.current.submit()).toBe(false));

    expect(result.current.form.getFieldState('shipsToCountries').error?.message).toBe(
      'Not a two-letter country code: SWITZERLAND.',
    );
    expect(CommerceController.commitUpsertShop).not.toHaveBeenCalled();
  });

  it('preserves cached settings but blocks saving when the homeserver is unreachable', async () => {
    vi.mocked(CommerceController.refreshShop).mockRejectedValue(new Error('offline'));
    vi.mocked(CommerceController.getShop).mockResolvedValue({ record: publishedShop } as never);

    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.hasShop).toBe(true));

    expect(result.current.revision).toBe(3);
    expect(result.current.form.getValues('name')).toBe('Satoshi Vintage');
    expect(result.current.loadError).toBe(true);
    await act(async () => expect(await result.current.submit()).toBe(false));
    expect(CommerceController.commitUpsertShop).not.toHaveBeenCalled();
  });

  it('uploads picked avatar and banner images and publishes their marketplace media URIs', async () => {
    vi.mocked(CommerceController.commitCreateMedia)
      .mockResolvedValueOnce(AVATAR_MEDIA_URL)
      .mockResolvedValueOnce(BANNER_MEDIA_URL);

    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.form.setValue('name', 'Satoshi Vintage');
      result.current.form.setValue('countryCode', 'ch');
      result.current.form.setValue('shippingPolicy', 'Ships within a week.');
      result.current.form.setValue('returnPolicy', 'Returns within 14 days.');
      result.current.form.setValue('sellerStatus', 'private');
      result.current.avatar.onInputChange(changeEvent(imageFile('avatar.png', [1, 2, 3])));
      result.current.banner.onInputChange(changeEvent(imageFile('banner.png', [4, 5, 6])));
    });
    expect(result.current.avatar.previewUrl).toBe('blob:avatar.png');
    expect(result.current.banner.previewUrl).toBe('blob:banner.png');

    await act(() => result.current.submit());

    expect(CommerceController.commitCreateMedia).toHaveBeenCalledTimes(2);
    expect(CommerceController.commitCreateMedia).toHaveBeenCalledWith(expect.any(String), new Uint8Array([1, 2, 3]));
    expect(CommerceController.commitCreateMedia).toHaveBeenCalledWith(expect.any(String), new Uint8Array([4, 5, 6]));
    expect(CommerceController.commitUpsertShop).toHaveBeenCalledWith(
      expect.objectContaining({ avatarUrl: AVATAR_MEDIA_URL, bannerUrl: BANNER_MEDIA_URL }),
    );
  });

  it('hydrates published shop images and republishes them without re-uploading bytes', async () => {
    vi.mocked(CommerceController.refreshShop).mockResolvedValue({
      ...publishedShop,
      avatarUrl: AVATAR_MEDIA_URL,
      bannerUrl: BANNER_MEDIA_URL,
    });

    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.hasShop).toBe(true));
    expect(result.current.avatar.previewUrl).toBe(
      `https://homeserver.example/pub/pubky.app/marketplace/v1/media/avatar_media_id?pubky-host=${OWNER}`,
    );
    expect(result.current.banner.previewUrl).toBe(
      `https://homeserver.example/pub/pubky.app/marketplace/v1/media/banner_media_id?pubky-host=${OWNER}`,
    );

    await act(() => result.current.submit());

    expect(CommerceController.commitCreateMedia).not.toHaveBeenCalled();
    expect(CommerceController.commitUpsertShop).toHaveBeenCalledWith(
      expect.objectContaining({ avatarUrl: AVATAR_MEDIA_URL, bannerUrl: BANNER_MEDIA_URL }),
    );
  });

  it('removes a published image so the next revision publishes without the field', async () => {
    vi.mocked(CommerceController.refreshShop).mockResolvedValue({
      ...publishedShop,
      avatarUrl: AVATAR_MEDIA_URL,
      bannerUrl: BANNER_MEDIA_URL,
    });

    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.hasShop).toBe(true));

    act(() => result.current.banner.remove());
    expect(result.current.banner.previewUrl).toBeNull();
    expect(result.current.banner.hasImage).toBe(false);

    await act(() => result.current.submit());

    expect(CommerceController.commitUpsertShop).toHaveBeenCalledWith(
      expect.objectContaining({ avatarUrl: AVATAR_MEDIA_URL, bannerUrl: undefined }),
    );
  });

  it('rejects non-image and oversized files without staging them', async () => {
    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.avatar.onInputChange(changeEvent(new File(['x'], 'notes.txt', { type: 'text/plain' }))));
    expect(result.current.avatar.error).toBe('invalid-type');
    expect(result.current.avatar.hasImage).toBe(false);

    const oversized = imageFile('huge.png');
    Object.defineProperty(oversized, 'size', { value: IMAGE_MAX_RAW_SIZE + 1 });
    act(() => result.current.avatar.onInputChange(changeEvent(oversized)));
    expect(result.current.avatar.error).toBe('too-large');
    expect(result.current.avatar.hasImage).toBe(false);

    act(() => result.current.avatar.onInputChange(changeEvent(imageFile('ok.png'))));
    expect(result.current.avatar.error).toBeNull();
    expect(result.current.avatar.hasImage).toBe(true);
  });

  it('maps thrown sentinel image-upload failures to static copy', async () => {
    const { toast } = await import('@/molecules/Toaster/use-toast');
    const sentinel = 'SENTINEL_SERVER_TEXT_shop_settings';
    vi.mocked(CommerceController.commitCreateMedia).mockRejectedValue({
      name: 'AppError',
      code: 'INVALID_STATE',
      message: sentinel,
    });
    const errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.form.setValue('name', 'Satoshi Vintage');
      result.current.form.setValue('countryCode', 'ch');
      result.current.form.setValue('shippingPolicy', 'Ships within a week.');
      result.current.form.setValue('returnPolicy', 'Returns within 14 days.');
      result.current.form.setValue('sellerStatus', 'private');
      result.current.avatar.onInputChange(changeEvent(imageFile('avatar.png')));
    });

    const succeeded = await act(() => result.current.submit());

    expect(succeeded).toBe(false);
    expect(CommerceController.commitUpsertShop).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      variant: 'error',
      description: expect.stringContaining('Could not upload the shop avatar image'),
    });
    expect(JSON.stringify(vi.mocked(toast).mock.calls)).not.toContain(sentinel);
    expect(JSON.stringify([...errorSpy.mock.calls, ...warnSpy.mock.calls])).not.toContain(sentinel);
    expect(typeof vi.mocked(toast).mock.calls.at(-1)?.[0]?.description).toBe('string');
  });

  describe('seller declaration (legal launch plan C1, C4)', () => {
    it('hydrates the declared status and publishes it back with its original confirmation', async () => {
      vi.mocked(CommerceController.refreshShop).mockResolvedValue(publishedShop);
      const { result } = renderHook(() => useMarketplaceShopSettings());
      await waitFor(() => expect(result.current.hasShop).toBe(true));
      expect(result.current.form.getValues('sellerStatus')).toBe('private');

      await act(() => result.current.submit());
      expect(CommerceController.commitUpsertShop).toHaveBeenCalledWith(
        expect.objectContaining({ sellerStatus: 'private', sellerStatusConfirmedAt: '2026-08-10T10:00:00.000Z' }),
      );
    });

    it('refuses a save with no declaration and does not publish', async () => {
      vi.mocked(CommerceController.refreshShop).mockResolvedValue({
        ...publishedShop,
        sellerStatus: undefined,
        sellerStatusConfirmedAt: undefined,
      });
      const { result } = renderHook(() => useMarketplaceShopSettings());
      await waitFor(() => expect(result.current.hasShop).toBe(true));
      expect(result.current.form.getValues('sellerStatus')).toBe('');

      const succeeded = await act(() => result.current.submit());
      expect(succeeded).toBe(false);
      expect(CommerceController.commitUpsertShop).not.toHaveBeenCalled();
      expect(result.current.form.getFieldState('sellerStatus').error?.message).toMatch(/Choose whether you sell/);
    });

    it('stamps the confirmation when the seller ticks it and drops it for a business', async () => {
      vi.mocked(CommerceController.refreshShop).mockResolvedValue(publishedShop);
      const { result } = renderHook(() => useMarketplaceShopSettings());
      await waitFor(() => expect(result.current.hasShop).toBe(true));

      act(() => result.current.form.setValue('confirmPrivateStatus', true));
      await act(() => result.current.submit());
      const confirmed = vi.mocked(CommerceController.commitUpsertShop).mock.calls[0]?.[0] as CommerceShopRecord;
      expect(confirmed.sellerStatusConfirmedAt).not.toBe('2026-08-10T10:00:00.000Z');
      expect(Date.parse(confirmed.sellerStatusConfirmedAt ?? '')).toBeGreaterThan(Date.parse('2026-08-10T10:00:00Z'));

      act(() => result.current.form.setValue('sellerStatus', 'trader'));
      await act(() => result.current.submit());
      const trader = vi.mocked(CommerceController.commitUpsertShop).mock.calls[1]?.[0] as CommerceShopRecord;
      expect(trader.sellerStatus).toBe('trader');
      expect(trader.sellerStatusConfirmedAt).toBeUndefined();
    });
  });

  describe('sellerStatusConfirmedAtToPublish', () => {
    const now = '2026-10-23T10:00:00.000Z';
    const earlier = '2026-09-01T10:00:00.000Z';

    it('stamps a first private declaration and a ticked confirmation, keeps an unchanged one, drops a business', () => {
      const base = {
        status: 'private',
        confirmed: false,
        previousStatus: 'private',
        previousConfirmedAt: earlier,
        now,
      };
      expect(sellerStatusConfirmedAtToPublish(base)).toBe(earlier);
      expect(sellerStatusConfirmedAtToPublish({ ...base, confirmed: true })).toBe(now);
      expect(sellerStatusConfirmedAtToPublish({ ...base, previousStatus: undefined })).toBe(now);
      expect(sellerStatusConfirmedAtToPublish({ ...base, previousStatus: 'trader' })).toBe(now);
      expect(sellerStatusConfirmedAtToPublish({ ...base, status: 'trader' })).toBeUndefined();
    });
  });

  it('publishes the seller-confirms-Bitcoin option as bitcoinConfirmation and hydrates it back', async () => {
    vi.mocked(CommerceController.refreshShop).mockResolvedValue(publishedShop);
    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.hasShop).toBe(true));
    expect(result.current.form.getValues('confirmBitcoinPayments')).toBe(false);

    act(() => result.current.form.setValue('confirmBitcoinPayments', true));
    await act(() => result.current.submit());
    expect(CommerceController.commitUpsertShop).toHaveBeenLastCalledWith(
      expect.objectContaining({ bitcoinConfirmation: 'seller' }),
    );

    vi.mocked(CommerceController.refreshShop).mockResolvedValue({ ...publishedShop, bitcoinConfirmation: 'seller' });
    const reloaded = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(reloaded.result.current.hasShop).toBe(true));
    expect(reloaded.result.current.form.getValues('confirmBitcoinPayments')).toBe(true);
  });

  it('publishes the option absent when it is switched off, restoring the default', async () => {
    vi.mocked(CommerceController.refreshShop).mockResolvedValue({ ...publishedShop, bitcoinConfirmation: 'seller' });
    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.hasShop).toBe(true));
    act(() => result.current.form.setValue('confirmBitcoinPayments', false));
    await act(() => result.current.submit());
    const published = vi.mocked(CommerceController.commitUpsertShop).mock.calls.at(-1)?.[0] as CommerceShopRecord;
    expect(published.bitcoinConfirmation).toBeUndefined();
  });

  it('reads an unrecognised bitcoinConfirmation value as the default', async () => {
    vi.mocked(CommerceController.refreshShop).mockResolvedValue(
      asInvalid<CommerceShopRecord>({ ...publishedShop, bitcoinConfirmation: 'paykit' }),
    );
    const { result } = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(result.current.hasShop).toBe(true));
    expect(result.current.form.getValues('confirmBitcoinPayments')).toBe(false);
  });
});
