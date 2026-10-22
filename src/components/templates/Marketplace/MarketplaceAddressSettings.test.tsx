import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKETPLACE_DELIVERY_ADDRESS_DISCLOSURE } from '@/config/commerce-copy';
import { useClientRegionStore } from '@/stores/client-region/client-region.store';
import { setHeavySuiteBudgets } from '@/test-utils/load-budget';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
import { MarketplaceAddressSettings } from './MarketplaceAddressSettings';

setHeavySuiteBudgets();

const routerPush = vi.hoisted(() => vi.fn());
const saveAddress = vi.hoisted(() => vi.fn(async () => true));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () =>
    new URLSearchParams({
      returnTo: '/marketplace/drop/ssssssssssssssssssssssssssssssssssssssssssssssssssss/vol1',
    }),
}));

vi.mock('@/hooks/useMarketplaceAddressBook/useMarketplaceAddressBook', () => ({
  bareDeliveryAddressId: (address: { id: string }) => address.id,
  useMarketplaceAddressBook: () => ({
    addresses: [],
    isLoading: false,
    save: saveAddress,
    remove: vi.fn(async () => {}),
    setDefault: vi.fn(async () => {}),
  }),
}));

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

describe('MarketplaceAddressSettings', () => {
  beforeEach(() => resetRegionState());
  afterEach(() => {
    vi.restoreAllMocks();
    resetRegionState();
  });

  describe('where a region is blocked', () => {
    const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';

    it('starts a new address in the IP country when it is open, whatever the browser language says', async () => {
      vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-GB', 'en']);
      setRegionModes(LAUNCH);
      stubClientRegion('CH');
      const user = userEvent.setup();
      render(<MarketplaceAddressSettings />);
      await waitFor(() => expect(useClientRegionStore.getState().status).toBe('ready'));

      await user.click(screen.getByRole('button', { name: 'Add address' }));

      expect(screen.getByRole('textbox', { name: 'Country' })).toHaveValue('CH');
    });

    it('starts a new address with no country, for the buyer to choose, when the IP country is blocked', async () => {
      vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US', 'en']);
      setRegionModes(LAUNCH);
      stubClientRegion('US');
      const user = userEvent.setup();
      render(<MarketplaceAddressSettings />);
      await waitFor(() => expect(useClientRegionStore.getState().status).toBe('ready'));

      await user.click(screen.getByRole('button', { name: 'Add address' }));

      expect(screen.getByRole('textbox', { name: 'Country' })).toHaveValue('');
    });
  });

  it('starts a new address in the browser country', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-GB', 'en']);
    const user = userEvent.setup();
    render(<MarketplaceAddressSettings />);

    await user.click(screen.getByRole('button', { name: 'Add address' }));

    expect(screen.getByRole('textbox', { name: 'Country' })).toHaveValue('GB');
    expect(screen.queryByLabelText('State')).not.toBeInTheDocument();
  });

  it('uses the checkout disclosure and limits packing-slip access to eligible shipping orders', () => {
    render(<MarketplaceAddressSettings />);

    expect(screen.getByText(MARKETPLACE_DELIVERY_ADDRESS_DISCLOSURE)).toBeInTheDocument();
    expect(screen.getByText('Saved address book on this device')).toBeInTheDocument();
    expect(screen.queryByText('Private to this device')).not.toBeInTheDocument();
  });

  it('returns to the originating drop after saving a new address', async () => {
    const user = userEvent.setup();
    render(<MarketplaceAddressSettings />);

    await user.click(screen.getByRole('button', { name: 'Add address' }));
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'Home');
    await user.type(screen.getByRole('textbox', { name: 'Recipient' }), 'Alice Buyer');
    await user.type(screen.getByRole('textbox', { name: 'Address line 1' }), '1 Market Street');
    await user.type(screen.getByLabelText('City'), 'New York');
    await user.type(screen.getByLabelText('State'), 'NY');
    await user.type(screen.getByLabelText('ZIP code'), '10001');
    await user.clear(screen.getByRole('textbox', { name: 'Country' }));
    await user.type(screen.getByRole('textbox', { name: 'Country' }), 'US');
    await user.click(screen.getByRole('button', { name: 'Save address' }));

    await waitFor(() => {
      expect(saveAddress).toHaveBeenCalled();
      expect(routerPush).toHaveBeenCalledWith(
        '/marketplace/drop/ssssssssssssssssssssssssssssssssssssssssssssssssssss/vol1',
      );
    });
  });
});
