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
  onReview = vi.fn(),
  onChooseFreeShipping = vi.fn(),
  onBack = vi.fn(),
}: {
  values?: Partial<ImportSettingsFormData>;
  untrackedVariants?: number;
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
      untrackedVariants={untrackedVariants}
      conditionOptions={IMPORT_CONDITION_OPTIONS}
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
});
