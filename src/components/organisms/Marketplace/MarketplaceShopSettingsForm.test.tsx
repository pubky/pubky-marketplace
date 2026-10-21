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
import { asOpaque } from '@/test-utils/type-assertions';
import { type MarketplaceShopSettings, MarketplaceShopSettingsFormView } from './MarketplaceShopSettingsForm';

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

function Harness({
  sellerStatus,
  seed = {
    countryCode: 'CH',
    shippingPolicy: 'Ships within a week.',
    returnPolicy: 'Returns within 14 days.',
  },
}: {
  sellerStatus: MarketplaceShopSettingsData['sellerStatus'];
  seed?: Partial<MarketplaceShopSettingsData>;
}) {
  const form = useForm<MarketplaceShopSettingsData>({
    resolver: zodResolver(marketplaceShopSettingsSchema),
    defaultValues: { ...marketplaceShopSettingsDefaults, name: 'Quiet Shop', ...seed, sellerStatus },
  });
  const settings = asOpaque<MarketplaceShopSettings>({
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
  });
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

  it('asks for a country and both policies on a new shop instead of publishing suggestions', async () => {
    const user = userEvent.setup();
    render(<Harness sellerStatus="private" seed={{}} />);

    expect(screen.getByLabelText('Country')).toHaveValue('');
    expect(screen.getByLabelText('Country')).toHaveAttribute('placeholder', 'Two-letter code');
    expect(screen.getByLabelText('Shipping policy')).toHaveValue('');
    expect(screen.getByLabelText('Shipping policy')).toHaveAttribute(
      'placeholder',
      'e.g. Ships within three business days.',
    );
    expect(screen.getByLabelText('Return policy')).toHaveValue('');
    expect(screen.getByLabelText('Return policy')).toHaveAttribute(
      'placeholder',
      'e.g. Returns accepted within 30 days unless marked final sale.',
    );

    await user.click(screen.getByRole('button', { name: 'Save storefront' }));

    expect(await screen.findByText('Country is required.')).toBeInTheDocument();
    expect(screen.getByText('Shipping policy is required.')).toBeInTheDocument();
    expect(screen.getByText('Return policy is required.')).toBeInTheDocument();
  });

  it('saves once the seller has typed a country and the policies', async () => {
    const user = userEvent.setup();
    render(<Harness sellerStatus="private" seed={{}} />);

    await user.type(screen.getByLabelText('Country'), 'ch');
    await user.type(screen.getByLabelText('Shipping policy'), 'Ships within a week.');
    await user.type(screen.getByLabelText('Return policy'), 'Returns within 14 days.');
    await user.click(screen.getByRole('button', { name: 'Save storefront' }));

    expect(screen.queryByText('Country is required.')).not.toBeInTheDocument();
    expect(screen.queryByText('Shipping policy is required.')).not.toBeInTheDocument();
  });
});
