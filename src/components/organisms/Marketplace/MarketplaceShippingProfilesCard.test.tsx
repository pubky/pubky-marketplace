import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShippingProfileSnapshot } from '@/libs/commerce/shipping-profile';
import { asOpaque } from '@/test-utils/type-assertions';
import { MarketplaceShippingProfilesCard } from './MarketplaceShippingProfilesCard';

const hook = vi.hoisted(() => ({
  save: vi.fn(async () => true),
  remove: vi.fn(async () => true),
  profiles: [] as unknown[],
}));

vi.mock('@/hooks/useMarketplaceShippingProfiles/useMarketplaceShippingProfiles', () => ({
  useMarketplaceShippingProfiles: () => ({
    state: { status: 'ready', profiles: hook.profiles, unreadable: [] },
    save: hook.save,
    remove: hook.remove,
  }),
}));

const profile = asOpaque<ShippingProfileSnapshot>({
  sha256: 'a'.repeat(64),
  record: {
    schemaVersion: 1,
    recordType: 'shipping_profile',
    ownerPubky: 'o'.repeat(52),
    revision: 3,
    createdAt: '2026-11-05T10:00:00.000Z',
    updatedAt: '2026-11-05T10:00:00.000Z',
    profileId: 'worldwide',
    name: 'Worldwide',
    currency: 'USD',
    exponent: 2,
    origins: ['US'],
    excludedCountries: [],
    zones: [
      {
        zoneId: 'us',
        name: 'United States',
        countries: ['US'],
        carrierHint: 'ups',
        rates: [
          {
            pricing: 'flat',
            rateId: 'std',
            label: 'Standard',
            estimatedMinDays: 4,
            estimatedMaxDays: 8,
            amountMinor: 479,
            trackingIncluded: true,
          },
        ],
      },
    ],
  },
});

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
});

beforeEach(() => {
  hook.save.mockClear();
  hook.profiles = [profile];
});

describe('MarketplaceShippingProfilesCard', () => {
  it('saves an edited profile with the zone and rate members another client wrote', async () => {
    const user = userEvent.setup();
    render(<MarketplaceShippingProfilesCard />);

    await user.click(screen.getByRole('button', { name: 'Edit Worldwide' }));
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(hook.save).toHaveBeenCalledTimes(1));
    expect(hook.save).toHaveBeenCalledWith(
      'worldwide',
      expect.objectContaining({
        zones: [
          expect.objectContaining({
            zoneId: 'us',
            carrierHint: 'ups',
            rates: [expect.objectContaining({ rateId: 'std', amountMinor: 479, trackingIncluded: true })],
          }),
        ],
      }),
    );
  });

  it.each([
    { currency: 'XTS', exponent: 3, amountMinor: 4790, label: 'a currency the studio cannot author' },
    { currency: 'USD', exponent: 3, amountMinor: 4790, label: 'a known currency with other decimals' },
    { currency: 'JPY', exponent: 0, amountMinor: 479, label: 'a currency with no decimals' },
  ])('keeps the stored asset when editing a profile in $label', async ({ currency, exponent, amountMinor }) => {
    const user = userEvent.setup();
    const stored = structuredClone(profile);
    stored.record.currency = currency;
    stored.record.exponent = exponent;
    (stored.record.zones[0].rates[0] as { amountMinor: number }).amountMinor = amountMinor;
    hook.profiles = [stored];
    render(<MarketplaceShippingProfilesCard />);

    await user.click(screen.getByRole('button', { name: 'Edit Worldwide' }));
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(hook.save).toHaveBeenCalledTimes(1));
    expect(hook.save).toHaveBeenCalledWith(
      'worldwide',
      expect.objectContaining({
        currency,
        exponent,
        zones: [expect.objectContaining({ rates: [expect.objectContaining({ amountMinor })] })],
      }),
    );
  });
});
