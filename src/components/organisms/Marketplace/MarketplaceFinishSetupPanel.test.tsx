import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreState } from '@/config/store-mode';
import { STORE_SETUP_PERSIST_KEY } from '@/stores/persistedKeys';
import { useStoreSetupStore } from '@/stores/storeSetup/storeSetup.store';
import { MarketplaceFinishSetupPanel } from './MarketplaceFinishSetupPanel';

const SELLER = 'o'.repeat(52);
const runtime = vi.hoisted(() => ({
  viewer: 'o'.repeat(52) as string | null,
  state: { kind: 'claimed', seller: 'o'.repeat(52), source: 'claim', claimMode: true } as StoreState,
}));

vi.mock('@/config/store-mode', () => ({ getStoreState: () => runtime.state }));
vi.mock('@/config/base-path', () => ({ getShopBaseUrl: () => 'https://shop.example/base' }));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string | null }) => unknown) =>
    selector({ currentUserPubky: runtime.viewer }),
}));
vi.mock('@/molecules/Toaster/toast', () => ({ toast: vi.fn() }));

describe('MarketplaceFinishSetupPanel', () => {
  beforeEach(() => {
    runtime.viewer = SELLER;
    runtime.state = { kind: 'claimed', seller: SELLER, source: 'claim', claimMode: true };
    useStoreSetupStore.setState({ finishPanelDismissed: false });
    window.localStorage.clear();
  });

  it('shows all setup steps for the seller with an empty catalog in claim mode', () => {
    render(<MarketplaceFinishSetupPanel catalogEmpty />);

    expect(screen.getByRole('heading', { name: 'Finish setting up your shop' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your first listing' })).toHaveAttribute(
      'href',
      '/marketplace/sell',
    );
    expect(screen.getByRole('link', { name: 'payment settings' })).toHaveAttribute('href', '/marketplace/settings');
    expect(screen.getByTestId('copy-field-value')).toHaveTextContent(
      `https://shop.example/base/marketplace/shop/${SELLER}`,
    );
    expect(screen.getByText(/You can now remove/)).toHaveTextContent('STORE_CLAIM_TOKEN');
  });

  const hiddenCases: Array<[string, { state?: StoreState; viewer?: string; catalogEmpty?: boolean }]> = [
    ['a pinned store', { state: { kind: 'claimed', seller: SELLER, source: 'pinned', claimMode: false } }],
    ['another viewer', { viewer: 'y'.repeat(52) }],
    ['a non-empty catalog', { catalogEmpty: false }],
  ];

  it.each(hiddenCases)('stays hidden for %s', (_label, options) => {
    Object.assign(runtime, options);
    render(<MarketplaceFinishSetupPanel catalogEmpty={options.catalogEmpty ?? true} />);
    expect(screen.queryByTestId('finish-setup-panel')).not.toBeInTheDocument();
  });

  it('stays hidden after dismissal and registers the persisted key', () => {
    render(<MarketplaceFinishSetupPanel catalogEmpty />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss finish setup' }));

    expect(screen.queryByTestId('finish-setup-panel')).not.toBeInTheDocument();
    expect(useStoreSetupStore.getState().finishPanelDismissed).toBe(true);
    expect(STORE_SETUP_PERSIST_KEY).toBe('shop-store-setup-storage');
    expect(window.localStorage.getItem(STORE_SETUP_PERSIST_KEY)).toContain('"finishPanelDismissed":true');
  });
});
