import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseMarketplaceDropClaimResult } from '@/hooks/useMarketplaceDropClaim/useMarketplaceDropClaim';
import { BUYER_COUNTRY_PROMPT, REGION_UNAVAILABLE_MESSAGE } from '@/libs/commerce/eu-region';
import type { CommerceDropRecord } from '@/libs/commerce/marketplace-records';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { PUBKY_RUNTIME_ENV_NAMES } from '@/libs/runtime-config/runtime-config.schema';
import { useBuyerCountryStore } from '@/stores/buyer-country/buyer-country.store';
import { DropClaimPanel } from './DropClaimPanel';

const SELLER = 's'.repeat(52);
const BUYER = 'b'.repeat(52);
const authState = vi.hoisted(() => ({
  currentUserPubky: 'b'.repeat(52) as string | null,
  setShowSignInDialog: vi.fn(),
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: Object.assign((selector: (state: typeof authState) => unknown) => selector(authState), {
    getState: () => authState,
  }),
}));

const listingState = vi.hoisted(() => ({
  variants: [{ id: 'default', options: {}, quantity: 3, enabled: true }] as {
    id: string;
    options: Record<string, string>;
    quantity: number;
    enabled: boolean;
  }[],
  soldOut: [] as string[],
}));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => 'transaction-service', getCommercePollIntervalMs: () => 60_000 };
});

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getOrFetchListing: vi.fn(async () => ({
      listingId: 'listing1',
      title: 'Field Recordings',
      media: [],
      fulfillmentMethods: ['shipping'],
      variants: listingState.variants,
      sale: { format: 'fixed_price', unitPrice: { amountMinor: 5_000, currency: 'USD', exponent: 2 } },
    })),
    getIndicativeBtcRate: vi.fn(async () => null),
    setBuyerCountry: vi.fn((code: string | null) => useBuyerCountryStore.getState().setCountry(code)),
    getSellerAnnualLimit: vi.fn(async () => ({ enabled: true, limitReached: false })),
    getPublicListingAvailability: vi.fn(async () => ({
      aggregateId: 'listing:x',
      state: 'available',
      serverTime: '2026-10-15T12:00:00.000Z',
      variants: listingState.soldOut.length
        ? listingState.variants.map(({ id }) => ({ variantId: id, soldOut: listingState.soldOut.includes(id) }))
        : undefined,
    })),
  },
}));

vi.mock('@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl', () => ({
  useMarketplaceFirstMediaUrls: () => [],
}));

function makeClaim(): UseMarketplaceDropClaimResult {
  return {
    addresses: [],
    claimAddress: {
      id: 'buyer:address',
      owner_id: 'b'.repeat(52),
      label: 'Home',
      name: 'Alice Buyer',
      line1: '1 Market Street',
      line2: '',
      city: 'New York',
      region: 'NY',
      postal_code: '10001',
      country_code: 'US',
      is_default: true,
      last_used_at: null,
      created_at: 1,
      updated_at: 1,
    },
    submittingListingId: null,
    claimedListingIds: new Set(),
    failure: null,
    needsSession: false,
    sessionError: null,
    pendingKeyChange: null,
    decideKeyChange: vi.fn(),
    claim: vi.fn(async () => true),
  };
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
});

describe('DropClaimPanel', () => {
  beforeEach(() => {
    listingState.variants = [{ id: 'default', options: {}, quantity: 3, enabled: true }];
    listingState.soldOut = [];
    authState.currentUserPubky = BUYER;
    authState.setShowSignInDialog.mockClear();
    useBuyerCountryStore.setState({ country: null });
  });

  afterEach(() => {
    delete process.env[PUBKY_RUNTIME_ENV_NAMES.euFenceEnabled];
    resetRuntimeConfigForTests();
    useBuyerCountryStore.setState({ country: null });
  });

  it('disables repeat claims and states the per-buyer limit at zero allowance', async () => {
    render(
      <DropClaimPanel
        record={{ ownerPubky: SELLER, dropId: 'vol1', listingIds: ['listing1'] } as CommerceDropRecord}
        claim={makeClaim()}
        remainingAllowance={0}
      />,
    );

    const button = await screen.findByRole('button', { name: 'Per-buyer limit reached' });
    expect(button).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent("You have reached this drop's per-buyer limit.");
  });

  it('uses one Sign in to buy path for logged-out visitors instead of Claim one', async () => {
    authState.currentUserPubky = null;
    const user = userEvent.setup();
    render(
      <DropClaimPanel
        record={{ ownerPubky: SELLER, dropId: 'vol1', listingIds: ['listing1'] } as CommerceDropRecord}
        claim={makeClaim()}
        remainingAllowance={2}
      />,
    );

    const purchase = await screen.findByRole('button', { name: 'Sign in to buy' });
    expect(purchase).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Claim one' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Approve purchases in Pubky Ring' })).not.toBeInTheDocument();
    expect(screen.queryByText(/No saved delivery address/)).not.toBeInTheDocument();

    await user.click(purchase);
    expect(authState.setShowSignInDialog).toHaveBeenCalledWith(true);
  });

  it('sends Claim one through the single Checkout screen', async () => {
    render(
      <DropClaimPanel
        record={{ ownerPubky: SELLER, dropId: 'vol1', listingIds: ['listing1'] } as CommerceDropRecord}
        claim={makeClaim()}
        remainingAllowance={2}
      />,
    );

    const claim = await screen.findByRole('link', { name: 'Claim one' });
    expect(claim).toHaveAttribute('href', `/marketplace/checkout?seller=${SELLER}&drop=vol1&listing=listing1`);
    expect(screen.queryByText(/No saved delivery address/)).not.toBeInTheDocument();
  });

  describe('with the EU fence on', () => {
    const record = { ownerPubky: SELLER, dropId: 'vol1', listingIds: ['listing1'] } as CommerceDropRecord;

    beforeEach(() => {
      process.env[PUBKY_RUNTIME_ENV_NAMES.euFenceEnabled] = 'true';
      resetRuntimeConfigForTests();
    });

    it('asks for the country before a claim can start when the device has none', async () => {
      render(
        <DropClaimPanel record={record} claim={makeClaim()} remainingAllowance={2} shop={{ sellerStatus: 'trader' }} />,
      );

      expect(await screen.findByLabelText(BUYER_COUNTRY_PROMPT)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Claim one' })).toBeDisabled();
      expect(screen.queryByRole('link', { name: 'Claim one' })).not.toBeInTheDocument();
    });

    it('refuses an EU buyer for a business seller and lets the buyer correct the country', async () => {
      useBuyerCountryStore.setState({ country: 'DE' });
      const user = userEvent.setup();
      render(
        <DropClaimPanel record={record} claim={makeClaim()} remainingAllowance={2} shop={{ sellerStatus: 'trader' }} />,
      );

      expect(await screen.findByTestId('drop-claim-region-refusal')).toHaveTextContent(REGION_UNAVAILABLE_MESSAGE);
      expect(screen.getByRole('button', { name: 'Claim one' })).toBeDisabled();

      const field = screen.getByLabelText(BUYER_COUNTRY_PROMPT);
      await user.clear(field);
      await user.type(field, 'CH');
      expect(useBuyerCountryStore.getState().country).toBe('DE');
      expect(screen.getByRole('button', { name: 'Claim one' })).toBeDisabled();
      await user.keyboard('{Enter}');

      expect(await screen.findByRole('link', { name: 'Claim one' })).toHaveAttribute(
        'href',
        `/marketplace/checkout?seller=${SELLER}&drop=vol1&listing=listing1`,
      );
      expect(screen.queryByTestId('drop-claim-region-refusal')).not.toBeInTheDocument();
      expect(screen.getByTestId('drop-claim-region-country')).toHaveTextContent(`${BUYER_COUNTRY_PROMPT}: Switzerland`);
      await user.click(screen.getByRole('button', { name: 'Change' }));
      expect(screen.getByLabelText(BUYER_COUNTRY_PROMPT)).toHaveValue('CH');
    });

    it('refuses a UK buyer for a business seller too', async () => {
      useBuyerCountryStore.setState({ country: 'GB' });
      render(
        <DropClaimPanel record={record} claim={makeClaim()} remainingAllowance={2} shop={{ sellerStatus: 'trader' }} />,
      );

      expect(await screen.findByTestId('drop-claim-region-refusal')).toHaveTextContent(REGION_UNAVAILABLE_MESSAGE);
      expect(screen.getByRole('button', { name: 'Claim one' })).toBeDisabled();
    });

    it('leaves the claim to the service when the shop could not be read', async () => {
      useBuyerCountryStore.setState({ country: 'DE' });
      render(<DropClaimPanel record={record} claim={makeClaim()} remainingAllowance={2} shop={null} />);

      expect(await screen.findByRole('link', { name: 'Claim one' })).toBeEnabled();
      expect(screen.queryByTestId('drop-claim-region-refusal')).not.toBeInTheDocument();
    });

    it('shows a private seller to an EU buyer without a refusal', async () => {
      useBuyerCountryStore.setState({ country: 'DE' });
      render(
        <DropClaimPanel
          record={record}
          claim={makeClaim()}
          remainingAllowance={2}
          shop={{ sellerStatus: 'private' }}
        />,
      );

      expect(await screen.findByRole('link', { name: 'Claim one' })).toBeEnabled();
      expect(screen.queryByTestId('drop-claim-region')).not.toBeInTheDocument();
    });
  });

  describe('per-size listing', () => {
    const record = { ownerPubky: SELLER, dropId: 'vol1', listingIds: ['listing1'] } as CommerceDropRecord;

    beforeEach(() => {
      listingState.variants = [
        { id: 'size_s', options: { size: 'S' }, quantity: 3, enabled: true },
        { id: 'size_m', options: { size: 'M' }, quantity: 3, enabled: true },
      ];
      listingState.soldOut = ['size_s'];
    });

    it('asks for a size and chooses none for the buyer', async () => {
      render(<DropClaimPanel record={record} claim={makeClaim()} remainingAllowance={2} />);

      expect(await screen.findByRole('combobox', { name: 'Choose listing variant' })).toHaveTextContent(
        'Choose a size',
      );
      expect(screen.getByRole('button', { name: 'Choose a size' })).toBeDisabled();
      expect(screen.queryByRole('link', { name: 'Claim one' })).not.toBeInTheDocument();
    });

    it('keeps a sold-out size listed and disabled, and claims the size that has stock', async () => {
      const user = userEvent.setup();
      render(<DropClaimPanel record={record} claim={makeClaim()} remainingAllowance={2} />);

      await user.click(await screen.findByRole('combobox', { name: 'Choose listing variant' }));
      const listbox = await screen.findByRole('listbox');
      await vi.waitFor(() =>
        expect(within(listbox).getByRole('option', { name: 'S · Sold out' })).toHaveAttribute('aria-disabled', 'true'),
      );
      await user.click(within(listbox).getByRole('option', { name: 'M · 3 left' }));

      expect(await screen.findByRole('link', { name: 'Claim one' })).toHaveAttribute(
        'href',
        `/marketplace/checkout?seller=${SELLER}&drop=vol1&listing=listing1&variant=size_m`,
      );
    });

    it('shows no picker for a listing with one enabled size', async () => {
      listingState.variants = [
        { id: 'size_s', options: { size: 'S' }, quantity: 3, enabled: false },
        { id: 'size_m', options: { size: 'M' }, quantity: 3, enabled: true },
      ];
      listingState.soldOut = [];
      render(<DropClaimPanel record={record} claim={makeClaim()} remainingAllowance={2} />);

      expect(await screen.findByRole('link', { name: 'Claim one' })).toHaveAttribute(
        'href',
        `/marketplace/checkout?seller=${SELLER}&drop=vol1&listing=listing1`,
      );
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });
  });
});
