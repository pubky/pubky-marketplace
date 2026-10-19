import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HOSTED_SIGN_IN_MESSAGE } from '@/libs/auth/sign-in-error-copy';
import { requestShopHostAction } from '@/libs/shop-session/bridge';
import { useIsShopHosted } from '@/providers/ShopHostSessionProvider/ShopHostSessionProvider';
import { SignInPage } from './SignInPage';

vi.mock('@/providers/ShopHostSessionProvider/ShopHostSessionProvider', () => ({ useIsShopHosted: vi.fn() }));
vi.mock('@/libs/shop-session/bridge', () => ({ requestShopHostAction: vi.fn().mockReturnValue(true) }));
vi.mock('@/organisms/SignIn/SignIn', () => ({
  SignInContent: () => <div data-testid="standalone-sign-in" />,
  SignInFooter: () => null,
}));
vi.mock('@/organisms/SignInNavigation/SignInNavigation', () => ({ SignInNavigation: () => null }));

beforeEach(() => {
  vi.mocked(requestShopHostAction).mockClear();
});

describe('SignInPage', () => {
  it('renders the Shop sign-in when the Shop is not embedded in Pubky App', () => {
    vi.mocked(useIsShopHosted).mockReturnValue(false);
    render(<SignInPage />);

    expect(screen.getByTestId('standalone-sign-in')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue in Pubky App' })).not.toBeInTheDocument();
  });

  it('hands sign-in to Pubky App on a tap when embedded, without starting a Shop sign-in', async () => {
    vi.mocked(useIsShopHosted).mockReturnValue(true);
    render(<SignInPage />);

    expect(screen.queryByTestId('standalone-sign-in')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(HOSTED_SIGN_IN_MESSAGE);
    expect(requestShopHostAction).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue in Pubky App' }));
    expect(requestShopHostAction).toHaveBeenCalledExactlyOnceWith('request-login');
  });
});
