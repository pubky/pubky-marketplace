import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { USD_ASSET } from '@/libs/commerce/pricing';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useClientRegionStore } from '@/stores/client-region/client-region.store';
import { createAuctionProjectionFixture } from '@/test/fixtures/commerce/projections';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
import { asOpaque } from '@/test-utils/type-assertions';
import { MarketplaceBidDialog } from './MarketplaceBidDialog';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { executeMarketplaceCommand: vi.fn() },
}));

const SIGNED_IN_PUBKY = 'y'.repeat(52);
const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';

const renderDialog = (props: Partial<React.ComponentProps<typeof MarketplaceBidDialog>> = {}) =>
  render(
    <MarketplaceBidDialog
      aggregateId="listing:x"
      projection={createAuctionProjectionFixture()}
      priceAsset={USD_ASSET}
      onAccepted={vi.fn()}
      {...props}
    />,
  );

beforeEach(() => {
  resetRegionState();
  useAuthStore.setState({
    currentUserPubky: SIGNED_IN_PUBKY,
    session: asOpaque({ grant: {}, info: { publicKey: { z32: () => SIGNED_IN_PUBKY } } }),
    hasProfile: true,
    isRestoringSession: false,
    isLoggingOut: false,
  });
});
afterEach(() => resetRegionState());

describe('MarketplaceBidDialog under the region modes', () => {
  it('disables Place a bid for a visitor in a blocked region', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('GB');
    renderDialog();

    await waitFor(() => expect(useClientRegionStore.getState().status).toBe('ready'));
    expect(screen.getByRole('button', { name: 'Place a bid' })).toBeDisabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps Place a bid off while the visitor region is being read, then enables it for an open country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    renderDialog();

    expect(screen.getByRole('button', { name: 'Place a bid' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Place a bid' })).toBeEnabled());
  });

  it('disables Place a bid when the page says commerce with this seller is blocked', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    renderDialog({ regionHeld: true });

    await waitFor(() => expect(useClientRegionStore.getState().status).toBe('ready'));
    expect(screen.getByRole('button', { name: 'Place a bid' })).toBeDisabled();
  });

  it('is unchanged while no region is blocked', () => {
    setRegionModes('none');
    const fetchStub = stubClientRegion('US');
    renderDialog();

    expect(screen.getByRole('button', { name: 'Place a bid' })).toBeEnabled();
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
