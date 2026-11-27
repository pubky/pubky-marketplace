import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { groupPubky } from '@/libs/store-claim/format-pubky';
import { STORE_CLAIM_CODE_SESSION_KEY } from '@/libs/store-claim/store-claim-code';
import { StoreClaimedView } from './StoreClaimedView';

describe('StoreClaimedView', () => {
  it('shows the grouped seller and clears a stored code', () => {
    const seller = 'o'.repeat(52);
    window.sessionStorage.setItem(STORE_CLAIM_CODE_SESSION_KEY, 'code');

    render(<StoreClaimedView seller={seller} />);

    expect(screen.getByRole('heading').textContent).toContain(groupPubky(seller));
    expect(screen.getByRole('link', { name: 'Open the shop' })).toHaveAttribute('href', `/marketplace/shop/${seller}`);
    expect(screen.getByRole('link', { name: 'Sign in to Seller Studio' })).toHaveAttribute('href', '/sign-in');
    expect(window.sessionStorage.getItem(STORE_CLAIM_CODE_SESSION_KEY)).toBeNull();
  });
});
