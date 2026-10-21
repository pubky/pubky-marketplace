import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketplaceSellerAnnualLimit } from '@/core/services/marketplace/marketplace-projections';
import {
  type MarketplaceShopSettingsData,
  marketplaceShopSettingsDefaults,
  marketplaceShopSettingsSchema,
} from '@/hooks/useMarketplaceShopSettings/useMarketplaceShopSettings.types';
import { asOpaque } from '@/test-utils/type-assertions';
import { type MarketplaceShopSettings, MarketplaceShopSettingsFormView } from './MarketplaceShopSettingsForm';

const SELLER = 'y'.repeat(52);

const mocks = vi.hoisted(() => ({
  getSellerAnnualLimit: vi.fn(),
}));

vi.mock('@/libs/runtime-config/runtime-config', () => ({
  getEuFenceEnabled: () => true,
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { getSellerAnnualLimit: mocks.getSellerAnnualLimit },
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) => selector({ currentUserPubky: SELLER }),
}));

const slot = {
  previewUrl: null,
  hasImage: false,
  error: null,
  inputRef: { current: null },
  choose: vi.fn(),
  onInputChange: vi.fn(),
  remove: vi.fn(),
};

const notInEu: MarketplaceSellerAnnualLimit = { enabled: true, residentInEu: false };
const inEu: MarketplaceSellerAnnualLimit = {
  enabled: true,
  residentInEu: true,
  sales: 4,
  salesLimit: 30,
  eurCents: 25_000,
  eurLimitCents: 200_000,
};

/**
 * Stands in for the settings hook's save: a valid form "publishes", which bumps the shop revision
 * exactly as the real hook does after the homeserver write.
 */
function Harness({ initial }: { initial: Partial<MarketplaceShopSettingsData> }) {
  const [revision, setRevision] = useState(1);
  const form = useForm<MarketplaceShopSettingsData>({
    resolver: zodResolver(marketplaceShopSettingsSchema),
    defaultValues: {
      ...marketplaceShopSettingsDefaults,
      name: 'Quiet Shop',
      shippingPolicy: 'Ships fast.',
      returnPolicy: 'No returns.',
      ...initial,
    },
  });
  const settings = asOpaque<MarketplaceShopSettings>({
    isLoading: false,
    loadError: null,
    hasShop: true,
    revision,
    isSaving: false,
    reload: vi.fn(),
    avatar: slot,
    banner: slot,
    form,
    submit: async () => {
      let saved = false;
      await form.handleSubmit(() => {
        saved = true;
        setRevision((current) => current + 1);
      })();
      return saved;
    },
  });
  return <MarketplaceShopSettingsFormView settings={settings} />;
}

describe('MarketplaceShopSettingsForm EU seller counter', () => {
  beforeEach(() => {
    mocks.getSellerAnnualLimit.mockReset();
  });

  it('shows the counter right after the seller saves an EU country, without a reload', async () => {
    const user = userEvent.setup();
    mocks.getSellerAnnualLimit.mockResolvedValueOnce(notInEu);
    render(<Harness initial={{ countryCode: 'US', sellerStatus: 'private' }} />);
    await waitFor(() => expect(mocks.getSellerAnnualLimit).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('seller-annual-limit')).not.toBeInTheDocument();

    mocks.getSellerAnnualLimit.mockResolvedValueOnce(inEu);
    await user.clear(screen.getByLabelText('Country'));
    await user.type(screen.getByLabelText('Country'), 'CH');
    await user.click(screen.getByRole('button', { name: 'Save storefront' }));

    expect(await screen.findByTestId('seller-annual-limit-counters')).toHaveTextContent(
      'Sales this year: 4 of 30, €250 of €2,000',
    );
    expect(mocks.getSellerAnnualLimit).toHaveBeenCalledTimes(2);
  });

  it('updates the counter right after the seller saves their declaration', async () => {
    const user = userEvent.setup();
    mocks.getSellerAnnualLimit.mockResolvedValueOnce(notInEu);
    render(<Harness initial={{ countryCode: 'CH', sellerStatus: '' }} />);
    await waitFor(() => expect(mocks.getSellerAnnualLimit).toHaveBeenCalledTimes(1));

    mocks.getSellerAnnualLimit.mockResolvedValueOnce(inEu);
    await user.click(screen.getByRole('radio', { name: /private individual/i }));
    await user.click(screen.getByRole('button', { name: 'Save storefront' }));

    expect(await screen.findByTestId('seller-annual-limit-counters')).toBeInTheDocument();
  });

  it('does not read the limit again when the save is refused by validation', async () => {
    const user = userEvent.setup();
    mocks.getSellerAnnualLimit.mockResolvedValue(notInEu);
    render(<Harness initial={{ countryCode: '', sellerStatus: 'private' }} />);
    await waitFor(() => expect(mocks.getSellerAnnualLimit).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Save storefront' }));

    expect(await screen.findByText('Country is required.')).toBeInTheDocument();
    expect(mocks.getSellerAnnualLimit).toHaveBeenCalledTimes(1);
  });
});
