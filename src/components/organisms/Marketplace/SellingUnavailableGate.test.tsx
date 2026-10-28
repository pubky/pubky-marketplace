import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import {
  BACK_TO_MARKET_LABEL,
  COMMERCE_BLOCKED_INFO,
  COMMERCE_UNKNOWN_REGION_MESSAGE,
  SELLING_BLOCKED_MESSAGE,
} from '@/libs/commerce/region-modes';
import { useAuthStore } from '@/stores/auth/auth.store';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
import { SellingUnavailableGate } from './SellingUnavailableGate';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { getShop: vi.fn() },
}));

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

const SELLER = 's'.repeat(52);
const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';

function ownShopIn(countryCode: string) {
  vi.mocked(CommerceController.getShop).mockResolvedValue({ record: { location: { countryCode } } } as never);
}

const renderGate = () =>
  render(
    <SellingUnavailableGate>
      <p>the seller studio</p>
    </SellingUnavailableGate>,
  );

beforeEach(() => {
  resetRegionState();
  vi.mocked(CommerceController.getShop).mockReset();
  useAuthStore.setState({ currentUserPubky: SELLER });
});
afterEach(() => {
  resetRegionState();
  useAuthStore.setState({ currentUserPubky: null });
});

describe('SellingUnavailableGate', () => {
  it('shows the selling line, the info text and a way back to the Market instead of the page', async () => {
    const user = userEvent.setup();
    setRegionModes(LAUNCH);
    stubClientRegion('US');
    ownShopIn('CH');
    renderGate();

    const gate = await screen.findByTestId('selling-unavailable');
    expect(gate).toHaveTextContent(SELLING_BLOCKED_MESSAGE);
    expect(screen.queryByText('the seller studio')).not.toBeInTheDocument();

    const back = screen.getByRole('link', { name: BACK_TO_MARKET_LABEL });
    expect(back).toHaveAttribute('href', '/marketplace');

    await user.click(screen.getByRole('button', { name: 'About this limit' }));
    expect(await screen.findByTestId('info-hint-content')).toHaveTextContent(COMMERCE_BLOCKED_INFO);
  });

  it('blocks a seller whose own shop is in a blocked country, even from an open IP country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    ownShopIn('DE');
    renderGate();

    expect(await screen.findByTestId('selling-unavailable')).toHaveTextContent(
      "Your shop country is Germany, where selling isn't available yet.",
    );
    expect(screen.queryByText('the seller studio')).not.toBeInTheDocument();
  });

  it('tells a seller whose shop country is the reason to update it, with a link to the field', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    ownShopIn('GB');
    renderGate();

    const gate = await screen.findByTestId('selling-unavailable');
    expect(gate).toHaveTextContent("Your shop country is United Kingdom, where selling isn't available yet.");
    expect(gate).not.toHaveTextContent(SELLING_BLOCKED_MESSAGE);
    expect(screen.getByTestId('selling-unavailable-hint')).toHaveTextContent(
      "If that isn't where you sell from, update your shop country.",
    );
    expect(screen.getByRole('link', { name: 'update your shop country' })).toHaveAttribute(
      'href',
      '/marketplace/storefront#countryCode',
    );
    expect(screen.getByRole('link', { name: BACK_TO_MARKET_LABEL })).toBeInTheDocument();
  });

  it('names a blocked shop country without linking to the field when the seller is inside the block too', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('US');
    ownShopIn('GB');
    renderGate();

    const gate = await screen.findByTestId('selling-unavailable');
    await waitFor(() =>
      expect(gate).toHaveTextContent("Your shop country is United Kingdom, where selling isn't available yet."),
    );
    expect(screen.queryByRole('link', { name: 'update your shop country' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('selling-unavailable-hint')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: BACK_TO_MARKET_LABEL })).toBeInTheDocument();
  });

  it('does not suggest a new shop country when only the visitor region is the reason', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('US');
    ownShopIn('CH');
    renderGate();

    const gate = await screen.findByTestId('selling-unavailable');
    expect(gate).toHaveTextContent(SELLING_BLOCKED_MESSAGE);
    expect(screen.queryByTestId('selling-unavailable-hint')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'update your shop country' })).not.toBeInTheDocument();
  });

  it('says the location cannot be told for an unknown seller, with no suggestion to use a VPN', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion(null);
    ownShopIn('CH');
    renderGate();

    const gate = await screen.findByTestId('selling-unavailable');
    expect(gate).toHaveTextContent(COMMERCE_UNKNOWN_REGION_MESSAGE);
    expect(gate.textContent).not.toMatch(/vpn/i);
    expect(screen.getByRole('link', { name: BACK_TO_MARKET_LABEL })).toBeInTheDocument();
  });

  it('shows nothing, rather than the studio, while the visitor region is being read', () => {
    setRegionModes(LAUNCH);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    ownShopIn('CH');
    renderGate();

    expect(screen.queryByText('the seller studio')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selling-unavailable')).not.toBeInTheDocument();
  });

  it('renders the page for a seller from an open country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    ownShopIn('NO');
    renderGate();

    expect(await screen.findByText('the seller studio')).toBeInTheDocument();
    expect(screen.queryByTestId('selling-unavailable')).not.toBeInTheDocument();
  });

  it('renders the page untouched, reading no region, while no region is blocked', async () => {
    const fetchStub = stubClientRegion('US');
    for (const modes of [undefined, 'none', 'EU=nuanced,GB=nuanced']) {
      setRegionModes(modes);
      const { unmount } = renderGate();
      expect(screen.getByText('the seller studio')).toBeInTheDocument();
      unmount();
    }
    await waitFor(() => expect(fetchStub).not.toHaveBeenCalled());
    expect(CommerceController.getShop).not.toHaveBeenCalled();
  });
});
