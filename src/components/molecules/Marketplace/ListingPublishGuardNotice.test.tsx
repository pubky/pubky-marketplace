import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import {
  LISTING_PUBLISH_BLOCK_COPY,
  LISTING_PUBLISH_BLOCK_REASONS,
  peekListingComposerReturnTo,
} from '@/libs/commerce/listing-publish-guards';
import { ListingPublishGuardNotice } from './ListingPublishGuardNotice';

vi.mock('@/organisms/Marketplace/MarketplaceSessionConnectDialog', () => ({
  MarketplaceSessionConnectDialog: ({ triggerLabel, intent }: { triggerLabel: string; intent: string }) => (
    <button type="button" data-intent={intent}>
      {triggerLabel}
    </button>
  ),
}));

describe('ListingPublishGuardNotice', () => {
  it.each(LISTING_PUBLISH_BLOCK_REASONS.filter((reason) => reason !== 'paykit-unreachable'))(
    'renders %s copy at the action density',
    (reason) => {
      render(
        <ListingPublishGuardNotice
          reason={reason}
          surface="listing-publish-guard"
          id="listing-publish-guard"
          density="action"
        />,
      );

      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('data-surface', 'listing-publish-guard');
      expect(alert).toHaveAttribute('id', 'listing-publish-guard');
      expect(alert).toHaveTextContent(LISTING_PUBLISH_BLOCK_COPY[reason].title);
      expect(alert).toHaveTextContent(LISTING_PUBLISH_BLOCK_COPY[reason].body);
    },
  );

  it.each([
    ['action', 'p-3'],
    ['banner', 'p-4'],
  ] as const)('sizes the Paykit outage like the %s density', (density, padding) => {
    render(<ListingPublishGuardNotice reason="paykit-unreachable" surface="listing-publish-guard" density={density} />);

    expect(screen.getByRole('status')).toHaveClass(padding);
  });

  it('shows a Paykit outage as a calm status with no action', () => {
    render(
      <ListingPublishGuardNotice
        reason="paykit-unreachable"
        surface="listing-publish-guard"
        id="listing-publish-guard"
        density="action"
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('data-surface', 'listing-publish-guard');
    expect(status).toHaveAttribute('id', 'listing-publish-guard');
    expect(status).toHaveTextContent('Paykit is temporarily unreachable, retrying…');
    expect(status).toHaveTextContent(LISTING_PUBLISH_BLOCK_COPY['paykit-unreachable'].body);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('links payment settings for the no-method guard', () => {
    render(<ListingPublishGuardNotice reason="no-method" surface="listing-publish-guard" density="action" />);

    expect(screen.getByRole('link', { name: 'Payment settings' })).toHaveAttribute(
      'href',
      `${MARKETPLACE_ROUTES.SETTINGS}?returnTo=${encodeURIComponent(MARKETPLACE_ROUTES.SELL)}`,
    );
    expect(screen.queryByRole('button', { name: 'Enable selling' })).not.toBeInTheDocument();
  });

  it('links Shipping settings, where the delivery key is created, for the no-delivery-key guard', () => {
    render(<ListingPublishGuardNotice reason="no-delivery-key" surface="listing-publish-guard" density="action" />);

    expect(screen.getByRole('link', { name: 'Create delivery key' })).toHaveAttribute(
      'href',
      `${MARKETPLACE_ROUTES.SETTINGS_SHIPPING}?returnTo=${encodeURIComponent(MARKETPLACE_ROUTES.SELL)}`,
    );
    expect(screen.queryByRole('button', { name: 'Enable selling' })).not.toBeInTheDocument();
  });

  it('sends an edited listing back to its edit page from Shipping settings', () => {
    const editPath = `/marketplace/listing/${'y'.repeat(52)}/item/edit`;
    render(
      <ListingPublishGuardNotice
        reason="no-delivery-key"
        surface="listing-publish-guard"
        density="action"
        returnTo={editPath}
      />,
    );

    expect(screen.getByRole('link', { name: 'Create delivery key' })).toHaveAttribute(
      'href',
      `${MARKETPLACE_ROUTES.SETTINGS_SHIPPING}?returnTo=${encodeURIComponent(editPath)}`,
    );
  });

  it.each([
    ['no-delivery-key', 'Create delivery key'],
    ['no-method', 'Payment settings'],
  ] as const)('remembers the composer and keeps the draft when the %s link is followed', async (reason, name) => {
    sessionStorage.clear();
    const onLeaveForSettings = vi.fn();
    render(
      <ListingPublishGuardNotice
        reason={reason}
        surface="listing-publish-guard"
        density="action"
        onLeaveForSettings={onLeaveForSettings}
      />,
    );

    const link = screen.getByRole('link', { name });
    link.addEventListener('click', (event) => event.preventDefault());
    await userEvent.click(link);

    expect(onLeaveForSettings).toHaveBeenCalledTimes(1);
    expect(peekListingComposerReturnTo()).toBe(MARKETPLACE_ROUTES.SELL);
  });

  it('offers no action for an unreadable delivery key, which a reload resolves', () => {
    render(
      <ListingPublishGuardNotice reason="delivery-key-unverified" surface="listing-publish-guard" density="action" />,
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('bootstraps a marketplace session from the session guard, not the buyer reconnect card', () => {
    render(<ListingPublishGuardNotice reason="session" surface="listing-publish-guard" density="action" />);

    expect(screen.getByRole('button', { name: 'Enable selling' })).toHaveAttribute('data-intent', 'sell');
    expect(screen.queryByText('Approve purchases in Pubky Ring')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve in Pubky Ring' })).not.toBeInTheDocument();
  });

  it('uses the same session bootstrap control on the page banner', () => {
    render(<ListingPublishGuardNotice reason="unverified" surface="seller-publish-blocked" density="banner" />);

    expect(screen.getByRole('button', { name: 'Enable selling' })).toHaveAttribute('data-intent', 'sell');
    expect(screen.queryByText('Approve purchases in Pubky Ring')).not.toBeInTheDocument();
  });
});
