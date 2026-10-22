import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseMarketplaceDropClaimResult } from '@/hooks/useMarketplaceDropClaim/useMarketplaceDropClaim';
import type { CommerceDropRecord } from '@/libs/commerce/marketplace-records';
import {
  COMMERCE_BLOCKED_MESSAGE,
  COMMERCE_UNKNOWN_REGION_MESSAGE,
  PAID_UNLOCKS_BLOCKED_MESSAGE,
  SELLING_BLOCKED_COUNTRY_MESSAGE,
} from '@/libs/commerce/region-modes';
import { useBuyerCountryStore } from '@/stores/buyer-country/buyer-country.store';
import { useClientRegionStore } from '@/stores/client-region/client-region.store';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
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

const record = { ownerPubky: SELLER, dropId: 'vol1', listingIds: ['listing1'] } as CommerceDropRecord;
const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';

const renderPanel = (shop?: { sellerStatus?: string; location?: { countryCode?: string } } | null) =>
  render(<DropClaimPanel record={record} claim={makeClaim()} remainingAllowance={2} shop={shop} />);

describe('DropClaimPanel under the region modes', () => {
  beforeEach(() => {
    resetRegionState();
    listingState.variants = [{ id: 'default', options: {}, quantity: 3, enabled: true }];
    listingState.soldOut = [];
    authState.currentUserPubky = BUYER;
  });
  afterEach(() => resetRegionState());

  it('replaces Claim one with a disabled button and the one line in a blocked region', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('DE');
    renderPanel();

    expect(await screen.findByTestId('drop-claim-blocked')).toHaveTextContent(COMMERCE_BLOCKED_MESSAGE);
    expect(screen.getByRole('button', { name: 'About this limit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Claim one' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Claim one' })).not.toBeInTheDocument();
  });

  it('keeps Claim one off, with no line, while the visitor region is being read', async () => {
    setRegionModes(LAUNCH);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    renderPanel();

    expect(await screen.findByRole('button', { name: 'Claim one' })).toBeDisabled();
    expect(screen.queryByTestId('drop-claim-blocked')).not.toBeInTheDocument();
  });

  it('turns Claim one into a link for a visitor from an open country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    renderPanel({ sellerStatus: 'private', location: { countryCode: 'CH' } });

    expect(await screen.findByRole('link', { name: 'Claim one' })).toBeEnabled();
    expect(screen.queryByTestId('drop-claim-blocked')).not.toBeInTheDocument();
  });

  it('says the location cannot be told for an unknown visitor', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion(null);
    renderPanel();

    expect(await screen.findByTestId('drop-claim-blocked')).toHaveTextContent(COMMERCE_UNKNOWN_REGION_MESSAGE);
    expect(screen.getByRole('button', { name: 'Claim one' })).toBeDisabled();
  });

  it('blocks a drop from a seller whose shop is in a blocked country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    renderPanel({ sellerStatus: 'private', location: { countryCode: 'US' } });

    expect(await screen.findByTestId('drop-claim-blocked')).toHaveTextContent(SELLING_BLOCKED_COUNTRY_MESSAGE);
    expect(screen.getByRole('button', { name: 'Claim one' })).toBeDisabled();
  });

  it('names paid unlocks for a drop of digital items', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('US');
    const { getOrFetchListing } = (await import('@/controllers/commerce/commerce')).CommerceController;
    vi.mocked(getOrFetchListing).mockResolvedValueOnce({
      listingId: 'listing1',
      title: 'Field Recordings',
      media: [],
      fulfillmentMethods: ['digital'],
      variants: listingState.variants,
      sale: { format: 'fixed_price', unitPrice: { amountMinor: 5_000, currency: 'USD', exponent: 2 } },
    } as never);
    renderPanel();

    expect(await screen.findByTestId('drop-claim-blocked')).toHaveTextContent(PAID_UNLOCKS_BLOCKED_MESSAGE);
  });

  it('disables Sign in to buy, and says why, for a signed-out visitor in a blocked region', async () => {
    authState.currentUserPubky = null;
    setRegionModes(LAUNCH);
    stubClientRegion('GB');
    renderPanel();

    expect(await screen.findByTestId('drop-claim-blocked')).toHaveTextContent(COMMERCE_BLOCKED_MESSAGE);
    expect(screen.getByRole('button', { name: 'Sign in to buy' })).toBeDisabled();
  });

  it('is unchanged, and reads no region, while no region is blocked', async () => {
    setRegionModes('none');
    const fetchStub = stubClientRegion('US');
    renderPanel();

    expect(await screen.findByRole('link', { name: 'Claim one' })).toBeEnabled();
    expect(fetchStub).not.toHaveBeenCalled();
    await waitFor(() => expect(useClientRegionStore.getState().status).toBe('idle'));
  });
});
