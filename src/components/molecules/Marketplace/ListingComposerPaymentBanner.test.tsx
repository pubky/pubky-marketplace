import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { getMarketplacePaymentSettingsRoute, MARKETPLACE_ROUTES } from '@/app/routes';
import {
  LISTING_COMPOSER_PAYMENT_COPY,
  LISTING_COMPOSER_RETURN_INTENT_KEY,
} from '@/libs/commerce/listing-publish-guards';
import { ListingComposerPaymentBanner } from './ListingComposerPaymentBanner';

describe('ListingComposerPaymentBanner', () => {
  it('says drafts stay available and links to payment settings', () => {
    render(<ListingComposerPaymentBanner />);

    expect(screen.getByRole('status')).toHaveTextContent(LISTING_COMPOSER_PAYMENT_COPY.title);
    expect(screen.getByText(LISTING_COMPOSER_PAYMENT_COPY.body)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Payment settings' })).toHaveAttribute(
      'href',
      getMarketplacePaymentSettingsRoute(MARKETPLACE_ROUTES.SELL),
    );
    expect(document.querySelector('[data-surface="listing-payment-setup"]')).not.toBeNull();
  });

  it('remembers the composer return path when opening payment settings', async () => {
    sessionStorage.clear();
    const user = userEvent.setup();
    render(<ListingComposerPaymentBanner />);

    await user.click(screen.getByRole('link', { name: 'Payment settings' }));

    expect(sessionStorage.getItem(LISTING_COMPOSER_RETURN_INTENT_KEY)).toBe(MARKETPLACE_ROUTES.SELL);
  });
});
