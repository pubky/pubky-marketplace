import { zodResolver } from '@hookform/resolvers/zod';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type MarketplaceShopSettingsData,
  marketplaceShopSettingsDefaults,
  marketplaceShopSettingsSchema,
} from '@/hooks/useMarketplaceShopSettings/useMarketplaceShopSettings.types';
import { SELLER_AUTO_CONFIRM_COPY, SELLER_CONFIRMS_PAYMENTS_COPY } from '@/libs/commerce/seller-auto-confirm';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useSellerPaymentConfirmStore } from '@/stores/seller-payment-confirm/seller-payment-confirm.store';
import { asOpaque } from '@/test-utils/type-assertions';
import { type MarketplaceShopSettings, MarketplaceShopSettingsFormView } from './MarketplaceShopSettingsForm';

const deployment = vi.hoisted(() => ({ mode: 'seller' as 'checking' | 'seller' | 'automatic' | 'unknown' }));

vi.mock('@/hooks/useSellerAnnualLimit/useSellerAnnualLimit', () => ({
  useSellerAnnualLimit: () => ({ status: 'idle' }),
}));

vi.mock('@/hooks/usePaymentConfirmationMode/usePaymentConfirmationMode', () => ({
  usePaymentConfirmationMode: () => deployment.mode,
}));

const SELLER = 's'.repeat(52);

const slot = {
  previewUrl: null,
  hasImage: false,
  error: null,
  inputRef: { current: null },
  choose: vi.fn(),
  onInputChange: vi.fn(),
  remove: vi.fn(),
};

function Harness() {
  const form = useForm<MarketplaceShopSettingsData>({
    resolver: zodResolver(marketplaceShopSettingsSchema),
    defaultValues: {
      ...marketplaceShopSettingsDefaults,
      name: 'Quiet Shop',
      countryCode: 'CH',
      sellerStatus: 'private',
    },
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
    submit: async () => true,
  });
  return <MarketplaceShopSettingsFormView settings={settings} />;
}

describe('MarketplaceShopSettingsForm payment confirmation', () => {
  beforeEach(() => {
    useAuthStore.getState().setCurrentUserPubky(SELLER);
    useSellerPaymentConfirmStore.setState({ autoConfirmByPubky: {} });
  });

  it('on a seller-confirmed deployment, says the seller confirms every payment instead of offering the Bitcoin option', () => {
    deployment.mode = 'seller';
    render(<Harness />);

    expect(screen.getByTestId('shop-settings-seller-confirms')).toHaveTextContent(SELLER_CONFIRMS_PAYMENTS_COPY);
    expect(screen.queryByRole('switch', { name: 'I confirm my own Bitcoin payments' })).not.toBeInTheDocument();
  });

  it.each(['automatic', 'unknown'] as const)('keeps the Bitcoin option when the deployment is %s', (mode) => {
    deployment.mode = mode;
    render(<Harness />);

    expect(screen.getByRole('switch', { name: 'I confirm my own Bitcoin payments' })).toBeEnabled();
    expect(screen.queryByTestId('shop-settings-seller-confirms')).not.toBeInTheDocument();
  });

  it('turns this browser’s automatic confirmation on for the signed-in seller only', async () => {
    deployment.mode = 'seller';
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByTestId('shop-settings-auto-confirm')).toHaveTextContent(SELLER_AUTO_CONFIRM_COPY);
    const toggle = screen.getByRole('switch', { name: 'Confirm matching payments automatically' });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);

    expect(toggle).toBeChecked();
    expect(useSellerPaymentConfirmStore.getState().autoConfirmByPubky).toEqual({ [SELLER]: true });
  });
});
