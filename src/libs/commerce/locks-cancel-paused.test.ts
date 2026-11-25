import { describe, expect, it } from 'vitest';
import { LOCKS_CANCEL_PAUSED_IN_PROGRESS_COPY, locksCancelPausedMessage } from './locks-cancel-paused';

const FORMAT = { locale: 'en-US', timeZone: 'UTC' } as const;

describe('locksCancelPausedMessage', () => {
  it('states the earliest local hour and minute for an unregistered payment ending on the same day', () => {
    expect(
      locksCancelPausedMessage({
        holdExpiresAt: '2026-11-24T19:55:00.000Z',
        registered: false,
        now: Date.parse('2026-11-24T20:00:00.000Z'),
        ...FORMAT,
      }),
    ).toBe('Cancelling is paused while this payment is still in progress. The earliest you can cancel it is 8:05 PM.');
  });

  it('adds the short month and day when the earliest time is on another day', () => {
    expect(
      locksCancelPausedMessage({
        holdExpiresAt: '2026-11-24T23:55:00.000Z',
        registered: false,
        now: Date.parse('2026-11-24T23:58:00.000Z'),
        ...FORMAT,
      }),
    ).toBe(
      'Cancelling is paused while this payment is still in progress. The earliest you can cancel it is Nov 25, 12:05 AM.',
    );
  });

  it('rounds the earliest time up to the next whole minute', () => {
    expect(
      locksCancelPausedMessage({
        holdExpiresAt: '2026-11-24T19:55:30.000Z',
        registered: false,
        now: Date.parse('2026-11-24T20:00:00.000Z'),
        ...FORMAT,
      }),
    ).toBe('Cancelling is paused while this payment is still in progress. The earliest you can cancel it is 8:06 PM.');
  });

  it('states no exact time when the hold and the grace pass the last supported date', () => {
    expect(
      locksCancelPausedMessage({
        holdExpiresAt: new Date(8_640_000_000_000_000).toISOString(),
        registered: false,
        now: Date.parse('2026-11-24T20:00:00.000Z'),
        ...FORMAT,
      }),
    ).toBe(LOCKS_CANCEL_PAUSED_IN_PROGRESS_COPY);
  });

  it.each([
    ['registered', { holdExpiresAt: '2026-11-24T20:05:00.000Z', registered: true }],
    ['null', { holdExpiresAt: null, registered: false }],
    ['absent', { holdExpiresAt: undefined, registered: false }],
    ['unparseable', { holdExpiresAt: 'not-a-date', registered: false }],
    ['past', { holdExpiresAt: '2026-11-24T19:55:00.000Z', registered: false }],
  ] as const)('states no exact time when the hold is %s', (_label, input) => {
    const now = Date.parse(_label === 'past' ? '2026-11-24T20:06:00.000Z' : '2026-11-24T20:00:00.000Z');
    expect(locksCancelPausedMessage({ ...input, now, ...FORMAT })).toBe(LOCKS_CANCEL_PAUSED_IN_PROGRESS_COPY);
    expect(LOCKS_CANCEL_PAUSED_IN_PROGRESS_COPY).toBe(
      'Cancelling is paused while this payment is still in progress. Try again once it is no longer in progress.',
    );
  });
});
