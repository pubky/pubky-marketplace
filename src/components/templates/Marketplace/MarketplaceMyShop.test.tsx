import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { marketplaceShopSettingsDefaults } from '@/hooks/useMarketplaceShopSettings/useMarketplaceShopSettings.types';
import { MarketplaceMyShop } from './MarketplaceMyShop';

const load = vi.hoisted(() => ({ error: false, reload: vi.fn() }));

const imageSlot = vi.hoisted(() => (previewUrl: string | null) => ({
  previewUrl,
  hasImage: previewUrl !== null,
  error: null,
  inputRef: { current: null },
  choose: vi.fn(),
  onInputChange: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: Object.assign(
    (selector: (state: { currentUserPubky: string }) => unknown) => selector({ currentUserPubky: 'y'.repeat(52) }),
    {
      getState: () => ({
        currentUserPubky: 'y'.repeat(52),
        selectCurrentUserPubky: () => 'y'.repeat(52),
      }),
      setState: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    },
  ),
}));

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/hooks/useMarketplaceShopSettings/useMarketplaceShopSettings', () => ({
  useMarketplaceShopSettings: () => {
    const form = useForm({
      defaultValues: {
        ...marketplaceShopSettingsDefaults,
        vacationMode: true,
      },
    });
    return {
      form,
      revision: 0,
      isLoading: false,
      loadError: load.error,
      reload: load.reload,
      isSaving: false,
      hasShop: false,
      isDirty: form.formState.isDirty,
      avatar: imageSlot(null),
      banner: imageSlot(null),
      submit: vi.fn(async () => false),
    };
  },
}));

describe('MarketplaceMyShop', () => {
  beforeEach(() => {
    load.error = false;
    load.reload.mockReset();
  });
  it('updates the public shop preview as the seller edits the form', async () => {
    const user = userEvent.setup();
    render(<MarketplaceMyShop />);

    const preview = screen.getByTestId('shop-live-preview');
    expect(preview).toHaveTextContent('Your shop name');
    expect(preview).toHaveTextContent('Vacation mode');

    await user.type(screen.getByLabelText('Shop name'), 'Satoshi Vintage');
    await user.type(screen.getByLabelText('About your shop'), 'Circular fashion and Bitcoin.');
    await user.type(screen.getByLabelText('Country'), 'ch');
    await user.type(screen.getByLabelText('Region'), 'NY');

    await waitFor(() => expect(preview).toHaveTextContent('Satoshi Vintage'));
    expect(preview).toHaveTextContent('Circular fashion and Bitcoin.');
    expect(preview).toHaveTextContent('NY, CH');
  });

  it('shows the storefront preview as a labeled preview, not as an editable field', async () => {
    const user = userEvent.setup();
    render(<MarketplaceMyShop />);

    const preview = screen.getByTestId('shop-live-preview');
    expect(within(preview).getByText('Preview')).toBeInTheDocument();
    expect(screen.getByTestId('shop-live-preview-caption')).toHaveTextContent(
      'This is a preview of your public storefront. Edit your shop details in the form below.',
    );
    expect(within(preview).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(preview).queryByRole('searchbox')).not.toBeInTheDocument();
    expect(preview.querySelector('input, textarea, [contenteditable="true"]')).toBeNull();

    expect(within(preview).getByRole('heading', { name: 'Your shop name' })).toHaveClass('text-muted-foreground');
    await user.click(within(preview).getByRole('heading', { name: 'Your shop name' }));
    await user.keyboard('typed into the preview');
    expect(preview).toHaveTextContent('Your shop name');
    expect(preview).not.toHaveTextContent('typed into the preview');
    expect(screen.getByLabelText('Shop name')).toHaveValue('');

    const field = screen.getByRole('textbox', { name: 'Shop name' });
    expect(field).toHaveAttribute('placeholder', 'e.g. Satoshi Vintage');
    await user.type(field, 'Satoshi Vintage');
    await waitFor(() => expect(preview).toHaveTextContent('Satoshi Vintage'));
    expect(within(preview).getByRole('heading', { name: 'Satoshi Vintage' })).not.toHaveClass('text-muted-foreground');
  });

  it('starts a new shop with no country and no policies, so nothing publishes by accident', () => {
    render(<MarketplaceMyShop />);

    expect(screen.getByLabelText('Country')).toHaveValue('');
    expect(screen.getByLabelText('Country')).toHaveAttribute('placeholder', 'Two-letter code');
    expect(screen.getByLabelText('Shipping policy')).toHaveValue('');
    expect(screen.getByLabelText('Return policy')).toHaveValue('');
    expect(screen.getByTestId('shop-live-preview')).not.toHaveTextContent('US');
  });

  it('explains the destination countries field and previews what buyers will see', async () => {
    const user = userEvent.setup();
    render(<MarketplaceMyShop />);

    const hint = screen.getByTestId('shop-settings-ships-to-hint');
    expect(hint).toHaveTextContent('Leave empty to ship anywhere.');

    await user.type(screen.getByLabelText('Ships to (country codes)'), 'ch, li');

    await waitFor(() =>
      expect(hint).toHaveTextContent(
        'Buyers see “Ships to: Switzerland and Liechtenstein”, and checkout only accepts delivery addresses there. Pickup is not affected.',
      ),
    );
  });

  it('asks before a click on a link takes the seller away with unsaved edits, and lets them keep editing', async () => {
    const user = userEvent.setup();
    render(<MarketplaceMyShop />);
    const link = screen.getByRole('link', { name: /View public storefront/ });
    const followed = vi.fn();
    const onLinkClick = (event: Event) => {
      if (event.target === link) followed();
    };
    document.addEventListener('click', onLinkClick);

    await user.click(link);
    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument();
    expect(followed).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText('Shop name'), 'Satoshi Vintage');
    followed.mockClear();
    await user.click(link);

    const dialog = await screen.findByTestId('unsaved-changes-dialog');
    expect(dialog).toHaveTextContent('Leave without saving?');
    expect(dialog).toHaveTextContent('You have unsaved changes to your storefront.');
    expect(followed).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Shop name')).toHaveValue('Satoshi Vintage');
    expect(followed).not.toHaveBeenCalled();
    document.removeEventListener('click', onLinkClick);
  });

  it('follows the link once the seller chooses to discard the unsaved edits', async () => {
    const user = userEvent.setup();
    render(<MarketplaceMyShop />);
    const link = screen.getByRole('link', { name: /View public storefront/ });
    const followed = vi.fn();
    await user.type(screen.getByLabelText('Shop name'), 'Satoshi Vintage');
    const onLinkClick = (event: Event) => {
      if (event.target === link) followed();
    };
    document.addEventListener('click', onLinkClick);

    await user.click(link);
    const dialog = await screen.findByTestId('unsaved-changes-dialog');
    expect(followed).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Discard changes' }));

    await waitFor(() => expect(followed).toHaveBeenCalledTimes(1));
    document.removeEventListener('click', onLinkClick);
  });

  it('offers a retry instead of an editable replacement shop when loading fails', async () => {
    load.error = true;
    render(<MarketplaceMyShop />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load your current shop settings");
    expect(screen.queryByLabelText('Shop name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create shop' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(load.reload).toHaveBeenCalledOnce();
  });
});
