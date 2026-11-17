import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMMERCE_BLOCKED_INFO, COMMERCE_BLOCKED_MESSAGE } from '@/libs/commerce/region-modes';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useBuyerCountryStore } from '@/stores/buyer-country/buyer-country.store';
import { CommerceBlockedNotice } from './CommerceBlockedNotice';
import { RegionAvailabilityNotice } from './RegionAvailabilityNotice';

describe('CommerceBlockedNotice', () => {
  it('shows one line and an info icon that explains it', async () => {
    const user = userEvent.setup();
    render(<CommerceBlockedNotice message={COMMERCE_BLOCKED_MESSAGE} info={COMMERCE_BLOCKED_INFO} testId="notice" />);

    expect(screen.getByRole('status')).toHaveTextContent(COMMERCE_BLOCKED_MESSAGE);
    expect(screen.getByTestId('notice')).toBe(screen.getByRole('status'));
    await user.click(screen.getByRole('button', { name: 'About this limit' }));
    expect(await screen.findByTestId('info-hint-content')).toHaveTextContent(COMMERCE_BLOCKED_INFO);
  });
});

describe('CommerceBlockedNotice for a saved country', () => {
  const BUYER = 'b'.repeat(52);
  beforeEach(() => {
    useAuthStore.setState({ currentUserPubky: BUYER });
    useBuyerCountryStore.setState({ country: 'GB', owner: BUYER });
  });
  afterEach(() => {
    useAuthStore.setState({ currentUserPubky: null });
    useBuyerCountryStore.setState({ country: null, owner: null });
  });

  it('offers to change the saved country when it is the reason', async () => {
    const user = userEvent.setup();
    render(
      <CommerceBlockedNotice
        message={COMMERCE_BLOCKED_MESSAGE}
        info={COMMERCE_BLOCKED_INFO}
        source="declared"
        testId="notice"
      />,
    );

    expect(screen.getByTestId('notice-country')).toHaveTextContent('Country you live in: United Kingdom');
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByLabelText('Country you live in')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Clear my country' })).toBeInTheDocument();
  });

  it.each(['ip', 'seller', 'unknown', null] as const)('offers nothing to change when the reason is %s', (source) => {
    render(
      <CommerceBlockedNotice
        message={COMMERCE_BLOCKED_MESSAGE}
        info={COMMERCE_BLOCKED_INFO}
        source={source}
        testId="n"
      />,
    );

    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
  });

  it('offers nothing when no country is saved', () => {
    useBuyerCountryStore.setState({ country: null, owner: null });
    render(
      <CommerceBlockedNotice
        message={COMMERCE_BLOCKED_MESSAGE}
        info={COMMERCE_BLOCKED_INFO}
        source="declared"
        testId="n"
      />,
    );

    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
  });
});

describe('RegionAvailabilityNotice with commerce blocked', () => {
  const region = {
    enabled: true,
    buyerCountry: null,
    setBuyerCountry: () => undefined,
    needsCountry: true,
    refusal: 'something else',
    canChangeCountry: false,
    usesCountry: false,
    digitalNote: null,
  };

  it('shows only the blocked line, in place of the country prompt and any refusal', () => {
    render(
      <RegionAvailabilityNotice
        region={region}
        testIdPrefix="listing"
        blocked={{ message: COMMERCE_BLOCKED_MESSAGE, info: COMMERCE_BLOCKED_INFO }}
      />,
    );

    expect(screen.getByTestId('listing-blocked')).toHaveTextContent(COMMERCE_BLOCKED_MESSAGE);
    expect(screen.queryByTestId('listing-region')).not.toBeInTheDocument();
    expect(screen.queryByText('something else')).not.toBeInTheDocument();
  });

  it('keeps today’s notice when nothing is blocked', () => {
    render(<RegionAvailabilityNotice region={region} testIdPrefix="listing" blocked={null} />);

    expect(screen.getByTestId('listing-region')).toBeInTheDocument();
    expect(screen.queryByTestId('listing-blocked')).not.toBeInTheDocument();
  });

  it('passes the reason on, so a saved country can be changed from a listing', () => {
    useAuthStore.setState({ currentUserPubky: 'b'.repeat(52) });
    useBuyerCountryStore.setState({ country: 'GB', owner: 'b'.repeat(52) });
    render(
      <RegionAvailabilityNotice
        region={region}
        testIdPrefix="listing"
        blocked={{ message: COMMERCE_BLOCKED_MESSAGE, info: COMMERCE_BLOCKED_INFO, source: 'declared' }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    useAuthStore.setState({ currentUserPubky: null });
    useBuyerCountryStore.setState({ country: null, owner: null });
  });
});
