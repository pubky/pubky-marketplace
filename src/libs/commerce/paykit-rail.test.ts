import { describe, expect, it } from 'vitest';
import {
  PAYKIT_OUTAGE_COPY,
  PAYKIT_RAIL_STALE_AGE_SECONDS,
  paykitRailStatusFromHealth,
  paykitRetryDelayMs,
} from './paykit-rail';

describe('paykitRailStatusFromHealth', () => {
  it('is ready for a fresh good probe', () => {
    expect(paykitRailStatusFromHealth({ paykitRail: { bitcoinOfferAvailable: true, ageSeconds: 12 } })).toBe('ready');
  });

  it('is unreachable when the last probe says the rail is down', () => {
    expect(paykitRailStatusFromHealth({ paykitRail: { bitcoinOfferAvailable: false, ageSeconds: 3 } })).toBe(
      'unreachable',
    );
  });

  it('is unreachable when the last good probe is older than the stale window, so every probe since failed', () => {
    expect(
      paykitRailStatusFromHealth({
        paykitRail: { bitcoinOfferAvailable: true, ageSeconds: PAYKIT_RAIL_STALE_AGE_SECONDS + 1 },
      }),
    ).toBe('unreachable');
    expect(
      paykitRailStatusFromHealth({
        paykitRail: { bitcoinOfferAvailable: true, ageSeconds: PAYKIT_RAIL_STALE_AGE_SECONDS },
      }),
    ).toBe('ready');
  });

  it.each([
    ['no paykitRail', {}],
    ['a rail that never succeeded', { paykitRail: { bitcoinOfferAvailable: null, ageSeconds: null } }],
  ])('is unknown for %s, which says nothing about an outage', (_, health) => {
    expect(paykitRailStatusFromHealth(health)).toBe('unknown');
  });
});

describe('paykitRetryDelayMs', () => {
  it('backs off 5s, 10s, 20s and then holds at 30s', () => {
    expect([0, 1, 2, 3, 4, 50].map(paykitRetryDelayMs)).toEqual([5_000, 10_000, 20_000, 30_000, 30_000, 30_000]);
  });
});

describe('PAYKIT_OUTAGE_COPY', () => {
  it('is calm, honest and never blames the user setup', () => {
    expect(PAYKIT_OUTAGE_COPY.title).toBe('Paykit is temporarily unreachable, retrying…');
    for (const copy of Object.values(PAYKIT_OUTAGE_COPY)) {
      expect(copy).not.toMatch(/add a payment method|unavailable page/i);
    }
  });
});
