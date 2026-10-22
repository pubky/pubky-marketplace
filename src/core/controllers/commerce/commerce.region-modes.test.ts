import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { CommerceApplication, type CommerceCheckoutFulfillmentInput } from '@/application/commerce/commerce';
import { UserApplication } from '@/application/user/user';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useBuyerCountryStore } from '@/stores/buyer-country/buyer-country.store';
import { useClientRegionStore } from '@/stores/client-region/client-region.store';
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

const modesWithNuanced = ['EU=nuanced,GB=nuanced', 'EU=nuanced,GB=nuanced,US=blocked', 'US=nuanced,DE=blocked'];
const blockedOnly = ['EU=blocked,GB=blocked,US=blocked', 'US=blocked', 'UNKNOWN=blocked', 'DE=blocked,UNKNOWN=open'];

const SENDERS = [
  ...SELLING_COMMANDS.filter(({ kind }) => kind !== 'offer.checkout').map(({ kind, payload }) => ({
    name: kind,
    send: () => CommerceController.executeMarketplaceCommand(command(kind, payload)),
    sent: (spies: Spies) => spies.execute.mock.lastCall?.[1].payload,
  })),
  {
    name: 'offer.checkout',
    send: () => CommerceController.commitOfferCheckout(command('offer.checkout', SELLING_COMMANDS[2].payload)),
    sent: (spies: Spies) => spies.offerCheckout.mock.lastCall?.[1].payload,
  },
  {
    name: 'checkout.create',
    send: () => CommerceController.commitCreateMarketplaceCheckout(CHECKOUT_INPUT),
    sent: (spies: Spies) => spies.checkout.mock.lastCall?.[1],
  },
];

const CHECKOUT_INPUT = {
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

interface Spies {
  execute: MockInstance<typeof CommerceApplication.executeMarketplaceCommand>;
  offerCheckout: MockInstance<typeof CommerceApplication.commitOfferCheckout>;
  checkout: MockInstance<typeof CommerceApplication.commitCreateMarketplaceCheckout>;
}

function spyOnApplication(): Spies {
  return {
    execute: vi.spyOn(CommerceApplication, 'executeMarketplaceCommand').mockResolvedValue(OK),
    offerCheckout: vi.spyOn(CommerceApplication, 'commitOfferCheckout').mockResolvedValue(OK),
    checkout: vi.spyOn(CommerceApplication, 'commitCreateMarketplaceCheckout').mockResolvedValue(OK),
  };
}

describe('CommerceController buyer country under the region modes', () => {
  describe.each(SENDERS)('$name', ({ send, sent }) => {
    it.each(modesWithNuanced)('carries the country this account gave while the modes are %s', async (modes) => {
      setRegionModes(modes);
      const spies = spyOnApplication();
      CommerceController.setBuyerCountry('ch');

      await send();

      expect(sent(spies)).toMatchObject({ buyerCountry: 'CH' });
    });

    it.each([...modesWithNuanced, ...blockedOnly, 'none'])(
      'leaves buyerCountry out, not empty and not null, when none is known (modes: %s)',
      async (modes) => {
        setRegionModes(modes);
        const spies = spyOnApplication();

        await send();

        expect(sent(spies)).not.toHaveProperty('buyerCountry');
        expect(JSON.stringify(sent(spies))).not.toMatch(/buyerCountry|buyer_country/);
      },
    );

    it.each(blockedOnly)(
      'adds a remembered country to nothing while regions are only blocked (modes: %s)',
      async (modes) => {
        setRegionModes(modes);
        const spies = spyOnApplication();
        CommerceController.setBuyerCountry('CH');

        await send();

        expect(sent(spies)).not.toHaveProperty('buyerCountry');
      },
    );

    it('never carries the visitor IP country', async () => {
      setRegionModes('EU=blocked,GB=blocked,US=blocked');
      useClientRegionStore.setState({ status: 'ready', country: 'NZ' });
      const spies = spyOnApplication();

      await send();

      expect(JSON.stringify(sent(spies))).not.toContain('NZ');
    });

    it('does not carry a country another account left on the device', async () => {
      setRegionModes('EU=nuanced,GB=nuanced');
      const spies = spyOnApplication();
      useBuyerCountryStore.getState().setCountry('DE', 'o'.repeat(52));

      await send();

      expect(sent(spies)).not.toHaveProperty('buyerCountry');
    });
  });

  it('keeps a country the command already names', async () => {
    setRegionModes('EU=nuanced,GB=nuanced');
    const spies = spyOnApplication();
    CommerceController.setBuyerCountry('DE');
    await CommerceController.executeMarketplaceCommand(
      command('auction.place_bid', { maximumAmount: money, buyerCountry: 'FR' }),
    );
    expect(spies.execute.mock.lastCall?.[1].payload).toMatchObject({ buyerCountry: 'FR' });
  });

  it.each(['none', 'EU=open'])('sends nothing while the modes are %s, whatever the old flags say', async (modes) => {
    process.env.PUBKY_RUNTIME_EU_FENCE_ENABLED = 'true';
    setRegionModes(modes);
    const spies = spyOnApplication();
    CommerceController.setBuyerCountry('DE');
    await CommerceController.executeMarketplaceCommand(command('auction.place_bid', { maximumAmount: money }));
    expect(spies.execute.mock.lastCall?.[1].payload).not.toHaveProperty('buyerCountry');
  });

  it('still sends the country under the old flags while the setting is unset', async () => {
    process.env.PUBKY_RUNTIME_DIGITAL_REGION_BLOCK_ENABLED = 'true';
    setRegionModes(undefined);
    const spies = spyOnApplication();
    CommerceController.setBuyerCountry('DE');
    await CommerceController.executeMarketplaceCommand(command('auction.place_bid', { maximumAmount: money }));
    expect(spies.execute.mock.lastCall?.[1].payload).toMatchObject({ buyerCountry: 'DE' });
  });
});
