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
const OTHER_ACCOUNT = 'o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy';
const PROFILE = { name: 'Satoshi', bio: 'Bitcoin goods.', links: [] };
type PaymentConfig = Awaited<ReturnType<typeof CommerceApplication.putMyPaymentConfig>>;
const config = (bitcoinEnabled: boolean) => asOpaque<PaymentConfig>({ bitcoinEnabled, paypalMerchantEmail: null });

describe('CommerceController default storefront', () => {
  let needs: MockInstance<typeof CommerceApplication.needsDefaultShop>;
  let create: MockInstance<typeof CommerceApplication.commitCreateDefaultShop>;
  let seed: MockInstance<typeof ProfileApplication.readProfileSeed>;

  beforeEach(() => {
    vi.restoreAllMocks();
    CommerceController['defaultShopSession'].clear();
    needs = vi.spyOn(CommerceApplication, 'needsDefaultShop').mockResolvedValue(true);
    create = vi.spyOn(CommerceApplication, 'commitCreateDefaultShop').mockResolvedValue(undefined);
    seed = vi.spyOn(ProfileApplication, 'readProfileSeed').mockResolvedValue(PROFILE);
    useAuthStore.setState({ currentUserPubky: SELLER });
    useCommerceStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const settled = () => Promise.all([...CommerceController['defaultShopSession'].values()]);

  it('publishes a storefront from the profile when the seller saves with Accept bitcoin on', async () => {
    vi.spyOn(CommerceApplication, 'putMyPaymentConfig').mockResolvedValue(config(true));

    await CommerceController.putMyPaymentConfig({ bitcoinEnabled: true, paypalMerchantEmail: null });
    await settled();

    expect(needs).toHaveBeenCalledWith(SELLER);
    expect(seed).toHaveBeenCalledWith({ pubky: SELLER });
    expect(create).toHaveBeenCalledWith({ ownerPubky: SELLER, profile: PROFILE, location: undefined });
  });

  it('does not read the profile or write when the seller already has a shop', async () => {
    needs.mockResolvedValue(false);
    vi.spyOn(CommerceApplication, 'putMyPaymentConfig').mockResolvedValue(config(true));

    await CommerceController.putMyPaymentConfig({ bitcoinEnabled: true, paypalMerchantEmail: null });
    await settled();

    expect(seed).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('does not publish when the saved config has bitcoin off', async () => {
    vi.spyOn(CommerceApplication, 'putMyPaymentConfig').mockResolvedValue(config(false));

    await CommerceController.putMyPaymentConfig({ bitcoinEnabled: false, paypalMerchantEmail: 'a@b.c' });
    await settled();

    expect(needs).not.toHaveBeenCalled();
  });

  it('checks once per seller per session, for a seller who already accepts bitcoin', async () => {
    vi.spyOn(CommerceApplication, 'getMyPaymentConfig').mockResolvedValue(config(true));

    await CommerceController.getMyPaymentConfig();
    await CommerceController.getMyPaymentConfig();
    await settled();
    await CommerceController.getMyPaymentConfig();

    expect(needs).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
  });

  it('publishes a storefront at the listing location after a listing publish', async () => {
    const listing = createCommerceListingFixture({ location: { countryCode: 'DE' } });
    vi.spyOn(CommerceApplication, 'commitUpsertListing').mockResolvedValue({ registered: true, verified: true });

    await CommerceController.commitUpsertListing(listing);
    await settled();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ ownerPubky: SELLER, location: { countryCode: 'DE' } }),
    );
  });

  it('does not publish when the listing publish fails', async () => {
    vi.spyOn(CommerceApplication, 'commitUpsertListing').mockRejectedValue(new Error('publish failed'));

    await expect(CommerceController.commitUpsertListing(createCommerceListingFixture())).rejects.toThrow(
      'publish failed',
    );

    expect(needs).not.toHaveBeenCalled();
  });

  it('keeps the seller who triggered it when the account switches mid-action', async () => {
    vi.spyOn(CommerceApplication, 'putMyPaymentConfig').mockImplementation(async () => {
      useAuthStore.setState({ currentUserPubky: OTHER_ACCOUNT });
      return config(true);
    });

    await CommerceController.putMyPaymentConfig({ bitcoinEnabled: true, paypalMerchantEmail: null });
    await settled();

    expect(needs).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(CommerceController['defaultShopSession'].has(SELLER)).toBe(false);
  });

  it('does not write when the account switches while the profile loads, and retries later', async () => {
    seed.mockImplementationOnce(async () => {
      useAuthStore.setState({ currentUserPubky: OTHER_ACCOUNT });
      return PROFILE;
    });
    vi.spyOn(CommerceApplication, 'putMyPaymentConfig').mockResolvedValue(config(true));

    await CommerceController.putMyPaymentConfig({ bitcoinEnabled: true, paypalMerchantEmail: null });
    await settled();
    expect(create).not.toHaveBeenCalled();

    useAuthStore.setState({ currentUserPubky: SELLER });
    await CommerceController.putMyPaymentConfig({ bitcoinEnabled: true, paypalMerchantEmail: null });
    await settled();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ ownerPubky: SELLER }));
  });

  it('never blocks or fails the seller action, and retries after a failure', async () => {
    needs.mockReturnValueOnce(new Promise(() => {}));
    vi.spyOn(CommerceApplication, 'putMyPaymentConfig').mockResolvedValue(config(true));
    await expect(
      CommerceController.putMyPaymentConfig({ bitcoinEnabled: true, paypalMerchantEmail: null }),
    ).resolves.toEqual(config(true));

    CommerceController['defaultShopSession'].clear();
    const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    create.mockRejectedValueOnce(new Error('storefront failed'));
    vi.spyOn(CommerceApplication, 'commitUpsertListing').mockResolvedValue({ registered: true, verified: true });
    await expect(CommerceController.commitUpsertListing(createCommerceListingFixture())).resolves.toEqual({
      registered: true,
      verified: true,
    });
    await settled();
    expect(warn).toHaveBeenCalled();

    await CommerceController.commitUpsertListing(createCommerceListingFixture());
    await settled();
    expect(create).toHaveBeenCalledTimes(2);
  });
});
