import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceApplication, type CommerceCheckoutFulfillmentInput } from '@/application/commerce/commerce';
import { UserApplication } from '@/application/user/user';
import { useAuthStore } from '@/stores/auth/auth.store';
import { COMMERCE_FIXTURE_BUYER, COMMERCE_FIXTURE_SELLER } from '@/test/fixtures/commerce/commerce';
import { resetRegionState, setRegionModes } from '@/test-utils/region-modes';
import { CommerceController } from './commerce';

const AGGREGATE = `listing:${COMMERCE_FIXTURE_SELLER}_boots_01`;
const OK = { ok: true } as Awaited<ReturnType<typeof CommerceApplication.executeMarketplaceCommand>>;
const money = { amountMinor: 10_000, currency: 'USD', exponent: 2 };
const SELLING_COMMANDS = [
  { kind: 'offer.create', payload: { amount: money, quantity: 1, expiresInSeconds: 3600, message: '' } },
  { kind: 'auction.place_bid', payload: { maximumAmount: money } },
  {
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
  },
] as const;

const command = (kind: string, payload: Record<string, unknown>) => ({
  version: 1,
  commandId: '00000000-0000-4000-8000-000000000930',
  expectedRevision: 1,
  issuedAt: '2026-10-22T00:00:00.000Z',
  aggregateId: AGGREGATE,
  kind,
  payload,
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(UserApplication, 'ensureSellerFollow').mockResolvedValue(undefined);
  useAuthStore.setState({ currentUserPubky: COMMERCE_FIXTURE_BUYER });
  resetRegionState();
});

afterEach(() => {
  resetRegionState();
  vi.restoreAllMocks();
});

describe('CommerceController buyer country under the region modes', () => {
  it.each(['EU=blocked,GB=blocked,US=blocked', 'EU=nuanced,GB=nuanced,US=blocked', 'US=blocked', 'UNKNOWN=blocked'])(
    'sends the remembered country with the offer, bid and offer checkout commands while the modes are %s',
    async (modes) => {
      setRegionModes(modes);
      const execute = vi.spyOn(CommerceApplication, 'executeMarketplaceCommand').mockResolvedValue(OK);
      CommerceController.setBuyerCountry('CH');
      for (const { kind, payload } of SELLING_COMMANDS) {
        execute.mockClear();
        if (kind === 'offer.checkout') {
          const offerCheckout = vi.spyOn(CommerceApplication, 'commitOfferCheckout').mockResolvedValue(OK);
          await CommerceController.commitOfferCheckout(command(kind, payload));
          expect(offerCheckout.mock.lastCall?.[1].payload).toMatchObject({ buyerCountry: 'CH' });
        } else {
          await CommerceController.executeMarketplaceCommand(command(kind, payload));
          expect(execute.mock.lastCall?.[1].payload).toMatchObject({ buyerCountry: 'CH' });
        }
      }
    },
  );

  it('sends the country with a checkout while any region is blocked', async () => {
    setRegionModes('EU=blocked,GB=blocked,US=blocked');
    const checkout = vi.spyOn(CommerceApplication, 'commitCreateMarketplaceCheckout').mockResolvedValue(OK);
    CommerceController.setBuyerCountry('CH');
    const input = {
      lines: [
        {
          listingAggregateId: AGGREGATE,
          sellerPubky: COMMERCE_FIXTURE_SELLER,
          publishedFulfillmentMethods: ['pickup'],
          expectedRevision: 1,
          quantity: 1,
        },
      ],
    } as CommerceCheckoutFulfillmentInput;
    await CommerceController.commitCreateMarketplaceCheckout(input);
    expect(checkout.mock.lastCall?.[1].buyerCountry).toBe('CH');
  });

  it.each(['none', 'EU=open'])('sends nothing while the modes are %s, whatever the old flags say', async (modes) => {
    process.env.PUBKY_RUNTIME_EU_FENCE_ENABLED = 'true';
    setRegionModes(modes);
    const execute = vi.spyOn(CommerceApplication, 'executeMarketplaceCommand').mockResolvedValue(OK);
    CommerceController.setBuyerCountry('DE');
    await CommerceController.executeMarketplaceCommand(command('auction.place_bid', { maximumAmount: money }));
    expect(execute.mock.lastCall?.[1].payload).not.toHaveProperty('buyerCountry');
  });

  it('still sends the country under the old flags while the setting is unset', async () => {
    process.env.PUBKY_RUNTIME_DIGITAL_REGION_BLOCK_ENABLED = 'true';
    setRegionModes(undefined);
    const execute = vi.spyOn(CommerceApplication, 'executeMarketplaceCommand').mockResolvedValue(OK);
    CommerceController.setBuyerCountry('DE');
    await CommerceController.executeMarketplaceCommand(command('auction.place_bid', { maximumAmount: money }));
    expect(execute.mock.lastCall?.[1].payload).toMatchObject({ buyerCountry: 'DE' });
  });
});
