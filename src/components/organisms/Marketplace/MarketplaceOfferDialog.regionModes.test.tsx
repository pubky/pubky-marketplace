import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { USD_ASSET } from '@/libs/commerce/pricing';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useClientRegionStore } from '@/stores/client-region/client-region.store';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
import { asOpaque } from '@/test-utils/type-assertions';
import { MarketplaceOfferDialog } from './MarketplaceOfferDialog';

const SIGNED_IN_PUBKY = 'y'.repeat(52);
const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';

const renderDialog = (props: Partial<React.ComponentProps<typeof MarketplaceOfferDialog>> = {}) =>
  render(
    <MarketplaceOfferDialog
      aggregateId="listing:x"
      expectedRevision={1}
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

describe('MarketplaceOfferDialog under the region modes', () => {
  it('does not ask for a country while regions are only blocked, and asks while one is nuanced', async () => {
    const user = userEvent.setup();
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    const blocked = renderDialog();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Make offer' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Make offer' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByLabelText('Country you live in')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeEnabled();
    blocked.unmount();

    resetRegionState();
    setRegionModes('EU=nuanced,GB=nuanced,US=blocked');
    stubClientRegion('CH');
    renderDialog();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Make offer' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Make offer' }));
    expect(await screen.findByLabelText('Country you live in')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeDisabled();
  });

  it('disables Make offer, keeping its label, for a visitor in a blocked region', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('US');
    renderDialog();

    const trigger = screen.getByRole('button', { name: 'Make offer' });
    expect(trigger).toBeDisabled();
    await waitFor(() => expect(trigger).toBeDisabled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('disables Make offer while the visitor region is being read, then enables it for an open country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    renderDialog();

    expect(screen.getByRole('button', { name: 'Make offer' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Make offer' })).toBeEnabled());
  });

  it('disables Make offer when the page says commerce with this seller is blocked', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    renderDialog({ regionHeld: true });

    await waitFor(() => expect(useClientRegionStore.getState().status).toBe('ready'));
    expect(screen.getByRole('button', { name: 'Make offer' })).toBeDisabled();
  });

  it('is unchanged while no region is blocked', () => {
    setRegionModes('EU=nuanced,GB=nuanced');
    const fetchStub = stubClientRegion('US');
    renderDialog();

    expect(screen.getByRole('button', { name: 'Make offer' })).toBeEnabled();
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
