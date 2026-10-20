import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { BUYER_COUNTRY_PROMPT } from '@/libs/commerce/eu-region';
import { USD_ASSET } from '@/libs/commerce/pricing';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { PUBKY_RUNTIME_ENV_NAMES } from '@/libs/runtime-config/runtime-config.schema';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useBuyerCountryStore } from '@/stores/buyer-country/buyer-country.store';
import {
  createAuctionProjectionFixture,
  createViewerBidAuctionProjectionFixture,
} from '@/test/fixtures/commerce/projections';
import { asOpaque } from '@/test-utils/type-assertions';
import { MarketplaceBidDialog } from './MarketplaceBidDialog';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    executeMarketplaceCommand: vi.fn(),
  },
}));

const SIGNED_IN_PUBKY = 'y'.repeat(52);

describe('MarketplaceBidDialog', () => {
  afterEach(() => {
    delete process.env[PUBKY_RUNTIME_ENV_NAMES.euFenceEnabled];
    resetRuntimeConfigForTests();
    useBuyerCountryStore.setState({ country: null });
  });

  beforeEach(() => {
    useAuthStore.setState({
      currentUserPubky: SIGNED_IN_PUBKY,
      session: asOpaque({ grant: {}, info: { publicKey: { z32: () => SIGNED_IN_PUBKY } } }),
      hasProfile: true,
      isRestoringSession: false,
      isLoggingOut: false,
    });
  });

  it('disables the trigger while the auction has no projection to bid against', () => {
    render(
      <MarketplaceBidDialog aggregateId="listing:x" projection={null} priceAsset={USD_ASSET} onAccepted={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: 'Place a bid' })).toBeDisabled();
  });

  it('keeps the trigger enabled and asks for approval when only the marketplace session is missing', async () => {
    const user = userEvent.setup();
    const onSessionRequired = vi.fn();
    render(
      <MarketplaceBidDialog
        aggregateId="listing:x"
        projection={null}
        priceAsset={USD_ASSET}
        isSessionRequired
        onSessionRequired={onSessionRequired}
        onAccepted={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Place a bid' }));

    expect(onSessionRequired).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('explains maximum-bid proxy semantics inside the dialog', async () => {
    const user = userEvent.setup();
    render(
      <MarketplaceBidDialog
        aggregateId="listing:x"
        projection={createAuctionProjectionFixture()}
        priceAsset={USD_ASSET}
        onAccepted={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Place a bid' }));

    expect(screen.getByRole('dialog', { name: 'Set your maximum bid' })).toBeInTheDocument();
    expect(screen.getByText("We bid only what's needed to keep you ahead, up to your maximum.")).toBeInTheDocument();
    expect(
      screen.getByText('Your maximum stays private. The visible price advances only enough to keep you ahead.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Minimum maximum: \$74\.00/)).toBeInTheDocument();
  });

  it('names the starting bid as the minimum while no bid stands', async () => {
    const user = userEvent.setup();
    const standing = createAuctionProjectionFixture();
    render(
      <MarketplaceBidDialog
        aggregateId="listing:x"
        projection={createAuctionProjectionFixture({
          auction: {
            ...standing.auction!,
            currentPrice: { amountMinor: 4_500, currency: 'USD', exponent: 2 },
            leaderPubky: null,
            bidCount: 0,
          },
        })}
        priceAsset={USD_ASSET}
        onAccepted={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Place a bid' }));

    expect(screen.getByText(/Minimum maximum: \$45\.00 the starting bid\./)).toBeInTheDocument();
  });

  it('shows the bidder-specific minimum and current proxy maximum', async () => {
    const user = userEvent.setup();
    render(
      <MarketplaceBidDialog
        aggregateId="listing:x"
        projection={createViewerBidAuctionProjectionFixture()}
        priceAsset={USD_ASSET}
        onAccepted={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Place a bid' }));

    expect(screen.getByText(/Minimum maximum: \$70\.01/)).toBeInTheDocument();
    expect(screen.getByText(/minimum required to exceed your own current proxy maximum\./)).toBeInTheDocument();
    expect(screen.getByText('Your current proxy maximum: $70.00')).toBeInTheDocument();
  });

  it('refreshes a higher viewer minimum after BID_TOO_LOW without clearing the entered amount', async () => {
    const user = userEvent.setup();
    const initialProjection = createViewerBidAuctionProjectionFixture();
    const refreshedProjection = {
      ...initialProjection,
      serverRevision: initialProjection.serverRevision + 1,
      viewerBid: {
        ...initialProjection.viewerBid!,
        maximumAmount: { amountMinor: 9_000, currency: 'USD', exponent: 2 },
        minimumNextBid: { amountMinor: 9_001, currency: 'USD', exponent: 2 },
      },
    };
    let projection = initialProjection;
    const onRefresh = vi.fn(() => {
      projection = refreshedProjection;
    });
    vi.mocked(CommerceController.executeMarketplaceCommand).mockResolvedValue({
      ok: false,
      error: { code: 'BID_TOO_LOW', message: 'A new proxy maximum must exceed the bidder previous maximum.' },
    });
    const { rerender } = render(
      <MarketplaceBidDialog
        aggregateId="listing:x"
        projection={projection}
        priceAsset={USD_ASSET}
        onAccepted={onRefresh}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Place a bid' }));
    const input = screen.getByRole('textbox', { name: 'Maximum bid (USD)' });
    await user.type(input, '70.01');
    await user.click(screen.getByRole('button', { name: 'Confirm bid' }));
    rerender(
      <MarketplaceBidDialog
        aggregateId="listing:x"
        projection={projection}
        priceAsset={USD_ASSET}
        onAccepted={onRefresh}
      />,
    );

    expect(onRefresh).toHaveBeenCalledOnce();
    expect(screen.getByText(/Minimum maximum: \$90\.01/)).toBeInTheDocument();
    expect(input).toHaveValue('70.01');
  });

  it('labels an ended auction instead of inviting a bid', () => {
    render(
      <MarketplaceBidDialog
        aggregateId="listing:x"
        projection={createAuctionProjectionFixture()}
        priceAsset={USD_ASSET}
        onAccepted={vi.fn()}
        auctionPhase="ended"
      />,
    );

    expect(screen.getByRole('button', { name: 'Auction ended' })).toBeDisabled();
  });

  it('reads "Auction ended" for the owner of an ended auction, not the own-listing notice', () => {
    render(
      <MarketplaceBidDialog
        aggregateId="listing:x"
        projection={createAuctionProjectionFixture()}
        priceAsset={USD_ASSET}
        onAccepted={vi.fn()}
        auctionPhase="ended"
        isOwner
      />,
    );

    expect(screen.getByRole('button', { name: 'Auction ended' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'You cannot bid on your own listing' })).not.toBeInTheDocument();
  });

  it('still tells the owner of a live auction they cannot bid on their own listing', () => {
    render(
      <MarketplaceBidDialog
        aggregateId="listing:x"
        projection={createAuctionProjectionFixture()}
        priceAsset={USD_ASSET}
        onAccepted={vi.fn()}
        auctionPhase="live"
        isOwner
      />,
    );

    expect(screen.getByRole('button', { name: 'You cannot bid on your own listing' })).toBeDisabled();
  });

  it('keeps the country field open, with the remembered country, so a wrong one can be corrected', async () => {
    process.env[PUBKY_RUNTIME_ENV_NAMES.euFenceEnabled] = 'true';
    resetRuntimeConfigForTests();
    useBuyerCountryStore.setState({ country: 'DE' });
    const user = userEvent.setup();
    render(
      <MarketplaceBidDialog
        aggregateId="listing:x"
        projection={createAuctionProjectionFixture()}
        priceAsset={USD_ASSET}
        onAccepted={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Place a bid' }));

    expect(await screen.findByLabelText(BUYER_COUNTRY_PROMPT)).toHaveValue('DE');
    expect(screen.getByRole('button', { name: 'Confirm bid' })).toBeEnabled();
  });

  it('shows no country field with the fence off', async () => {
    const user = userEvent.setup();
    render(
      <MarketplaceBidDialog
        aggregateId="listing:x"
        projection={createAuctionProjectionFixture()}
        priceAsset={USD_ASSET}
        onAccepted={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Place a bid' }));

    await screen.findByRole('dialog');
    expect(screen.queryByLabelText(BUYER_COUNTRY_PROMPT)).not.toBeInTheDocument();
  });
});
