import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { COMMERCE_BLOCKED_INFO, COMMERCE_BLOCKED_MESSAGE } from '@/libs/commerce/region-modes';
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
});
