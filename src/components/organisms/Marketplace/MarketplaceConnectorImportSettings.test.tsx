import { zodResolver } from '@hookform/resolvers/zod';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import {
  IMPORT_CONDITION_OPTIONS,
  type ImportSettingsFormData,
  importSettingsFormDefaults,
  importSettingsFormSchema,
} from '@/hooks/useMarketplaceInventoryImport/useMarketplaceInventoryImport.types';
import { MarketplaceConnectorImportSettings } from './MarketplaceConnectorImportSettings';

function Harness({
  values = {},
  untrackedVariants = 0,
  madeToOrderVariants = 0,
  variantMode = 'native',
  variantCount = 3,
  onVariantMode,
  variantModeBusy = false,
  onReview = vi.fn(),
  onChooseFreeShipping = vi.fn(),
  onBack = vi.fn(),
}: {
  values?: Partial<ImportSettingsFormData>;
  untrackedVariants?: number;
  madeToOrderVariants?: number;
  variantMode?: 'native' | 'split';
  variantCount?: number;
  onVariantMode?: (mode: 'native' | 'split') => Promise<boolean>;
  variantModeBusy?: boolean;
  onReview?: () => void;
  onChooseFreeShipping?: () => void;
  onBack?: () => void;
}) {
  const form = useForm<ImportSettingsFormData>({
    resolver: zodResolver(importSettingsFormSchema),
    defaultValues: { ...importSettingsFormDefaults, ...values },
    mode: 'onChange',
  });
  return (
    <MarketplaceConnectorImportSettings
      control={form.control}
      provider="woocommerce"
      domain="dezentralshop.ch"
      currency="USD"
      productCount={3}
      variantCount={variantCount}
      untrackedVariants={untrackedVariants}
      madeToOrderVariants={madeToOrderVariants}
      conditionOptions={IMPORT_CONDITION_OPTIONS}
      variantMode={variantMode}
      {...(onVariantMode ? { onVariantMode } : {})}
      variantModeBusy={variantModeBusy}
      busy={false}
      onReview={onReview}
      onChooseFreeShipping={onChooseFreeShipping}
      onBack={onBack}
    />
  );
}

describe('MarketplaceConnectorImportSettings', () => {
  it('says what is imported, in which currency, and that nothing is converted or published yet', () => {
    render(<Harness />);
    const panel = screen.getByTestId('connector-import-settings');
    expect(panel).toHaveTextContent('3 products from dezentralshop.ch (WooCommerce)');
    expect(panel).toHaveTextContent('Prices stay in USD: nothing is converted.');
    expect(panel).toHaveTextContent('Nothing is published until you confirm the dry-run.');
  });

  it('asks for ships-from and shipping with no default chosen for the seller', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Ships from (country code)')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Shipping' })).toHaveTextContent('Choose shipping');
    expect(
      screen.getByText('Required. You have no shipping option yet, and none is chosen for you.'),
    ).toBeInTheDocument();
  });

  it('offers free shipping as one click with its delivery estimate', async () => {
    const onChooseFreeShipping = vi.fn();
    render(<Harness onChooseFreeShipping={onChooseFreeShipping} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Use free shipping (3–10 days)' }));
    expect(onChooseFreeShipping).toHaveBeenCalledTimes(1);
  });

  it('shows what the shop already has, without the free-shipping nudge', () => {
    render(
      <Harness
        values={{
          countryCode: 'CH',
          shippingMode: 'flat',
          shippingPrice: '9.90',
          shippingMinDays: '2',
          shippingMaxDays: '5',
        }}
      />,
    );
    expect(screen.getByLabelText('Ships from (country code)')).toHaveValue('CH');
    expect(screen.getByLabelText('Flat rate (USD)')).toHaveValue('9.90');
    expect(screen.queryByRole('button', { name: /Use free shipping/ })).not.toBeInTheDocument();
  });

  it('asks for a default quantity only when some variants have no stock count, and says how many', () => {
    const { rerender } = render(<Harness untrackedVariants={0} />);
    expect(screen.queryByLabelText('Quantity where your store has no count')).not.toBeInTheDocument();

    rerender(<Harness untrackedVariants={2} />);
    expect(screen.getByLabelText('Quantity where your store has no count')).toHaveValue('1');
    expect(screen.getByTestId('connector-import-untracked')).toHaveTextContent(
      '2 variants do not track stock in your store.',
    );
  });

  it('says made-to-order variants stay available and asks no quantity for them', () => {
    render(<Harness madeToOrderVariants={3} />);
    expect(screen.queryByLabelText('Quantity where your store has no count')).not.toBeInTheDocument();
    expect(screen.getByTestId('connector-import-made-to-order')).toHaveTextContent(
      '3 variants are made to order in your store (for example print-on-demand). On Pubky they stay available without a stock count, and every sale goes to your store to be made and shipped.',
    );
  });

  it('reviews on submit and goes back on request', async () => {
    const user = userEvent.setup();
    const onReview = vi.fn();
    const onBack = vi.fn();
    render(<Harness onReview={onReview} onBack={onBack} />);

    await user.click(screen.getByRole('button', { name: 'Review import' }));
    expect(onReview).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Back to products' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  describe('how the store variants become listings', () => {
    it('says sizes and colours stay together as one listing, with the listing and variant counts', () => {
      render(<Harness variantMode="native" variantCount={12} />);
      expect(screen.getByTestId('connector-import-variant-mode-state')).toHaveTextContent(
        'Sizes and colours stay together as one listing: 3 listings with 12 variants.',
      );
    });

    it('does not repeat the count when every product has one variant', () => {
      render(<Harness variantMode="native" variantCount={3} />);
      expect(screen.getByTestId('connector-import-variant-mode-state')).toHaveTextContent(
        'Sizes and colours stay together as one listing: 3 listings.',
      );
    });

    it('says every size or variant becomes its own listing, counting one listing per variant', () => {
      render(<Harness variantMode="split" variantCount={12} />);
      expect(screen.getByTestId('connector-import-variant-mode-state')).toHaveTextContent(
        'Every size or variant becomes its own listing: 12 listings.',
      );
    });

    it('shows the setting without a switch when it cannot be changed here', () => {
      render(<Harness />);
      expect(screen.queryByRole('switch', { name: 'One listing per size or variant' })).not.toBeInTheDocument();
    });

    it('keeps Review, free shipping and Enter off while the setting is being saved, so the dry run uses the new mode', async () => {
      const user = userEvent.setup();
      const onReview = vi.fn();
      const onChooseFreeShipping = vi.fn();
      render(
        <Harness
          variantMode="native"
          onVariantMode={async () => true}
          variantModeBusy
          onReview={onReview}
          onChooseFreeShipping={onChooseFreeShipping}
        />,
      );
      expect(screen.getByRole('switch', { name: 'One listing per size or variant' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Review import' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Use free shipping (3–10 days)' })).toBeDisabled();

      await user.type(screen.getByLabelText('Ships from (country code)'), 'CH{Enter}');
      expect(onReview).not.toHaveBeenCalled();
      expect(onChooseFreeShipping).not.toHaveBeenCalled();
    });

    it('switches to one listing per variant from the settings step, and back', async () => {
      const user = userEvent.setup();
      const onVariantMode = vi.fn(async () => true);
      const { rerender } = render(<Harness variantMode="native" onVariantMode={onVariantMode} />);
      const toggle = screen.getByRole('switch', { name: 'One listing per size or variant' });
      expect(toggle).not.toBeChecked();

      await user.click(toggle);
      expect(onVariantMode).toHaveBeenLastCalledWith('split');

      rerender(<Harness variantMode="split" onVariantMode={onVariantMode} />);
      expect(screen.getByRole('switch', { name: 'One listing per size or variant' })).toBeChecked();
      await user.click(screen.getByRole('switch', { name: 'One listing per size or variant' }));
      expect(onVariantMode).toHaveBeenLastCalledWith('native');
    });
  });
});
