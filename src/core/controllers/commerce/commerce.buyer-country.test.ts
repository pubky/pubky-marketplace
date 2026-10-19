import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceApplication, type CommerceCheckoutFulfillmentInput } from '@/application/commerce/commerce';
import { UserApplication } from '@/application/user/user';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { PUBKY_RUNTIME_ENV_NAMES } from '@/libs/runtime-config/runtime-config.schema';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useBuyerCountryStore } from '@/stores/buyer-country/buyer-country.store';
import { COMMERCE_FIXTURE_BUYER, COMMERCE_FIXTURE_SELLER } from '@/test/fixtures/commerce/commerce';
import { CommerceController } from './commerce';

const BUYER = COMMERCE_FIXTURE_BUYER;
const SELLER = COMMERCE_FIXTURE_SELLER;
const AGGREGATE = `listing:${SELLER}_boots_01`;
const OK = { ok: true } as Awaited<ReturnType<typeof CommerceApplication.executeMarketplaceCommand>>;
const money = { amountMinor: 10_000, currency: 'USD', exponent: 2 };
const base = {
  version: 1,
  commandId: '00000000-0000-4000-8000-000000000830',
  expectedRevision: 1,
  issuedAt: '2026-08-19T23:00:00.000Z',
};

const bid = (extra: Record<string, unknown> = {}) => ({
  ...base,
  aggregateId: AGGREGATE,
  kind: 'auction.place_bid',
  payload: { maximumAmount: money, ...extra },
});

function setFlags(flags: { fence?: boolean; digital?: boolean }) {
  delete process.env[PUBKY_RUNTIME_ENV_NAMES.euFenceEnabled];
  delete process.env[PUBKY_RUNTIME_ENV_NAMES.digitalRegionBlockEnabled];
  if (flags.fence) process.env[PUBKY_RUNTIME_ENV_NAMES.euFenceEnabled] = 'true';
  if (flags.digital) process.env[PUBKY_RUNTIME_ENV_NAMES.digitalRegionBlockEnabled] = 'true';
  resetRuntimeConfigForTests();
}

describe('CommerceController buyer country (legal launch plan C2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(UserApplication, 'ensureSellerFollow').mockResolvedValue(undefined);
    useAuthStore.setState({ currentUserPubky: BUYER });
    useBuyerCountryStore.setState({ country: null });
    setFlags({});
  });

  afterEach(() => {
    setFlags({});
    useBuyerCountryStore.setState({ country: null });
    vi.restoreAllMocks();
  });

  it('remembers the country in upper case and forgets it on null', () => {
    CommerceController.setBuyerCountry('de');
    expect(CommerceController.getBuyerCountry()).toBe('DE');
    CommerceController.setBuyerCountry(null);
    expect(CommerceController.getBuyerCountry()).toBeNull();
  });

  it('adds the remembered country to every selling command while either flag is on', async () => {
    const execute = vi.spyOn(CommerceApplication, 'executeMarketplaceCommand').mockResolvedValue(OK);
    CommerceController.setBuyerCountry('DE');
    for (const flags of [{ fence: true }, { digital: true }]) {
      setFlags(flags);
      await CommerceController.executeMarketplaceCommand(bid());
      expect(execute.mock.lastCall?.[1].payload).toMatchObject({ buyerCountry: 'DE' });
    }
    setFlags({ fence: true });
    await CommerceController.executeMarketplaceCommand({
      ...base,
      aggregateId: AGGREGATE,
      kind: 'offer.create',
      payload: { amount: money, quantity: 1, expiresInSeconds: 3600, message: '' },
    });
    expect(execute.mock.lastCall?.[1].payload).toMatchObject({ buyerCountry: 'DE' });
  });

  it('adds nothing with both flags off, without a remembered country, or to other commands', async () => {
    const execute = vi.spyOn(CommerceApplication, 'executeMarketplaceCommand').mockResolvedValue(OK);
    CommerceController.setBuyerCountry('DE');
    await CommerceController.executeMarketplaceCommand(bid());
    expect(execute.mock.lastCall?.[1].payload).not.toHaveProperty('buyerCountry');

    setFlags({ fence: true });
    CommerceController.setBuyerCountry(null);
    await CommerceController.executeMarketplaceCommand(bid());
    expect(execute.mock.lastCall?.[1].payload).not.toHaveProperty('buyerCountry');

    CommerceController.setBuyerCountry('DE');
    await CommerceController.executeMarketplaceCommand({
      ...base,
      aggregateId: 'offer:00000000-0000-4000-8000-000000000831',
      kind: 'offer.withdraw',
      payload: { offerId: '00000000-0000-4000-8000-000000000831' },
    });
    expect(execute.mock.lastCall?.[1].payload).not.toHaveProperty('buyerCountry');
  });

  it('keeps a country the command already names', async () => {
    const execute = vi.spyOn(CommerceApplication, 'executeMarketplaceCommand').mockResolvedValue(OK);
    setFlags({ fence: true });
    CommerceController.setBuyerCountry('DE');
    await CommerceController.executeMarketplaceCommand(bid({ buyerCountry: 'FR' }));
    expect(execute.mock.lastCall?.[1].payload).toMatchObject({ buyerCountry: 'FR' });
  });

  it('carries the country on an offer checkout and a checkout', async () => {
    const offerCheckout = vi.spyOn(CommerceApplication, 'commitOfferCheckout').mockResolvedValue(OK);
    const checkout = vi.spyOn(CommerceApplication, 'commitCreateMarketplaceCheckout').mockResolvedValue(OK);
    setFlags({ digital: true });
    CommerceController.setBuyerCountry('GB');
    await CommerceController.commitOfferCheckout({
      ...base,
      aggregateId: 'offer:00000000-0000-4000-8000-000000000832',
      kind: 'offer.checkout',
      payload: {
        offerId: '00000000-0000-4000-8000-000000000832',
        awardId: '00000000-0000-4000-8000-000000000833',
        listingAggregateId: AGGREGATE,
        listingRevision: 1,
        listingRecordSha256: 'a'.repeat(64),
        variantId: 'default',
        quantity: 1,
        fulfillment: 'pickup',
      },
    });
    expect(offerCheckout.mock.lastCall?.[1].payload).toMatchObject({ buyerCountry: 'GB' });

    const input = {
      lines: [
        {
          listingAggregateId: AGGREGATE,
          sellerPubky: SELLER,
          publishedFulfillmentMethods: ['pickup'],
          expectedRevision: 1,
          quantity: 1,
        },
      ],
    } as CommerceCheckoutFulfillmentInput;
    await CommerceController.commitCreateMarketplaceCheckout(input);
    expect(checkout.mock.lastCall?.[1].buyerCountry).toBe('GB');

    await CommerceController.commitCreateMarketplaceCheckout({ ...input, buyerCountry: 'US' });
    expect(checkout.mock.lastCall?.[1].buyerCountry).toBe('US');

    setFlags({});
    await CommerceController.commitCreateMarketplaceCheckout(input);
    expect(checkout.mock.lastCall?.[1]).toBe(input);
  });
});
