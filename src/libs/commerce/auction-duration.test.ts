import { describe, expect, it } from 'vitest';
import { auctionDurationLabel, auctionDurationOptionLabel, resolveAuctionDurationMinutes } from './auction-duration';

describe('auctionDurationLabel', () => {
  it('labels days, hours and minutes', () => {
    expect(auctionDurationLabel(10080)).toBe('7-day');
    expect(auctionDurationLabel(60)).toBe('1-hour');
    expect(auctionDurationLabel(90)).toBe('90-minute');
    expect(auctionDurationLabel(15)).toBe('15-minute');
  });
});

describe('auctionDurationOptionLabel', () => {
  it('pluralises the unit', () => {
    expect(auctionDurationOptionLabel(10080)).toBe('7 days');
    expect(auctionDurationOptionLabel(1440)).toBe('1 day');
    expect(auctionDurationOptionLabel(60)).toBe('1 hour');
    expect(auctionDurationOptionLabel(15)).toBe('15 minutes');
    expect(auctionDurationOptionLabel(1)).toBe('1 minute');
  });
});

describe('resolveAuctionDurationMinutes', () => {
  it('keeps an offered choice', () => {
    expect(resolveAuctionDurationMinutes('15', [10080, 15])).toBe(15);
  });

  it('falls back to the first offered length for a blank or unknown choice', () => {
    expect(resolveAuctionDurationMinutes('', [10080, 15])).toBe(10080);
    expect(resolveAuctionDurationMinutes(undefined, [10080])).toBe(10080);
    expect(resolveAuctionDurationMinutes('5', [10080, 15])).toBe(10080);
  });
});
