import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { CommerceApplication } from '@/application/commerce/commerce';
import { ProfileApplication } from '@/application/profile/profile';
import { Logger } from '@/libs/logger/logger';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { COMMERCE_FIXTURE_SELLER, createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { asOpaque } from '@/test-utils/type-assertions';
import { CommerceController } from './commerce';

const SELLER = COMMERCE_FIXTURE_SELLER;
type PaymentConfig = Awaited<ReturnType<typeof CommerceApplication.putMyPaymentConfig>>;
const config = (bitcoinEnabled: boolean) => asOpaque<PaymentConfig>({ bitcoinEnabled, paypalMerchantEmail: null });

describe('CommerceController default storefront', () => {
  let ensure: MockInstance<typeof CommerceApplication.ensureDefaultShop>;

  beforeEach(() => {
    vi.restoreAllMocks();
    ensure = vi.spyOn(CommerceApplication, 'ensureDefaultShop').mockResolvedValue(undefined);
    useAuthStore.setState({ currentUserPubky: SELLER });
    useCommerceStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes a storefront when the seller saves with Accept bitcoin on', async () => {
    vi.spyOn(CommerceApplication, 'putMyPaymentConfig').mockResolvedValue(config(true));
    const seed = vi.spyOn(ProfileApplication, 'readProfileSeed').mockResolvedValue(null);

    await CommerceController.putMyPaymentConfig({ bitcoinEnabled: true, paypalMerchantEmail: null });

    expect(ensure).toHaveBeenCalledOnce();
    const params = ensure.mock.calls[0][0];
    expect(params).toMatchObject({ ownerPubky: SELLER, location: undefined });
    await params.loadProfile();
    expect(seed).toHaveBeenCalledWith({ pubky: SELLER });
  });

  it('does not publish when the saved config has bitcoin off', async () => {
    vi.spyOn(CommerceApplication, 'putMyPaymentConfig').mockResolvedValue(config(false));

    await CommerceController.putMyPaymentConfig({ bitcoinEnabled: false, paypalMerchantEmail: 'a@b.c' });

    expect(ensure).not.toHaveBeenCalled();
  });

  it('publishes for a seller who already accepts bitcoin when their config loads', async () => {
    vi.spyOn(CommerceApplication, 'getMyPaymentConfig').mockResolvedValueOnce(config(true)).mockResolvedValue(null);

    await CommerceController.getMyPaymentConfig();
    await CommerceController.getMyPaymentConfig();

    expect(ensure).toHaveBeenCalledOnce();
  });

  it('publishes a storefront at the listing location after a listing publish', async () => {
    const listing = createCommerceListingFixture({ location: { countryCode: 'DE' } });
    vi.spyOn(CommerceApplication, 'commitUpsertListing').mockResolvedValue({ registered: true, verified: true });

    await CommerceController.commitUpsertListing(listing);

    expect(ensure).toHaveBeenCalledWith(
      expect.objectContaining({ ownerPubky: SELLER, location: { countryCode: 'DE' } }),
    );
  });

  it('does not publish when the listing publish fails', async () => {
    vi.spyOn(CommerceApplication, 'commitUpsertListing').mockRejectedValue(new Error('publish failed'));

    await expect(CommerceController.commitUpsertListing(createCommerceListingFixture())).rejects.toThrow(
      'publish failed',
    );

    expect(ensure).not.toHaveBeenCalled();
  });

  it('never blocks or fails the seller action', async () => {
    ensure.mockReturnValue(new Promise(() => {}));
    vi.spyOn(CommerceApplication, 'putMyPaymentConfig').mockResolvedValue(config(true));
    await expect(
      CommerceController.putMyPaymentConfig({ bitcoinEnabled: true, paypalMerchantEmail: null }),
    ).resolves.toEqual(config(true));

    const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    ensure.mockRejectedValue(new Error('storefront failed'));
    vi.spyOn(CommerceApplication, 'commitUpsertListing').mockResolvedValue({ registered: true, verified: true });
    await expect(CommerceController.commitUpsertListing(createCommerceListingFixture())).resolves.toEqual({
      registered: true,
      verified: true,
    });
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });
});
