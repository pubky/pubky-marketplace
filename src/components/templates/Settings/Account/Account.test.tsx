import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIGN_OUT_COPY } from '@/hooks/useSignOutCopy/useSignOutCopy';
import { useAuthStore } from '@/stores/auth/auth.store';
import { asOpaque } from '@/test-utils/type-assertions';
import { Account } from './Account';

const hosted = vi.hoisted(() => ({ value: false }));
vi.mock('@/providers/ShopHostSessionProvider/ShopHostSessionProvider', () => ({ useIsShopHosted: () => hosted.value }));

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

describe('Account', () => {
  it('renders account content', () => {
    render(<Account />);
    expect(screen.getByText('Edit your profile')).toBeInTheDocument();
  });

  it('renders all account sections', () => {
    render(<Account />);
    expect(screen.getByText('Edit your profile')).toBeInTheDocument();
    expect(screen.getByText('Backup your account')).toBeInTheDocument();
    expect(screen.getByText('Delete your account')).toBeInTheDocument();
  });
});

describe('Account sign-out copy', () => {
  afterEach(() => {
    hosted.value = false;
    act(() => {
      useAuthStore.setState({ session: null });
    });
  });

  it('says a hosted sign-out signs out both App and Shop', () => {
    hosted.value = true;
    useAuthStore.setState({ session: asOpaque({ info: {} }) });
    render(<Account />);
    expect(screen.getByRole('heading', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByText(SIGN_OUT_COPY.host)).toBeInTheDocument();
    expect(SIGN_OUT_COPY.host).toContain('Pubky App and the Shop in this browser');
    expect(screen.queryByText(SIGN_OUT_COPY.grant)).not.toBeInTheDocument();
  });

  it('says a Bitkit grant sign-out leaves pubky.app signed in', () => {
    useAuthStore.setState({ session: asOpaque({ info: {}, grant: {} }) });
    render(<Account />);
    expect(screen.getByText(SIGN_OUT_COPY.grant)).toBeInTheDocument();
    expect(SIGN_OUT_COPY.grant).toContain('pubky.app is not signed out');
    expect(screen.queryByText(SIGN_OUT_COPY.host)).not.toBeInTheDocument();
  });
});
