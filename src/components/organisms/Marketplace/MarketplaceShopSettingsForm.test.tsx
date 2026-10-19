import { zodResolver } from '@hookform/resolvers/zod';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import {
  type MarketplaceShopSettingsData,
  marketplaceShopSettingsDefaults,
  marketplaceShopSettingsSchema,
} from '@/hooks/useMarketplaceShopSettings/useMarketplaceShopSettings.types';
import { MarketplaceShopSettingsFormView, type MarketplaceShopSettings } from './MarketplaceShopSettingsForm';

vi.mock('@/hooks/useSellerAnnualLimit/useSellerAnnualLimit', () => ({
  useSellerAnnualLimit: () => ({ status: 'idle' }),
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

function Harness({ sellerStatus }: { sellerStatus: MarketplaceShopSettingsData['sellerStatus'] }) {
  const form = useForm<MarketplaceShopSettingsData>({
    resolver: zodResolver(marketplaceShopSettingsSchema),
    defaultValues: { ...marketplaceShopSettingsDefaults, name: 'Quiet Shop', sellerStatus },
  });
  const settings = {
    isLoading: false,
    loadError: null,
    hasShop: true,
    revision: 3,
    isSaving: false,
    reload: vi.fn(),
    avatar: slot,
    banner: slot,
    form,
    submit: async () => {
      let valid = false;
      await form.handleSubmit(() => {
        valid = true;
      })();
      return valid;
    },
  } as unknown as MarketplaceShopSettings;
  return <MarketplaceShopSettingsFormView settings={settings} />;
}

describe('MarketplaceShopSettingsForm declaration', () => {
  it('moves focus to the declaration when a save is attempted without one', async () => {
    const user = userEvent.setup();
    render(<Harness sellerStatus="" />);

    await user.click(screen.getByRole('button', { name: 'Save storefront' }));

    expect(await screen.findByText(/Choose whether you sell as a private individual/)).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'How do you sell?' });
    expect(group.contains(document.activeElement)).toBe(true);
  });

  it('does not take focus when the declaration is already made', async () => {
    const user = userEvent.setup();
    render(<Harness sellerStatus="private" />);

    await user.click(screen.getByRole('button', { name: 'Save storefront' }));

    expect(screen.queryByText(/Choose whether you sell as a private individual/)).not.toBeInTheDocument();
  });
});
